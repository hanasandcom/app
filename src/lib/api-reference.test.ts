import { afterEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { applicationEndpoints, documentationSource, responseExamples } from '../data/api-reference-data'
import type { AppSettings } from '../types'
import { documentLimit, jsonChunks, loadOpenApi, openApiUrl, operationMatches, operations, parseOpenApi, referenceScope, ReferenceRequests, referencedSchemas, resolveReference, securityLabel } from './api-reference'

const originalFetch = globalThis.fetch
const contract = () => ({ openapi: '3.1.0', info: { title: 'Synthetic public API', version: '1.0' },
    servers: [{ url: 'https://never-execute.example/api/v1' }], security: [{ apiKey: ['read'] }],
    paths: { '/actors': { parameters: [], get: { summary: 'List actors', operationId: 'getActors', responses: { '200': { $ref: '#/components/responses/Actors' } } } },
        '/public': { post: { security: [], description: 'Public operation', responses: { '201': { description: 'Created' } } } } },
    components: { responses: { Actors: { description: 'Actors page', content: { 'application/json': { schema: { $ref: '#/components/schemas/Actor' } } } } },
        schemas: { Actor: { type: 'object', properties: { id: { type: 'string' } } }, 'A/B~C': { type: 'string' } } } })
const document = () => parseOpenApi(JSON.stringify(contract()))
afterEach(() => { globalThis.fetch = originalFetch })

describe('public API reference transport and validation', () => {
    it('uses canonical public TI for production and only the configured custom website route', () => {
        for (const site of ['https://hanasand.com', 'https://hanasand.com/', 'https://www.hanasand.com'])
            expect(openApiUrl(site)).toBe('https://ti.hanasand.com/api/openapi/ti')
        expect(openApiUrl('https://custom.example/base/')).toBe('https://custom.example/base/api/openapi/ti')
        expect(openApiUrl('https://ti.hanasand.com')).toBe('https://ti.hanasand.com/api/openapi/ti')
        for (const site of ['http://custom.example', 'https://user:password@custom.example', 'https://custom.example?token=bad', 'https://custom.example/#fragment'])
            expect(() => openApiUrl(site)).toThrow()
    })
    it('never sends account headers, cookies or device proofs and never follows contract server URLs', async () => {
        const calls: Array<{ url: string; init?: RequestInit }> = []
        globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
            calls.push({ url: String(url), init }); return Response.json(contract())
        }) as unknown as typeof fetch
        const signal = new AbortController().signal
        expect((await loadOpenApi('https://hanasand.com', signal)).info.title).toBe('Synthetic public API')
        expect(calls).toHaveLength(1)
        expect(calls[0].url).toBe('https://ti.hanasand.com/api/openapi/ti')
        expect(calls[0].init).toEqual({ method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: expect.any(AbortSignal), headers: { Accept: 'application/json' } })
    })
    it('does not replace HTTP, malformed JSON, wrong-envelope or oversized failures with an empty contract', async () => {
        for (const response of [new Response('unavailable', { status: 503 }), Response.json({ error: 'unavailable' }), new Response('<html>failure</html>'), new Response('{}', { headers: { 'content-length': String(documentLimit + 1) } })]) {
            globalThis.fetch = (async () => response) as unknown as typeof fetch
            await expect(loadOpenApi('https://hanasand.com', new AbortController().signal)).rejects.toThrow()
        }
        for (const value of [{}, { ...contract(), paths: [] }, { ...contract(), openapi: '2.0' }, { ...contract(), info: { title: '', version: '1' } }, { ...contract(), info: { title: 'API', version: '1', description: {} } }, { ...contract(), paths: { invalid: {} } }, { ...contract(), paths: { '/bad': { get: {} } } }])
            expect(() => parseOpenApi(JSON.stringify(value))).toThrow()
        expect(() => parseOpenApi(' '.repeat(documentLimit + 1))).toThrow('2 MB')
    })
    it('rejects malformed declared security and response shapes instead of labelling them public', () => {
        for (const security of ['private', null, [null], [{ bearer: 'write' }], [{ bearer: [{}] }]])
            expect(() => parseOpenApi(JSON.stringify({ ...contract(), security }))).toThrow('security')
        for (const operation of [{ security: 'private', responses: {} }, { responses: { '200': false } }, { responses: { '200': {} } }, { requestBody: true, responses: {} }])
            expect(() => parseOpenApi(JSON.stringify({ ...contract(), paths: { '/invalid': { get: operation } } }))).toThrow()
    })
    it('cancels an oversized streaming body and rejects invalid UTF-8 without parsing it', async () => {
        let cancelled = false
        const stream = new ReadableStream<Uint8Array>({
            start(controller) { controller.enqueue(new Uint8Array(documentLimit + 1)) },
            cancel() { cancelled = true }
        })
        globalThis.fetch = (async () => new Response(stream)) as unknown as typeof fetch
        await expect(loadOpenApi('https://hanasand.com', new AbortController().signal)).rejects.toThrow('2 MB')
        expect(cancelled).toBe(true)
        globalThis.fetch = (async () => new Response(new Uint8Array([255]))) as unknown as typeof fetch
        await expect(loadOpenApi('https://hanasand.com', new AbortController().signal)).rejects.toThrow()
    })
    it('allows a declared valid empty contract but rejects excess nesting rather than inventing counts', () => {
        const empty = parseOpenApi(JSON.stringify({ openapi: '3.0.3', info: { title: 'Empty API', version: '1' }, paths: {} }))
        expect(operations(empty)).toEqual([])
        let nested: unknown = 'leaf'
        for (let index = 0; index < 60; index++) nested = { child: nested }
        expect(() => parseOpenApi(JSON.stringify({ ...contract(), nested }))).toThrow('complex')
    })
    it('discards a fetched body after the caller aborts even when a synthetic fetch ignores cancellation', async () => {
        const controller = new AbortController()
        globalThis.fetch = (async () => { controller.abort(); return Response.json(contract()) }) as unknown as typeof fetch
        await expect(loadOpenApi('https://hanasand.com', controller.signal)).rejects.toThrow()
    })
})

