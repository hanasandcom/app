import { describe, expect, test } from 'bun:test'
import type { AppSettings } from '../../types'
import { createThesisApi, ThesisError } from './api'
import { createThesisLive, type ThesisSocket } from './live'
import { createRecovery, initializeRecovery, recoveryController, type RecoveryAdapter, type ThesisRecovery } from './recovery'

const settings = { userId: 'synthetic', authToken: 'synthetic-token', apiBaseUrl: 'https://thesis.invalid/api', siteBaseUrl: 'https://thesis.invalid', impersonationToken: '', impersonatingUserId: '' } as AppSettings
const draft = { title: 'Synthetic', body: 'Private draft', revision: 1 }
describe('Thesis transport and encrypted recovery', () => {
    test('passes exact API credentials and fixed global scope, no automatic save retry', async () => {
        const requests: { url: string; init: RequestInit; settings: AppSettings }[] = []
        const api = createThesisApi({ ...settings, selectedOrganizationId: 'cashflow' }, async (s, url, init) => {
            requests.push({ settings: s, url, init })
            return Response.json({ ...draft, body: 'Remote', revision: 2 }, { status: 409 })
        })
        await expect(api.save(draft, new AbortController().signal)).rejects.toBeInstanceOf(ThesisError)
        expect(requests).toHaveLength(1)
        expect(requests[0].url).toBe('https://thesis.invalid/api/thesis')
        expect(requests[0].settings.selectedOrganizationId).toBeUndefined()
        expect(new Headers(requests[0].init.headers).get('Authorization')).toBe('Bearer synthetic-token')
    })
    test('both impersonation states reject before request', async () => {
        let calls = 0
        for (const extra of [{ impersonationToken: 'x' }, { impersonatingUserId: 'x' }]) {
            await expect(createThesisApi({ ...settings, ...extra }, async () => { calls++; return Response.json(draft) }).load(new AbortController().signal)).rejects.toThrow()
        }
        expect(calls).toBe(0)
    })
    test('source review uses website origin and validates its exact receipt', async () => {
        const node = { id: 'source:one', title: 'One', file: 'one.ts', kind: 'source' as const, sha256: 'a'.repeat(64), reviewHash: 'b'.repeat(64), dependencies: [], dependencyCount: 0, unresolved: [] }
        const event = '11111111-1111-4111-8111-111111111111'
        const api = createThesisApi(settings, async (_, url, init) => {
            expect(url).toBe('https://thesis.invalid/api/thesis/code')
            expect(new Headers(init.headers).get('Origin')).toBe('https://thesis.invalid')
            return Response.json({ event_id: event, item_id: node.id, content_hash: node.sha256, review_hash: node.reviewHash, approved: true, reviewer: 'synthetic', reviewed_at: '2026-10-23T00:00:00Z' })
        })
        expect((await api.review(node, true, event, new AbortController().signal)).item_id).toBe(node.id)
    })
    test('socket signs HTTPS upgrade then sends one bounded auth frame only', async () => {
        const sent: string[] = []; let closed = false; let received = ''
        const socket: ThesisSocket = { onopen: null, onmessage: null, onclose: null, onerror: null, send: text => { sent.push(text) }, close: () => { closed = true } }
        const signal = new AbortController()
        const stop = await createThesisLive(url => { expect(url).toBe('wss://thesis.invalid/api/ws/thesis'); return socket }, async (_, method, url) => { expect(method).toBe('GET'); expect(url).toBe('https://thesis.invalid/api/ws/thesis'); return { proof: 'synthetic-proof' } })(settings, signal.signal, doc => { received = doc.body }, () => {})
        socket.onopen?.()
        expect(JSON.parse(sent[0])).toEqual({ type: 'auth', id: 'synthetic', token: 'synthetic-token', dpop: 'synthetic-proof' })
        socket.onmessage?.({ data: JSON.stringify(draft) }); expect(received).toBe('Private draft')
        signal.abort(); expect(closed).toBe(true); expect(sent).toHaveLength(1)
        stop()
    })
    test('AES-GCM recovery serializes alternating snapshots and binds account/service AAD', async () => {
        const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
        const slots = new Map<number, string>(); const writes: number[] = []
        const adapter: RecoveryAdapter = {
            async read(slot) { return slots.get(slot) ?? null },
            async write(slot, sealed) { writes.push(slot); slots.set(slot, sealed) },
            async seal(bytes, aad) { const iv = crypto.getRandomValues(new Uint8Array(12)); const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new Uint8Array(aad) }, key, new Uint8Array(bytes)); return Buffer.concat([iv, Buffer.from(sealed)]).toString('base64') },
            async open(value, aad) { const bytes = Buffer.from(value, 'base64'); return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: new Uint8Array(aad) }, key, bytes.subarray(12))) },
        }
        const store = createRecovery('account:A/service:A', adapter)
        await Promise.all([store.save(draft), store.save({ ...draft, body: 'Latest' }, true)])
        expect(writes).toEqual([1, 0])
        expect((await store.load())?.draft?.body).toBe('Latest')
        expect((await store.load())?.uncertain).toBe(true)
        expect([...slots.values()].join('')).not.toContain('Private draft')
        expect(await createRecovery('account:B/service:A', adapter).load()).toBeNull()
        slots.set(0, 'corrupted')
        expect((await store.load())?.draft?.body).toBe('Private draft')
        await store.save(null); expect((await store.load())?.draft).toBeNull()
    })
    test('pending recovery survives clean remote plus repeated live and lifecycle persistence until explicit choice', async () => {
        const writes: unknown[] = []
        const candidate = { version: 1 as const, scope: 'synthetic', sequence: 4, savedAt: 123, uncertain: true, draft }
        const storage = { async load() { return candidate }, async save(value: unknown) { writes.push(value) } }
        const controller = recoveryController(storage)
        const remote = { ...draft, body: 'Clean remote', revision: 9 }
        await controller.persist(null) // live arrives before recovery inspection finishes
        expect(await controller.inspect(remote)).toBe(candidate)
        await controller.persist(null) // refresh completion
        await controller.persist(null) // live snapshot
        await controller.persist(null) // blur/background cleanup
        expect(writes).toEqual([])
        expect(await storage.load()).toBe(candidate)
        controller.decide()
        await controller.persist(null) // explicit keep-shared decision
        expect(writes).toEqual([null])
    })
    test('late initialization cannot attach the old account store to a new scope', async () => {
        let epoch = 1
        let finishOld!: (store: ThesisRecovery) => void
        const oldWrites: unknown[] = [], newWrites: unknown[] = []
        const old = initializeRecovery(() => new Promise(resolve => { finishOld = resolve }), draft, () => epoch === 1)
        epoch = 2
        const latest = await initializeRecovery(async () => ({ async load() { return null }, async save(value) { newWrites.push(value) } }), draft, () => epoch === 2)
        finishOld({ async load() { return null }, async save(value) { oldWrites.push(value) } })
        expect(await old).toBeNull()
        await latest!.controller.persist({ ...draft, body: 'New account draft' })
        expect(oldWrites).toEqual([])
        expect(newWrites).toHaveLength(1)
    })
    test('a candidate matching a later current draft is still surfaced as a pending decision', async () => {
        let finish!: (value: import('./recovery').RecoveredDraft) => void
        let writes = 0
        const candidate = { version: 1 as const, scope: 'synthetic', sequence: 3, savedAt: 123, uncertain: true, draft }
        const initializing = initializeRecovery(async () => ({ load: () => new Promise(resolve => { finish = resolve }), async save() { writes++ } }), { ...draft, body: 'Old service snapshot' }, () => true)
        await Promise.resolve()
        // A live snapshot may now match candidate.draft. Its returned pending decision
        // still must be shown; equality cannot silently detach the UI from the gate.
        finish(candidate)
        const initialized = await initializing
        expect(initialized?.candidate).toBe(candidate)
        await initialized!.controller.persist(null)
        expect(writes).toBe(0)
        initialized!.controller.decide()
        await initialized!.controller.persist(null)
        expect(writes).toBe(1)
    })
    test('pre-abort sends no request and dispatched PUT deadline is uncertain with no retry', async () => {
        let calls = 0
        const api = createThesisApi(settings, async () => { calls++; return new Promise<Response>(() => {}) }, 2)
        const pre = new AbortController(); pre.abort()
        try { await api.save(draft, pre.signal); throw new Error('Expected cancellation') } catch (cause) { expect((cause as ThesisError).submitted).toBe(false) }
        expect(calls).toBe(0)
        try { await api.save(draft, new AbortController().signal); throw new Error('Expected timeout') } catch (cause) { expect((cause as ThesisError).submitted).toBe(true) }
        expect(calls).toBe(1)
    })
    test('deadline covers held response body and forwards external cancellation', async () => {
        let inner: AbortSignal | null = null
        const api = createThesisApi(settings, async (_, __, init) => {
            inner = init.signal as AbortSignal
            return { ok: true, status: 200, text: () => new Promise<string>(() => {}) } as Response
        }, 2)
        await expect(api.load(new AbortController().signal)).rejects.toThrow('timed out')
        expect(inner!.aborted).toBe(true)
        const external = new AbortController()
        const waiting = api.load(external.signal); external.abort()
        await expect(waiting).rejects.toThrow()
        expect(inner!.aborted).toBe(true)
    })
})
