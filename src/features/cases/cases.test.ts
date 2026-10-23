import { describe, expect, mock, test } from 'bun:test'
import type { AppSettings } from '../../types'
mock.module('../../lib/api', () => ({ apiFetch: () => { throw new Error('Tests must inject synthetic transport') } }))
const { caseServices } = await import('./api')
import { CaseController, CaseIntents, caseCallbackAllowed, caseReadComplete, type CaseIntent } from './controller'
import { CaseError, caseId, caseScope, changeBody, filterCases, intentScope, mergeIds, own, parseCase, parseRepository, safeUrl } from './model'
const settings = { apiBaseUrl: 'https://cases.invalid/api', siteBaseUrl: 'https://site.invalid', authToken: 'synthetic-token', userId: 'synthetic-user', selectedOrganizationId: 'org.1:@', impersonationToken: '', impersonatingUserId: '' } as AppSettings
const repoId = '12345678-abcd-1234-abcd-123456789abc'
const snapshot = '2026-10-23T10:00:00.000Z'
const fixture = (id = 'HA-1', extra: Record<string, unknown> = {}) => ({ id, source: 'monitoring', title: `Outage ${id}`, summary: 'Health check failed', status: 'open', severity: 'high', canManage: true, organizationId: settings.selectedOrganizationId, automationId: 'monitor1', notificationsEnabled: true, occurrences: 1, assignedOwner: 'synthetic-user', createdAt: snapshot, updatedAt: snapshot, lastSeenAt: snapshot, comments: [], history: [], resolution: null, notifications: [], relatedChecks: [], currentCheck: { endpoint: 'https://monitor.invalid/', checkType: 'http', timeoutSeconds: 10, retryCount: 1, followRedirects: true, expectedDown: false, upsideDown: false }, events: [{ id: 'run1', message: 'Result', outcome: 'failure', startedAt: snapshot }], eventTotal: 51, eventPage: 0, eventSnapshot: snapshot, ...extra })
const repository = (extra: Record<string, unknown> = {}) => ({ id: repoId, provider: 'forgejo', repository_url: 'https://git.invalid/org/repository', organization_id: settings.selectedOrganizationId, can_manage: true, ...extra })
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status })
type Call = { url: URL; init: RequestInit }
function service(handler: (call: Call) => Response | Promise<Response>, s = settings, timeoutMs = 1000) {
    const calls: Call[] = []
    const api = caseServices(s, { timeoutMs, transport: async (_, url, init) => { const c = { url: new URL(url), init }; calls.push(c); return handler(c) } })
    return { api, calls }
}
const signal = () => new AbortController().signal
const accessible = (c: CaseController) => { c.visible = true; const read = c.beginRead(c.generation, false)!; c.finishRead(read.ticket, true); return c }
const intent = (token = 'operation1', kind: CaseIntent['kind'] = 'update'): CaseIntent => ({ token, kind, target: 'HA-1' })
describe('monitoring contracts', () => {
    test('summary list uses direct Core, exact selected scope, custom-service actor headers and no cookie jar', async () => {
        const { api, calls } = service(() => json({ items: [fixture()] }))
        expect((await api.list(signal()))[0].id).toBe('HA-1')
        expect(calls[0].url.pathname).toBe('/api/cases/monitoring')
        expect(calls[0].url.searchParams.get('view')).toBe('summary')
        expect(calls[0].url.searchParams.get('organizationId')).toBe('org.1:@')
        expect(calls[0].init.credentials).toBe('omit')
        expect(calls[0].init.headers).toEqual({ Accept: 'application/json', Authorization: 'Bearer synthetic-token', id: 'synthetic-user' })
    })
    test('personal sentinel normalizes; foreign scope and missing fields never become empty success', async () => {
        const s = { ...settings, selectedOrganizationId: 'personal' }
        const { api, calls } = service(() => json({ items: [fixture('HA-1', { organizationId: null })] }), s)
        expect((await api.list(signal())).length).toBe(1)
        expect(calls[0].url.searchParams.has('organizationId')).toBe(false)
        expect(intentScope(s)).toBe(intentScope({ ...s, selectedOrganizationId: '' }))
        expect(() => parseCase(fixture('HA-1', { organizationId: 'foreign' }), settings)).toThrow()
        expect(() => parseCase(fixture('HA-1', { occurrences: undefined }), settings)).toThrow()
        const bad = service(() => json({})); await expect(bad.api.list(signal())).rejects.toThrow()
    })
    test('detail events preserve stable snapshot and page50, reject changed page/snapshot', async () => {
        const { api, calls } = service(() => json({ case: fixture('HA-1', { eventPage: 1 }) }))
        const c = await api.detail('MON-1', signal(), 1, snapshot)
        expect(() => parseCase(fixture('HA-1', { comments: undefined }), settings, true)).toThrow('incomplete')
        expect(c.eventPage).toBe(1); expect(calls[0].url.pathname).toBe('/api/cases/monitoring/HA-1')
        expect(calls[0].url.searchParams.get('eventsAt')).toBe(snapshot)
        await expect(api.detail('HA-1', signal(), 2, snapshot)).rejects.toThrow()
        await expect(api.detail('HA-1', signal(), 1)).rejects.toThrow()
        expect(() => caseId('HA-9223372036854775808')).toThrow()
    })
    test('PATCH validates full body, reloads authority first and accepts exact ok receipt', async () => {
        const { api, calls } = service(c => c.init.method === 'PATCH' ? json({ ok: true }) : json({ case: fixture() }))
        await api.update('HA-1', { status: 'resolved', comment: ' verified ', resolutionMethod: 'ai' }, signal(), () => true)
        expect(calls.map(v => v.init.method)).toEqual(['GET', 'PATCH'])
        expect(JSON.parse(String(calls[1].init.body))).toEqual({ status: 'resolved', comment: 'verified', resolutionMethod: 'ai' })
        expect(() => changeBody({ status: 'closed' })).toThrow()
        expect(() => changeBody({ confirmResolutionId: 'resolution', comment: 'extra' })).toThrow()
    })
    test('fresh denied authority, changed resolution and late context prevent dispatch', async () => {
        const denied = service(() => json({ case: fixture('HA-1', { canManage: false }) }))
        await expect(denied.api.update('HA-1', { severity: 'low' }, signal(), () => true)).rejects.toThrow()
        expect(denied.calls.length).toBe(1)
        let current = true
        const stale = service(() => { current = false; return json({ case: fixture() }) })
        await expect(stale.api.update('HA-1', { comment: 'text' }, signal(), () => current)).rejects.toThrow()
        expect(stale.calls.length).toBe(1)
        const resolution = service(() => json({ case: fixture('HA-1', { status: 'resolved', resolution: { id: 'new', type: 'ai' } }) }))
        await expect(resolution.api.update('HA-1', { confirmResolutionId: 'old' }, signal(), () => true)).rejects.toThrow()
        await resolution.api.update('HA-1', { confirmResolutionId: 'new' }, signal(), () => true).catch(() => {})
        expect(resolution.calls[2].init.method).toBe('PATCH')
    })
    test('both impersonation states block every mutation before network', async () => {
        for (const s of [{ ...settings, impersonationToken: 'synthetic-imp' }, { ...settings, impersonatingUserId: 'other' }]) {
            const { api, calls } = service(() => json({}), s)
            await expect(api.update('HA-1', { comment: 'text' }, signal(), () => true)).rejects.toThrow()
            await expect(api.merge('HA-1', ['HA-2'], signal(), () => true)).rejects.toThrow()
            await expect(api.connect('forgejo', 'https://git.invalid/r', signal(), () => true)).rejects.toThrow()
            await expect(api.disconnect(repoId, signal(), () => true)).rejects.toThrow()
            await expect(api.link('HA-1', repoId, 'a'.repeat(40), signal(), () => true)).rejects.toThrow()
            expect(calls.length).toBe(0); expect(own(s)).toBe(false)
        }
    })
    test('merge checks every current case group and exact receipt, never invents creation', async () => {
        const { api, calls } = service(c => c.init.method === 'POST' ? json({ ok: true, targetId: 'HA-1', mergedIds: ['HA-2'] }) : json({ case: fixture(c.url.pathname.endsWith('HA-2') ? 'HA-2' : 'HA-1') }))
        await api.merge('HA-1', ['HA-2'], signal(), () => true)
        expect(calls.at(-1)?.url.pathname).toBe('/api/cases/monitoring/merge')
        expect(JSON.parse(String(calls.at(-1)?.init.body))).toEqual({ targetId: 'HA-1', sourceIds: ['HA-2'] })
        expect(() => mergeIds('HA-1', ['HA-1'])).toThrow(); expect(() => mergeIds('HA-1', ['HA-2', 'HA-2'])).toThrow()
        const mismatch = service(c => json({ case: fixture(c.url.pathname.endsWith('HA-2') ? 'HA-2' : 'HA-1', { automationId: c.url.pathname.endsWith('HA-2') ? 'other' : 'monitor1' }) }))
        await expect(mismatch.api.merge('HA-1', ['HA-2'], signal(), () => true)).rejects.toThrow()
        expect(mismatch.calls.every(c => c.init.method === 'GET')).toBe(true)
        expect('create' in api).toBe(false)
    })
    test('development history offsets50 and opaque commit cursors are not rewritten', async () => {
        const cursor = 'a'.repeat(40)
        const { api, calls } = service(c => c.url.pathname.endsWith('commits') ? json({ items: [{ external_id: cursor, title: 'fix' }], nextCursor: cursor }) : json({ items: [], hasMore: true }))
        expect((await api.development('HA-1', 50, signal())).hasMore).toBe(true)
        expect(calls[0].url.searchParams.get('offset')).toBe('50')
        expect((await api.commits(repoId, 'author or title', cursor, signal())).nextCursor).toBe(cursor)
        expect(calls[1].url.searchParams.get('cursor')).toBe(cursor)
        expect(calls[1].url.searchParams.get('search')).toBe('author or title')
    })
    test('personal repository visible from org keeps personal DELETE scope', async () => {
        const { api, calls } = service(c => c.init.method === 'DELETE' ? json({ ok: true }) : json({ items: [repository({ organization_id: null })] }))
        await api.disconnect(repoId, signal(), () => true)
        expect(calls[0].url.searchParams.get('organizationId')).toBe(settings.selectedOrganizationId!)
        expect(calls[1].url.searchParams.has('organizationId')).toBe(false)
        expect(() => parseRepository(repository({ organization_id: 'foreign' }), settings)).toThrow()
    })
    test('connect verifies current org owner/admin and validates once-only secret receipt', async () => {
        const { api, calls } = service(c => c.init.method === 'GET' ? json({ organization: { id: settings.selectedOrganizationId, lifecycleStatus: 'active', role: 'admin' } }) : json({ id: repoId, secret: 'a'.repeat(64), webhookPath: `/api/cases/repository-events/${repoId}` }, 201))
        const receipt = await api.connect('forgejo', 'https://git.invalid/team/r', signal(), () => true)
        expect(receipt.webhookUrl).toBe(`https://cases.invalid/api/cases/repository-events/${repoId}`)
        expect(calls.map(c => c.init.method)).toEqual(['GET', 'POST'])
        expect(JSON.parse(String(calls[1].init.body))).toEqual({ provider: 'forgejo', repositoryUrl: 'https://git.invalid/team/r' })
        const denied = service(() => json({ organization: { id: settings.selectedOrganizationId, lifecycleStatus: 'active', role: 'reader' } }))
        await expect(denied.api.connect('github', 'https://git.invalid/r', signal(), () => true)).rejects.toThrow()
        expect(denied.calls.length).toBe(1)
        for (const url of ['http://git.invalid/r', 'https://u:p@git.invalid/r', 'https://git.invalid/r?secret=x']) expect(() => safeUrl(url)).toThrow()
    })
    test('commit link uses fresh accessible case and repository authority with the existing exact body', async () => {
        const hash = 'b'.repeat(40)
        const { api, calls } = service(c => c.url.pathname.includes('/monitoring/') ? json({ case: fixture() }) : c.init.method === 'GET' ? json({ items: [repository()] }) : json({ ok: true }))
        await api.link('HA-1', repoId, hash, signal(), () => true)
        expect(calls.map(c => c.init.method)).toEqual(['GET', 'GET', 'POST'])
        expect(JSON.parse(String(calls[2].init.body))).toEqual({ repositoryId: repoId, commit: hash, caseId: 'HA-1' })
        const denied = service(c => c.url.pathname.includes('/monitoring/') ? json({ case: fixture() }) : json({ items: [repository({ can_manage: false })] }))
        await expect(denied.api.link('HA-1', repoId, hash, signal(), () => true)).rejects.toThrow()
        expect(denied.calls.every(c => c.init.method === 'GET')).toBe(true)
    })
    test('secret receipt missing after successful connect is uncertain and response limits reject oversized payloads', async () => {
        const s = { ...settings, selectedOrganizationId: 'personal' }
        const incomplete = service(() => json({ id: repoId }, 201), s)
        try { await incomplete.api.connect('github', 'https://git.invalid/r', signal(), () => true) } catch (e) { expect(e instanceof CaseError && e.uncertain).toBe(true) }
        expect(incomplete.calls.length).toBe(1)
        const oversized = service(() => new Response('{}', { headers: { 'content-length': String(9 * 1024 * 1024) } }))
        await expect(oversized.api.list(signal())).rejects.toThrow('8 MiB')
        expect(() => intentScope({ ...settings, apiBaseUrl: 'http://invalid' })).not.toThrow()
        expect(() => caseScope({ ...settings, selectedOrganizationId: '/' })).not.toThrow()
        const insecure = service(() => json({ items: [] }), { ...settings, apiBaseUrl: 'http://invalid' })
        await expect(insecure.api.list(signal())).rejects.toThrow('secure')
        expect(insecure.calls.length).toBe(0)
    })
    test('lost/5xx/malformed successful mutation receipts stay uncertain, 409 is definite', async () => {
        for (const result of [() => { throw new Error('lost') }, () => json({}, 502), () => json({ ok: false }), () => new Response('not-json')]) {
            const { api, calls } = service(c => c.init.method === 'PATCH' ? result() : json({ case: fixture() }))
            try { await api.update('HA-1', { comment: 'text' }, signal(), () => true); throw new Error('Expected rejection') } catch (e) { expect(e instanceof CaseError && e.uncertain).toBe(true) }
            expect(calls.filter(c => c.init.method === 'PATCH').length).toBe(1)
        }
        const failed = service(c => c.init.method === 'PATCH' ? json({}, 409) : json({ case: fixture() }))
        try { await failed.api.update('HA-1', { comment: 'x' }, signal(), () => true) } catch (e) { expect(e instanceof CaseError && e.status === 409 && !e.uncertain).toBe(true) }
    })
    test('native-compatible cancellation/deadline includes body and never dispatches preaborted', async () => {
        const abort = new AbortController(); abort.abort()
        const stopped = service(() => json({}))
        await expect(stopped.api.list(abort.signal)).rejects.toThrow(); expect(stopped.calls.length).toBe(0)
        const hanging = service(() => new Response(new ReadableStream({ start() {} })), settings, 5)
        await expect(hanging.api.list(signal())).rejects.toThrow('interrupted')
        const duringWrite = service(c => c.init.method === 'PATCH' ? new Response(new ReadableStream({ start() {} })) : json({ case: fixture() }), settings, 5)
        try { await duringWrite.api.update('HA-1', { comment: 'x' }, signal(), () => true) } catch (e) { expect(e instanceof CaseError && e.uncertain).toBe(true) }
    })
    test('installed React Native AbortController works without AbortSignal.any or throwIfAborted', async () => {
        const { AbortController: NativeController } = await import('abort-controller')
        const previous = globalThis.AbortController
        globalThis.AbortController = NativeController as unknown as typeof AbortController
        try {
            const { api } = service(() => json({ items: [fixture()] }))
            expect((await api.list(signal()))[0].id).toBe('HA-1')
            const hanging = service(() => new Promise<Response>(() => {}), settings, 5)
            await expect(hanging.api.list(signal())).rejects.toThrow('interrupted')
        } finally { globalThis.AbortController = previous }
    })
    test('status/severity/search/human review filters retain actual rows', () => {
        const a = parseCase(fixture(), settings), b = parseCase(fixture('HA-2', { status: 'resolved', resolution: { id: 'r', type: 'ai' } }), settings)
        expect(filterCases([a, b], '', 'active', 'all', false).map(c => c.id)).toEqual(['HA-1'])
        expect(filterCases([a, b], 'outage', 'all', 'high', true).map(c => c.id)).toEqual(['HA-2'])
        const confirmed = parseCase(fixture('HA-3', { status: 'resolved', resolution: { id: 'r2', type: 'ai', confirmedAt: snapshot } }), settings)
        expect(filterCases([a, b, confirmed], '', 'all', 'all', 'confirmed').map(c => c.id)).toEqual(['HA-3'])
        expect(filterCases([a], '', 'all', 'all', 'all', 'unassigned')).toEqual([])
    })
})
describe('scoped operation lifecycle and actual callback guards', () => {
    test('registry survives A→B→A, token refresh, component replacement and late old result', () => {
        const registry = new CaseIntents(), a = accessible(new CaseController(intentScope(settings), registry)), value = intent()
        const write = a.beginWrite(a.generation, value)!
        a.hide()
        const b = accessible(new CaseController(intentScope({ ...settings, selectedOrganizationId: 'other' }), registry))
        expect(b.unknown).toBeUndefined()
        const next = accessible(new CaseController(intentScope({ ...settings, authToken: 'refreshed' }), registry))
        expect(next.unknown).toEqual(value)
        expect(caseScope(settings)).not.toBe(caseScope({ ...settings, authToken: 'refreshed' }))
        expect(a.finishWrite(write.generation, value, true)).toBe(false)
        expect(next.unknown).toEqual(value)
        expect(next.beginWrite(next.generation, intent('new'))).toBeNull()
        expect(Object.keys(next.unknown!)).toEqual(['token', 'kind', 'target'])
    })
    test('automatic, failed, denied and older manual reads cannot acknowledge unknown', () => {
        const registry = new CaseIntents(), a = accessible(new CaseController('a', registry)), value = intent()
        const w = a.beginWrite(a.generation, value)!; a.finishWrite(w.generation, value, false)
        for (const [manual, success] of [[false, true], [true, false]] as const) { const r = a.beginRead(a.generation, manual)!; a.finishRead(r.ticket, success); expect(a.canAcknowledge).toBe(false) }
        const fresh = a.beginRead(a.generation, true)!; a.finishRead(fresh.ticket, true)
        expect(a.canAcknowledge).toBe(true)
        const old = a.generation; a.context(old)
        expect(a.acknowledge(old, value.token)).toBe(false)
        expect(a.canAcknowledge).toBe(false)
        const again = a.beginRead(a.generation, true)!; a.finishRead(again.ticket, true)
        expect(a.acknowledge(a.generation, value.token)).toBe(true); expect(a.unknown).toBeUndefined()
    })
    test('native target renewal and precommit captured callbacks reject write/end/hidden/context changes', () => {
        const a = accessible(new CaseController('a', new CaseIntents())), context = { selected: 'HA-1', panel: 'overview', repository: '' }
        let nextTarget = 0, currentTarget = 0
        const listeners = new Map<number, () => boolean>()
        const mount = () => { listeners.delete(currentTarget); currentTarget = ++nextTarget; const g = a.generation; listeners.set(currentTarget, () => caseCallbackAllowed(a, g, context, context)); return currentTarget }
        const oldTarget = mount(), capturedCallback = listeners.get(oldTarget)!
        expect(capturedCallback()).toBe(true)
        // Ordinary text changes do not renew a controller generation or host.
        const unchangedGeneration = a.generation; expect(listeners.get(oldTarget)!()).toBe(true); expect(a.generation).toBe(unchangedGeneration)
        expect(caseCallbackAllowed(a, unchangedGeneration, context, context, 'comment A', 'comment B')).toBe(false)
        const w = a.beginWrite(a.generation, intent())!
        expect(capturedCallback()).toBe(false) // precommit old handler
        mount(); expect(listeners.has(oldTarget)).toBe(false) // postcommit RN getListener(oldTarget)
        a.finishWrite(w.generation, intent(), true); const r = a.beginRead(a.generation, false)!; a.finishRead(r.ticket, true); mount()
        expect(listeners.get(oldTarget)).toBeUndefined()
        expect(caseCallbackAllowed(a, a.generation, context, { ...context, panel: 'development' })).toBe(false)
        expect(caseCallbackAllowed(a, a.generation, context, context)).toBe(true)
        a.hide(); expect(caseCallbackAllowed(a, a.generation, context, context)).toBe(false)
    })
    test('required successful read sets are operation-specific; denied optional repository cannot hide an authorized case', () => {
        const full = { list: true, detail: true, repositories: true, development: true, connection: true }
        expect(caseReadComplete('update', { ...full, repositories: false, development: false })).toBe(true)
        expect(caseReadComplete('disconnect', { ...full, repositories: false })).toBe(false)
        expect(caseReadComplete('link', { ...full, development: false })).toBe(false)
        expect(caseReadComplete('connect', { ...full, connection: false })).toBe(false)
        expect(caseReadComplete('merge', { ...full, detail: false })).toBe(false)
    })
    test('real screen bindings renew native action/input hosts and use tested confirmation/read guards', async () => {
        const screen = await Bun.file(new URL('../../screens/CasesScreen.tsx', import.meta.url)).text()
        const input = await Bun.file(new URL('./ui.tsx', import.meta.url)).text()
        expect(screen).toContain('key={`case-controls:${host}`}')
        expect(screen).toContain('key={`refresh:${host}`}')
        expect(screen).toContain('caseCallbackAllowed(ops, generation, context, current.current, fingerprint, JSON.stringify(drafts.current))')
        expect(screen).toContain('complete = caseReadComplete(unknown?.kind,')
        expect(input).toContain('key={`${label}:${host}`}')
        expect(input).toContain('editable={ops.idle(host) && !ops.unknown && !disabled}')
    })
    test('bounded registry never evicts unresolved intent, CAS cannot clear newer action', () => {
        const r = new CaseIntents(1); expect(r.claim('a', intent())).toBe(true); expect(r.claim('b', intent('b'))).toBe(false)
        expect(r.clear('a', 'wrong')).toBe(false); expect(r.clear('a', 'operation1')).toBe(true)
        expect(r.claim('a', intent('new'))).toBe(true); expect(r.clear('a', 'operation1')).toBe(false)
    })
})