describe('operation, schema and raw JSON reference jobs', () => {
    it('enumerates operations without counting path metadata and searches all website operation fields', () => {
        const rows = operations(document())
        expect(rows.map((row) => `${row.method} ${row.path}`)).toEqual(['GET /actors', 'POST /public'])
        for (const query of ['get /actors', 'LIST ACTORS', 'getActors']) expect(operationMatches(rows[0], query)).toBe(true)
        expect(operationMatches(rows[0], 'not present')).toBe(false)
    })
    it('resolves local escaped references without fetching, prototype traversal or recursive expansion', () => {
        const doc = document()
        expect(resolveReference(doc, { $ref: '#/components/responses/Actors' }).resolved).toBe(true)
        expect(resolveReference(doc, { $ref: '#/components/schemas/A~1B~0C' }).value).toEqual({ type: 'string' })
        for (const ref of ['https://external.example/schema', '#/components/schemas/Missing', '#/__proto__', '#/constructor'])
            expect(resolveReference(doc, { $ref: ref }).resolved).toBe(false)
        expect(resolveReference(doc, { $ref: '#/components/schemas/Actor' }).value).toEqual(contract().components.schemas.Actor)
        expect(referencedSchemas(contract().components.responses.Actors)).toEqual(['#/components/schemas/Actor'])
    })
    it('uses operation overrides and inherited security, including anonymous alternatives', () => {
        const doc = document()
        expect(securityLabel(doc, {})).toBe('apiKey (read)')
        expect(securityLabel(doc, { security: [] })).toBe('Public')
        expect(securityLabel(doc, { security: [{}, { apiKey: [] }] })).toBe('Public')
        expect(securityLabel(doc, { security: [{ first: [], second: ['write'] }, { third: [] }] })).toBe('first + second (write) OR third')
    })
    it('makes every raw JSON character accessible without splitting surrogate pairs', () => {
        const value = { text: 'a😀b'.repeat(10000), nested: contract() }
        const pages = jsonChunks(value, 101)
        expect(pages.join('')).toBe(JSON.stringify(value, null, 2))
        expect(pages.every((page) => page.length <= 101 && !/[\uD800-\uDBFF]$/.test(page))).toBe(true)
        expect(jsonChunks(null)).toEqual(['null'])
        expect(() => jsonChunks(value, 0)).toThrow()
    })
    it('preserves pinned application docs and clearly fictional examples without inventing live receipts', () => {
        expect(documentationSource).toBe('a71de4414381d2dc11ae03d3a912dba96223e538')
        expect(applicationEndpoints).toHaveLength(36)
        expect(Object.keys(responseExamples)).toHaveLength(48)
        expect(new Set(applicationEndpoints.map((row) => `${row.method} ${row.path}`)).size).toBe(36)
        for (const row of applicationEndpoints) expect(responseExamples[`${row.method} ${row.path}`]).toBeDefined()
        expect(responseExamples['POST /organizations/:id/api-keys'].body).toMatchObject({ secret: 'example-not-a-valid-api-key' })
        expect(responseExamples['GET /ti/enrichment'].status).toBe(410)
    })
})

describe('visible request ownership', () => {
    it('rejects old successes and errors after hide, return, refresh or scope replacement', () => {
        const requests = new ReferenceRequests()
        const beforeHide = requests.start()
        expect(requests.canApply(beforeHide, true)).toBe(true)
        expect(requests.canApply(beforeHide, false)).toBe(false)
        requests.invalidate()
        expect(beforeHide.controller.signal.aborted).toBe(true)
        const afterReturn = requests.start()
        expect(requests.canApply(beforeHide, true)).toBe(false)
        expect(requests.canApply(afterReturn, true)).toBe(true)
        const refreshed = requests.start()
        expect(requests.canApply(afterReturn, true)).toBe(false)
        expect(requests.canApply(refreshed, true)).toBe(true)
        requests.invalidate()
        expect(requests.canApply(refreshed, true)).toBe(false)
    })
    it('keys scope on account, impersonation, workspace, target and mode', () => {
        const settings = { siteBaseUrl: 'https://hanasand.com', userId: 'user', authToken: 'token', impersonationToken: '', impersonatingUserId: '', selectedOrganizationId: '' } as AppSettings
        for (const field of ['siteBaseUrl', 'userId', 'authToken', 'impersonationToken', 'impersonatingUserId', 'selectedOrganizationId'])
            expect(referenceScope({ ...settings, [field]: 'changed' }, 'reference')).not.toBe(referenceScope(settings, 'reference'))
        expect(referenceScope(settings, 'json')).not.toBe(referenceScope(settings, 'reference'))
    })
    it('wires behavioral gates into focus, background, success, error and unmount paths', () => {
        const source = readFileSync(`${import.meta.dir}/../screens/ApiReferenceScreen.tsx`, 'utf8')
        expect(source).toContain('key={referenceScope(props.settings, props.mode)}')
        expect(source).toContain('requests.current.invalidate()')
        expect(source).toContain('AppState.addEventListener(\'change\'')
        expect(source.match(/canApply\(operation, visible\(\)\)/g)).toHaveLength(3)
        expect(source).toContain('focused.current = false; hide()')
        expect(source).toContain('mounted.current = false; requests.current.invalidate()')
        expect(source).toContain('onOpenGuide')
    })
})
