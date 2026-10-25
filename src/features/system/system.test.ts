import { beforeEach, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { AppSettings } from '../../types'
import { AbortController as NativeAbortController } from 'abort-controller'
const calls: { url: string; init: RequestInit }[] = []
let handler: (url: string, init: RequestInit) => Promise<Response>
mock.module('../../lib/api', () => ({ apiFetch: async (_settings: AppSettings, url: string, init: RequestInit) => { calls.push({ url, init }); return handler(url, init) } }))
const api = await import('./api'), m = await import('./model'), { SystemController, SystemIntents } = await import('./controller'), { watchSystem } = await import('./live')
const settings = { apiBaseUrl: 'https://api.hanasand.com/api', siteBaseUrl: 'https://hanasand.com', userId: 'synthetic-user', authToken: 'synthetic-token', selectedOrganizationId: 'personal', impersonationToken: '', impersonatingUserId: '' } as AppSettings
const id = 'a'.repeat(64), otherId = 'b'.repeat(64), signal = () => new AbortController().signal
const container = (change = {}) => ({ id, name: 'synthetic-api', state: 'running', health: 'healthy', stats: { cpu_percent: 0, memory_bytes: 0, memory_limit_bytes: 1024, memory_percent: 0 }, ports: [{ private_port: 8080, type: 'tcp' }], ...change })
const snapshot = (change = {}) => ({ generated_at: new Date().toISOString(), systemTelemetry: { system: { load: [0, 1, 2], memory: { used: 0, total: 1024, percent: '0.00' } } }, dockerTelemetry: { containers: [container()], generated_at: new Date().toISOString(), source: 'docker_engine' }, vms: [], ...change })
const storage = (change = {}) => ({ cacheBytes: 0, reclaimableCacheBytes: 0, checkedAt: new Date().toISOString(), running: false, queued: false, stale: false, unusedImages: [], ...change })
const access = () => ({ scope: m.systemScope(settings), canRead: true, canWrite: true })
const response = (v: unknown, status = 200) => { handler = async () => Response.json(v, { status }) }
beforeEach(() => { calls.length = 0; response({ allowed: true, canEdit: true }) })
test('permission discovery uses direct Identity and explicit authenticated custom-host transport', async () => {
    expect(await api.loadAccess(settings, signal())).toEqual(access())
    expect(calls[0].url).toBe('https://identity.hanasand.com/api/management/organizations?internalPages=1')
    const custom = { ...settings, apiBaseUrl: 'https://synthetic.invalid/api' }
    await api.loadAccess(custom, signal())
    expect(calls[1].url).toStartWith(custom.apiBaseUrl)
    expect(new Headers(calls[1].init.headers).get('authorization')).toBe(`Bearer ${settings.authToken}`)
    expect(new Headers(calls[1].init.headers).get('id')).toBe(settings.userId)
    expect(calls[1].init.credentials).toBe('omit')
    response({ allowed: true }); await expect(api.loadAccess(settings, signal())).rejects.toThrow('incomplete')
})
test('actual zero remains zero; absent telemetry and invalid envelopes never turn into empty success', () => {
    const s = m.parseTelemetry(snapshot())
    expect(s.load[0]).toBe(0); expect(s.memoryUsed).toBe(0); expect(s.containers[0].cpu).toBe(0); expect(s.vmCount).toBe(0)
    expect(m.parseTelemetry(snapshot({ vms: undefined })).vmCount).toBeNull()
    expect(m.parseContainers([container({ stats: null })]).containers[0].cpu).toBeNull()
    for (const v of [null, {}, snapshot({ dockerTelemetry: {} }), snapshot({ dockerTelemetry: { containers: [container(), container()] } })]) expect(() => m.parseTelemetry(v)).toThrow()
    expect(m.parseStorage(storage()).cache).toBe(0)
    expect(m.parseStorage(storage({ checkedAt: '2000-01-01' })).stale).toBe(true)
})
test('snapshot/storage use only existing Core routes and preserve unavailable source metadata', async () => {
    response(snapshot()); await api.loadTelemetry(settings, signal()); expect(calls[0].url).toEndWith('/system/snapshot')
    response(storage()); await api.loadStorage(settings, signal()); expect(calls[1].url).toEndWith('/system/storage')
    response({ generated_at: new Date().toISOString(), logs: [], runtime_available: false, native_available: false, source: 'docker_engine', unavailable_reason: 'Synthetic unavailable' })
    expect((await api.loadRuntimeLogs(settings, 'synthetic-api', signal())).reason).toBe('Synthetic unavailable')
    expect(calls[2].url).toEndWith('/logs/realtime?limit=120&service=synthetic-api')
    expect(m.parseRuntimeLogs({ generated_at: new Date().toISOString(), logs: [], runtime_available: false, native_available: true }).native).toBe(true)
})
test('restart GET is treated as a mutation; exact receipt only, no automatic retry', async () => {
    response({ ok: true, detail: { message: 'accepted' } })
    await api.restartContainer(settings, access(), m.parseTelemetry(snapshot()), id, signal())
    expect(calls[0].url).toEndWith(`/restart/${id}`); expect(calls[0].init.method).toBe('GET'); expect(calls[0].init.cache).toBe('no-store')
    for (const v of [{}, { ok: true }, { ok: false, detail: {} }]) { response(v); await expect(api.restartContainer(settings, access(), m.parseTelemetry(snapshot()), id, signal())).rejects.toMatchObject({ uncertain: true }) }
    response({}, 500); const before = calls.length
    await expect(api.restartContainer(settings, access(), m.parseTelemetry(snapshot()), id, signal())).rejects.toMatchObject({ uncertain: true })
    expect(calls.length).toBe(before + 1)
})
test('mutation authority rejects both impersonation modes, stale snapshot, changed service and missing container before dispatch', async () => {
    for (const changed of [{ impersonationToken: 'synthetic' }, { impersonatingUserId: 'other' }, { authToken: 'changed' }]) await expect(api.restartContainer({ ...settings, ...changed }, access(), m.parseTelemetry(snapshot()), id, signal())).rejects.toThrow()
    await expect(api.restartContainer(settings, access(), m.parseTelemetry(snapshot({ generated_at: '2000-01-01' })), id, signal())).rejects.toThrow('Refresh')
    await expect(api.restartContainer(settings, access(), m.parseTelemetry(snapshot()), otherId, signal())).rejects.toThrow('Refresh')
    expect(calls.length).toBe(0)
})
test('cleanup POST has no body and requires exact queued202; busy/stale storage blocks', async () => {
    response({ queued: true }, 202); await api.clearStorage(settings, access(), m.parseStorage(storage()), signal())
    expect(calls[0].init.method).toBe('POST'); expect(calls[0].init.body).toBeUndefined()
    expect(calls[0].url).toEndWith('/system/storage/clear')
    response({ queued: true }); await expect(api.clearStorage(settings, access(), m.parseStorage(storage()), signal())).rejects.toMatchObject({ uncertain: true })
    for (const change of [{ running: true }, { queued: true }, { stale: true }]) await expect(api.clearStorage(settings, access(), m.parseStorage(storage(change)), signal())).rejects.toThrow('Refresh')
})
test('native abort polyfill/pre-abort and ignored body cancellation are bounded; interrupted restart unknown', async () => {
    const old = globalThis.AbortController; globalThis.AbortController = NativeAbortController as unknown as typeof AbortController
    try {
        const c = new AbortController(); c.abort(); await expect(api.loadAccess(settings, c.signal)).rejects.toThrow(); expect(calls.length).toBe(0)
        const never = new Promise<Response>(() => {})
        await expect(api.restartContainer(settings, access(), m.parseTelemetry(snapshot()), id, signal(), { transport: () => never, timeoutMs: 3 })).rejects.toMatchObject({ uncertain: true })
        const r = Response.json(snapshot()); r.text = () => new Promise(() => {})
        await expect(api.loadTelemetry(settings, signal(), { transport: async () => r, timeoutMs: 3 })).rejects.toThrow('interrupted')
    } finally { globalThis.AbortController = old }
})
test('unresolved actions survive replacement/token rotation and require current manual read plus explicit acknowledgement', () => {
    const registry = new SystemIntents(), scope = m.intentScope(settings), a = new SystemController(scope, registry); a.visible = true
    const intent = { token: 'one', kind: 'restart' as const, target: id }, write = a.beginWrite(0, intent)!
    a.hide()
    expect(m.intentScope({ ...settings, authToken: 'rotated', selectedOrganizationId: 'other-workspace' })).toBe(scope)
    const b = new SystemController(scope, registry); b.visible = true
    expect(b.locked).toBe(true); expect(a.finishWrite(write.generation, intent, true)).toBe(false)
    const auto = b.beginRead(b.generation, false)!; b.finishRead(auto.ticket, true, true); expect(b.canAcknowledge).toBe(false)
    const manual = b.beginRead(b.generation, true)!; b.finishRead(manual.ticket, true, true); expect(b.canAcknowledge).toBe(true)
    expect(b.acknowledge(b.generation - 1, intent.token)).toBe(false)
    expect(b.acknowledge(b.generation, intent.token)).toBe(true); expect(b.locked).toBe(false)
    expect(new SystemController(m.intentScope({ ...settings, userId: 'other' }), registry).unknown).toBeUndefined()
})
test('registry capacity is fail closed and old receipt cannot clear a newer intent', () => {
    const registry = new SystemIntents(1), a = new SystemController('one', registry); a.visible = true
    const first = a.beginWrite(0, { token: 'first', kind: 'cleanup', target: 'storage' })!
    expect(registry.claim('two', { token: 'second', kind: 'cleanup', target: 'storage' })).toBe(false)
    registry.clear('one', 'first'); registry.claim('one', { token: 'new', kind: 'cleanup', target: 'storage' })
    a.finishWrite(first.generation, first.intent, true)
    expect(registry.get('one')?.token).toBe('new')
})
class Socket {
    onopen: (() => void) | null = null; onmessage: ((e: { data: unknown }) => void) | null = null; onclose: ((e: { code: number }) => void) | null = null; onerror: (() => void) | null = null
    sent: string[] = []; closed = false
    send(v: string) { this.sent.push(v) } close() { this.closed = true }
}
test('live proof signs HTTPS target; one auth frame and no credentials in WSS URL, abort drops late messages', async () => {
    const socket = new Socket(), urls: string[] = [], signed: string[] = [], events: unknown[] = [], c = new AbortController()
    await watchSystem(settings, c.signal, { data: v => events.push(v), status: () => {}, error: () => {} }, url => { urls.push(url); return socket }, async (_token, method, url) => { signed.push(method, url); return { proof: 'synthetic-proof' } })
    socket.onopen?.(); expect(signed).toEqual(['GET', 'https://api.hanasand.com/api/ws/system'])
    expect(urls).toEqual(['wss://api.hanasand.com/api/ws/system']); expect(urls[0]).not.toContain(settings.authToken)
    expect(JSON.parse(socket.sent[0])).toEqual({ type: 'auth', id: settings.userId, token: settings.authToken, dpop: 'synthetic-proof' })
    const late = socket.onmessage; c.abort(); late?.({ data: JSON.stringify({ type: 'snapshot' }) })
    expect(events.length).toBe(0); expect(socket.closed).toBe(true)
})
test('1008 and invalid frames close without retry; stream values preserve independent VM inventory', async () => {
    const socket = new Socket(), failures: number[] = []; let connections = 0
    await watchSystem(settings, signal(), { data: () => {}, status: () => {}, error: e => failures.push(e.status) }, () => { connections++; return socket }, async () => ({ proof: 'proof' }))
    socket.onclose?.({ code: 1008 }); expect(failures).toEqual([403]); expect(connections).toBe(1)
    const next = m.applyLive(m.parseTelemetry(snapshot({ vms: [{ status: 'running' }] })), { type: 'snapshot', system: snapshot().systemTelemetry, docker: snapshot().dockerTelemetry })
    expect(next.vmCount).toBe(1); expect(next.runningVms).toBe(1)
})
test('actual screen binds native host generations and fresh authority before mutation without retry commands', () => {
    const source = readFileSync(fileURLToPath(import.meta.url).replace(/features\/system\/system.test.ts$/, 'screens/SystemScreen.tsx'), 'utf8')
    expect(source).toContain('key={`refresh:${captured}`}'); expect(source).toContain('ops.beginWrite(generation, intent)')
    expect(source.indexOf('await services.access(write.controller.signal)')).toBeLessThan(source.indexOf('await services.restart(permission'))
    expect(source).toContain('ops.acknowledge(generation, intent.token)'); expect(source).toContain('useFocusEffect')
    const ops = new SystemController('native-target'); ops.visible = true
    const old = ops.generation, handlers = new Map<number, () => unknown>([[old, () => ops.beginRead(old, true)]])
    ops.context(old); handlers.delete(old); expect(handlers.get(old)?.()).toBeUndefined(); expect(ops.beginRead(old, true)).toBeNull()
})
test('storage progress polling is visible-only, serialized and cannot reconcile uncertain writes', async () => {
    const { pollStorage } = await import('./storage-poll')
    const pending: { callback: () => void; ms: number }[] = []
    const scheduler = { later: (callback: () => void, ms: number) => { const t = { callback, ms }; pending.push(t); return t }, cancel: () => {} }
    let visible = true, busy = false, count = 0, seen = 0
    let value = m.parseStorage(storage({ queued: true }))
    let settle!: (v: typeof value) => void
    let requestSignal!: AbortSignal
    const stop = pollStorage({
        current: () => visible, busy: () => busy, value: () => value,
        load: async signal => { count++; requestSignal = signal; return new Promise(resolve => { settle = resolve }) },
        data: next => { value = next; seen++ }, error: () => {},
    }, scheduler)
    expect(pending[0].ms).toBe(1000)
    busy = true; pending.shift()!.callback(); expect(count).toBe(0)
    busy = false; pending.shift()!.callback(); expect(count).toBe(1)
    settle(m.parseStorage(storage())); await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(seen).toBe(1); expect(pending.at(-1)?.ms).toBe(10000)
    pending.shift()!.callback(); expect(count).toBe(2)
    visible = false; stop(); expect(requestSignal.aborted).toBe(true)
    settle(m.parseStorage(storage({ running: true }))); await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(seen).toBe(1)
})
test('untrusted URLs, invalid runtime names and oversized bodies fail with no fallback', async () => {
    for (const base of ['http://synthetic.invalid/api', 'https://user@synthetic.invalid/api', 'https://synthetic.invalid/api?x=1', 'https://synthetic.invalid/api#x']) {
        await expect(api.loadTelemetry({ ...settings, apiBaseUrl: base }, signal())).rejects.toThrow('secure')
    }
    expect(calls.length).toBe(0)
    await expect(api.loadRuntimeLogs(settings, 'bad\nname', signal())).rejects.toThrow('valid container')
    expect(calls.length).toBe(0)
    await expect(api.loadTelemetry(settings, signal(), { transport: async () => new Response('{}', { headers: { 'content-length': '4194305' } }) })).rejects.toThrow('4 MiB')
    const socket = new Socket(), failures: string[] = []
    await watchSystem(settings, signal(), { data: () => {}, status: () => {}, error: e => failures.push(e.message) }, () => socket, async () => ({ proof: 'proof' }))
    socket.onopen?.(); socket.onopen?.(); expect(socket.sent.length).toBe(1)
    socket.onmessage?.({ data: 'not json' }); expect(socket.closed).toBe(true); expect(failures).toEqual(['The live system frame was invalid.'])
})
test('hiding during local proof creation opens no socket; runtime entry truncation is explicit', async () => {
    const c = new AbortController(); let connections = 0
    const pending = watchSystem(settings, c.signal, { data: () => {}, status: () => {}, error: () => {} }, () => { connections++; return new Socket() }, () => new Promise(() => {}))
    c.abort(); await pending; expect(connections).toBe(0)
    const parsed = m.parseRuntimeLogs({ generated_at: new Date().toISOString(), runtime_available: true, native_available: true, logs: [{ id: 'entry', message: 'a'.repeat(16001) }] })
    expect(parsed.logs[0].message).toEndWith('[Entry truncated after 16,000 characters]')
})

test('denied internal visibility cannot acknowledge an existing uncertain action', () => {
    for (const kind of ['restart', 'cleanup'] as const) {
        const registry = new SystemIntents(), ops = new SystemController(`denied-${kind}`, registry)
        ops.visible = true
        const intent = { token: `uncertain-${kind}`, kind, target: kind === 'restart' ? id : 'docker-storage' }
        const write = ops.beginWrite(ops.generation, intent)!
        ops.finishWrite(write.generation, intent, false)
        const denied = ops.beginRead(ops.generation, true)!
        // Even a permission-discovery response is not a successful authorized runtime read.
        ops.finishRead(denied.ticket, true, false)
        expect(ops.canAcknowledge).toBe(false)
        expect(ops.acknowledge(ops.generation, intent.token)).toBe(false)
        expect(ops.locked).toBe(true)
        expect(ops.unknown).toEqual(intent)
        const permitted = ops.beginRead(ops.generation, true)!
        ops.finishRead(permitted.ticket, true, true)
        expect(ops.canAcknowledge).toBe(true)
    }
    const source = readFileSync(fileURLToPath(import.meta.url).replace(/features\/system\/system.test.ts$/, 'screens/SystemScreen.tsx'), 'utf8')
    expect(source).toContain('canRead = permission.canRead && permission.scope === systemScope(settings)')
    expect(source).toContain('if (!canRead) { setSnapshot(null); setStorage(null); return }')
    expect(source).toContain('ops.finishRead(read.ticket, complete, canRead)')
})
test('failed storage observations retain figures but block queued cleanup and an already-open confirmation', async () => {
    const { StorageObservation } = await import('./storage-observation')
    const observed = new StorageObservation(), idle = m.parseStorage(storage())
    observed.observe(idle); const review = observed.revision
    expect(observed.current(review)).toBe(idle)
    let resolvePermission!: () => void, dispatches = 0
    const permission = new Promise<void>(resolve => { resolvePermission = resolve })
    const attempt = async () => { await permission; if (observed.current(review)) dispatches++ }
    const pending = attempt()
    observed.unavailable() // Current polling request returned 503 during permission validation.
    expect(observed.current(review)).toBeNull()
    resolvePermission(); await pending; expect(dispatches).toBe(0)
    observed.observe(idle)
    expect(observed.current(review)).toBeNull() // A successful later read cannot revive the old Alert.
    expect(observed.current(observed.revision)).toBe(idle)
    observed.observe(m.parseStorage(storage({ running: true })))
    expect(observed.current(observed.revision)).toBeNull()
    const source = readFileSync(fileURLToPath(import.meta.url).replace(/features\/system\/system.test.ts$/, 'screens/SystemScreen.tsx'), 'utf8')
    expect(source).toContain('storageObservation.unavailable(); ops.forgetReview()\n                setStorageError')
    expect(source).toContain('kind === \'cleanup\' && !storageObservation.current(storageRevision)')
    expect(source).toContain('Storage figures changed while the confirmation was open. Refresh and review cleanup again.')
    expect(source.indexOf('await services.access(write.controller.signal)')).toBeLessThan(source.indexOf('const observed = storageObservation.current(storageRevision)'))
    expect(source).toContain('await services.cleanup(permission, observed, write.controller.signal)')
    expect(source).toContain('canWrite={writable && !!storageObservation.current(storageObservation.revision)}')
})

test('a new failed observation also invalidates an earlier manual uncertainty review', () => {
    const ops = new SystemController('review-observation', new SystemIntents()); ops.visible = true
    const intent = { token: 'uncertain', kind: 'cleanup' as const, target: 'docker-storage' }
    const write = ops.beginWrite(ops.generation, intent)!
    ops.finishWrite(write.generation, intent, false)
    const read = ops.beginRead(ops.generation, true)!
    ops.finishRead(read.ticket, true, true); expect(ops.canAcknowledge).toBe(true)
    ops.forgetReview(); expect(ops.canAcknowledge).toBe(false)
    expect(ops.acknowledge(ops.generation, intent.token)).toBe(false)
    expect(ops.unknown).toEqual(intent)
})
