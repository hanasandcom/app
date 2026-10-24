import { expect, mock, test } from 'bun:test'
import type { AppSettings } from '../../types'
mock.module('../../lib/api', () => ({ apiFetch: () => { throw new Error('Unexpected real transport') } }))
const { VmController, VmIntents, vmIntentScope, operationKinds, requiredVmReads } = await import('./controller')
const { openVmConsole } = await import('./console')
const { scoped, parseVm } = await import('./model')
const settings = { userId: 'synthetic-user', authToken: 'synthetic-token', apiBaseUrl: 'https://api.hanasand.com/api', siteBaseUrl: 'https://hanasand.com', selectedOrganizationId: 'personal', impersonationToken: '', impersonatingUserId: '' } as AppSettings
const allReads = { inventory: true, target: true, management: true, platform: true, products: true, details: true, services: true }
function unlocked(s = settings, registry = new VmIntents()) {
    const c = new VmController(s, registry); c.visible = true
    const read = c.beginRead(c.generation, false, 'synthetic-vm')!
    c.finishRead(read, { target: read.target, authorized: true, reads: allReads }); return c
}
function opening(controller = unlocked()) {
    const review = controller.review(controller.generation, 'console', 'synthetic-vm', true)!
    return { controller, operation: controller.begin(review, 'operation-one')! }
}
const machine = (state = 'Running') => scoped(settings, parseVm({ name: 'synthetic-vm', owner: settings.userId, status: state }))
const permission = (canManage = true) => scoped(settings, { name: 'synthetic-vm', canManage, services: [] })
const nonce = '11111111-1111-1111-1111-111111111111'
const tick = () => new Promise(resolve => setTimeout(resolve, 2))
test('a completed inventory can switch targets while slower optional reads are still pending', () => {
    const controller = new VmController(settings, new VmIntents()); controller.visible = true
    const read = controller.beginRead(controller.generation, false, '')!
    const signal = read.signal
    expect(controller.switchTarget(read.generation)).toBe(true)
    expect(signal.aborted).toBe(true)
    expect(controller.reading).toBe(false)
    expect(controller.locked).toBe(true)
    expect(controller.context(controller.generation)).toBe(true)
})
class Socket {
    readyState = 0; bufferedAmount = 0; sent: string[] = []; closes = 0
    onopen: (() => void) | null = null; onmessage: ((event: { data: unknown }) => void) | null = null
    onclose: ((event: { code: number }) => void) | null = null; onerror: (() => void) | null = null
    send(data: string) { this.sent.push(data) } close() { this.closes++; this.readyState = 3 }
    open() { this.readyState = 1; this.onopen?.() }
    message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }) }
}
function fixture(options: { status?: string; manage?: boolean; overrides?: Parameters<typeof openVmConsole>[4] } = {}) {
    const { controller, operation } = opening(), socket = new Socket(), urls: string[] = [], proofs: string[][] = [], starts: string[] = []
    const channel = openVmConsole(settings, controller, operation, nonce, {
        ...options.overrides,
        dependencies: {
            loadVm: async () => machine(options.status), loadPublicServices: async () => permission(options.manage),
            power: async (_s, _vm, _p, action) => { starts.push(action); return { status: 200, payload: { accepted: true } } },
            proof: async (token, method, url) => { proofs.push([token, method, url]); return { proof: 'synthetic-proof' } },
            socket: url => { urls.push(url); return socket },
            ...options.overrides?.dependencies,
        },
    })
    return { channel, controller, operation, socket, urls, proofs, starts }
}
test('minimal intent scopes normalize service/personal context and survive token refresh/component replacement', () => {
    const registry = new VmIntents(), a = unlocked(settings, registry)
    const operation = a.begin(a.review(a.generation, 'power', 'synthetic-vm')!, 'one')!
    a.finish(operation, false); a.hide()
    const next = { ...settings, authToken: 'rotated', apiBaseUrl: 'https://API.hanasand.com:443/api/' }
    expect(vmIntentScope(next)).toBe(vmIntentScope(settings))
    const b = new VmController(next, registry); b.visible = true
    expect(b.unknown).toEqual({ token: 'one', kind: 'power', target: 'synthetic-vm' }); expect(b.locked).toBe(true)
    expect(new VmController({ ...settings, selectedOrganizationId: 'other' }, registry).unknown).toBeUndefined()
    expect(new VmController({ ...settings, userId: 'other' }, registry).unknown).toBeUndefined()
    expect(new VmController({ ...settings, impersonatingUserId: 'other' }, registry).unknown).toBeUndefined()
})
test('every action remains uncertain across remount and cannot be acknowledged by denied/failed/automatic/wrong-target reads', () => {
    for (const kind of operationKinds) {
        const registry = new VmIntents(), c = unlocked(settings, registry)
        const operation = c.begin(c.review(c.generation, kind, 'synthetic-vm', true)!, `operation-${kind.replaceAll('_', '-')}`)!
        c.finish(operation, false); c.hide()
        const next = new VmController({ ...settings, authToken: 'rotated' }, registry); next.visible = true
        for (const [manual, authorized, target, reads] of [[false, true, 'synthetic-vm', allReads], [true, false, 'synthetic-vm', allReads], [true, true, 'wrong', allReads], [true, true, 'synthetic-vm', { ...allReads, inventory: false }]] as const) {
            const read = next.beginRead(next.generation, manual, 'selected-other')!
            next.finishRead(read, { target, authorized, reads }); expect(next.canAcknowledge).toBe(false); expect(next.acknowledge(next.generation, operation.token)).toBe(false)
        }
        const read = next.beginRead(next.generation, true, 'selected-other')!
        expect(read.target).toBe('synthetic-vm')
        next.finishRead(read, { target: 'synthetic-vm', authorized: true, reads: allReads })
        expect(next.canAcknowledge).toBe(true); expect(next.acknowledge(next.generation, operation.token)).toBe(true)
    }
})
test('operation-specific review requires management/products/platform/details/services as appropriate', () => {
    for (const [kind, required] of [['power', 'management'], ['checkout', 'products'], ['delete', 'platform'], ['restore', 'platform'], ['stop_all', 'platform'], ['collect', 'details'], ['service_add', 'services'], ['console', 'management']] as const) {
        expect(requiredVmReads(kind, { ...allReads, [required]: false })).toBe(false)
    }
    expect(requiredVmReads('create', { ...allReads, target: false })).toBe(false)
})
test('registry strips unexpected data, refuses capacity and rejects old receipt CAS', () => {
    const registry = new VmIntents(1)
    registry.claim('a', { token: 'one', kind: 'sudo', target: 'synthetic-vm', password: 'never-store', output: 'never-store' } as never)
    expect(Object.keys(registry.get('a')!)).toEqual(['token', 'kind', 'target'])
    expect(registry.claim('b', { token: 'two', kind: 'power', target: 'synthetic-vm' })).toBe(false)
    expect(registry.clear('a', 'wrong')).toBe(false); expect(registry.clear('a', 'one')).toBe(true)
    registry.claim('a', { token: 'two', kind: 'power', target: 'synthetic-vm' }); expect(registry.clear('a', 'one')).toBe(false)
})
test('generation/native target guards reject queued old inputs and Alerts after submit/read/context; ordinary edits preserve host', () => {
    const c = unlocked(), oldHost = c.generation, review = c.review(oldHost, 'power', 'synthetic-vm')!
    expect(c.edit(oldHost)).toBe(true); expect(c.edit(oldHost)).toBe(true); expect(c.generation).toBe(oldHost)
    expect(c.begin(review, 'old-confirmation')).toBeNull()
    const targets = new Map<number, () => boolean>([[oldHost, () => c.edit(oldHost)]])
    const operation = c.begin(c.review(c.generation, 'power', 'synthetic-vm')!, 'one')!
    expect(targets.get(oldHost)!()).toBe(false)
    targets.delete(oldHost); targets.set(c.generation, () => c.edit(c.generation))
    c.finish(operation, true)
    const read = c.beginRead(c.generation, false, 'synthetic-vm')!; c.finishRead(read, { target: read.target, authorized: true, reads: allReads })
    expect(targets.get(oldHost)).toBeUndefined(); expect(c.edit(c.generation)).toBe(true)
    const confirmation = c.review(c.generation, 'power', 'synthetic-vm')!; c.context(c.generation)
    expect(c.begin(confirmation, 'old-context')).toBeNull()
})
test('fresh authority awaits cannot authorize a hidden/new-context mutation and private data clears', async () => {
    const c = unlocked(); let clears = 0; c.onClearPrivate(() => { clears++ })
    const op = c.begin(c.review(c.generation, 'sudo', 'synthetic-vm')!, 'one')!
    let release!: (v: boolean) => void
    const pending = c.fresh(op, () => new Promise<boolean>(resolve => { release = resolve }), value => value)
    const previous = clears; c.hide(); release(true)
    expect(await pending).toBeNull(); expect(op.signal.aborted).toBe(true); expect(clears).toBe(previous + 1)
    expect(c.finish(op, true)).toBe(false); expect(c.unknown?.token).toBe('one')
})
test('both impersonation states cannot review actions and settings changes close current private context', () => {
    for (const settingsChange of [{ impersonationToken: 'imp' }, { impersonatingUserId: 'other' }]) {
        const c = unlocked({ ...settings, ...settingsChange }); expect(c.review(c.generation, 'power', 'synthetic-vm')).toBeNull()
    }
    const c = unlocked(); let clears = 0; c.onClearPrivate(() => { clears++ }); c.updateSettings({ ...settings, authToken: 'rotated' })
    expect(c.visible).toBe(false); expect(clears).toBe(1)
})
test('console requires explicit reviewed possible-start permission; no connection on controller creation/focus', () => {
    const c = unlocked()
    expect(c.review(c.generation, 'console', 'synthetic-vm')).toBeNull()
    const op = c.begin(c.review(c.generation, 'power', 'synthetic-vm')!, 'one')!
    expect(() => openVmConsole(settings, c, op, nonce)).toThrow('Review')
})
test('console signs HTTPS upgrade target once, uses WSS without query/headers and sends credentials only in auth frame', async () => {
    const f = fixture(); const events: unknown[] = []
    f.channel.subscribe(event => events.push(event)); expect(events[0]).toMatchObject({ type: 'state', state: 'connecting' })
    await tick(); expect(f.proofs).toEqual([['synthetic-token', 'GET', 'https://api.hanasand.com/api/ws/vm/synthetic-vm/console']])
    expect(f.urls).toEqual(['wss://api.hanasand.com/api/ws/vm/synthetic-vm/console']); expect(f.channel.id).not.toContain(settings.authToken)
    expect(f.channel.input('early')).toBe(false)
    f.socket.open(); f.socket.onopen?.(); expect(f.socket.sent.length).toBe(1)
    expect(JSON.parse(f.socket.sent[0])).toEqual({ type: 'auth', id: settings.userId, token: settings.authToken, dpop: 'synthetic-proof' })
    f.socket.message({ type: 'ready', username: 'synthetic-vm' }); await f.channel.opened
    const latest: unknown[] = []; const unsubscribe = f.channel.subscribe(event => latest.push(event)); expect(latest[0]).toMatchObject({ type: 'state', state: 'ready' }); unsubscribe()
    expect(f.channel.input('\u0003')).toBe(true); expect(JSON.parse(f.socket.sent.at(-1)!)).toEqual({ type: 'input', data: '\u0003' })
    f.channel.resize(120, 40); expect(JSON.parse(f.socket.sent.at(-1)!)).toEqual({ type: 'resize', cols: 120, rows: 40 })
    f.channel.close(); expect(f.channel.input('late')).toBe(false); expect(f.socket.closes).toBe(1)
})
test('reviewed opening starts a newly stopped VM only after fresh manageable access, and never syncs SSH automatically', async () => {
    const f = fixture({ status: 'Stopped' }); await tick()
    expect(f.starts).toEqual(['start']); expect(f.urls.length).toBe(1)
    f.socket.open(); f.socket.message({ type: 'ready', username: 'synthetic-vm' }); await f.channel.opened; f.channel.close()
    const denied = fixture({ status: 'Stopped', manage: false }); await expect(denied.channel.opened).rejects.toThrow('permission')
    expect(denied.starts).toEqual([]); expect(denied.urls).toEqual([])
})
test('hide during permission await or proof creation prevents late socket creation, and keeps unknown opening metadata', async () => {
    for (const phase of ['permission', 'proof'] as const) {
        let release!: () => void
        const pending = new Promise<void>(resolve => { release = resolve })
        const f = fixture({ overrides: { dependencies: phase === 'permission' ? { loadPublicServices: async () => { await pending; return permission() } } : { proof: async () => { await pending; return { proof: 'late-proof' } } } } })
        await tick(); f.controller.hide(); release()
        await expect(f.channel.opened).rejects.toThrow(); await tick()
        expect(f.urls).toEqual([]); expect(f.controller.unknown?.kind).toBe('console')
    }
})
test('auth rejection/malformed or foreign-ready frames close once, clear private results and never reconnect', async () => {
    for (const value of [{ type: 'ready', username: 'foreign' }, { type: 'error', message: 'do-not-leak' }, { type: 'unknown' }]) {
        let clears = 0
        const f = fixture({ overrides: { onClear: () => { clears++ } } }); await tick(); f.socket.open(); f.socket.message(value)
        await expect(f.channel.opened).rejects.toMatchObject({ uncertain: true })
        expect(f.socket.closes).toBe(1); expect(f.urls.length).toBe(1); expect(clears).toBe(1)
        expect(f.channel.input('late')).toBe(false)
        const state: unknown[] = []; f.channel.subscribe(event => state.push(event)); expect(state[0]).toMatchObject({ state: 'closed' })
        expect(JSON.stringify(state)).not.toContain('do-not-leak')
    }
})
test('raw terminal bytes stay raw, output is bounded/queued, boot stream stays separate and hide discards queued/late output', async () => {
    let boot = '', cleared = false
    const f = fixture({ overrides: { onBootOutput: data => { boot += data }, onClear: () => { cleared = true; boot = '' } } })
    await tick(); f.socket.open(); f.socket.message({ type: 'ready', username: 'synthetic-vm' }); await f.channel.opened
    const raw = '\u001b[31mred\u001b[0m\u001b]52;c;not-a-clipboard-bridge\u0007'
    f.socket.message({ type: 'output', data: raw }); f.socket.message({ type: 'boot-output', data: 'serial-only' })
    const output: string[] = []; f.channel.subscribe(event => { if (event.type === 'output') output.push(event.data) }); await tick()
    expect(output.join('')).toBe(raw); expect(boot).toBe('serial-only')
    const late = f.socket.onmessage; f.controller.hide(); late?.({ data: JSON.stringify({ type: 'output', data: 'private-late' }) }); await tick()
    expect(output.join('')).toBe(raw); expect(boot).toBe(''); expect(cleared).toBe(true)
})
test('socket input/resize/backpressure and output/frame limits are enforced', async () => {
    const f = fixture(); await tick(); f.socket.open(); f.socket.message({ type: 'ready', username: 'synthetic-vm' }); await f.channel.opened
    const before = f.socket.sent.length
    f.channel.resize(501, 40); f.channel.resize(100, 7); f.channel.resize(30.5, 40); expect(f.socket.sent.length).toBe(before)
    expect(f.channel.input('a'.repeat(16385))).toBe(false)
    f.socket.bufferedAmount = 1048577; expect(f.channel.input('x')).toBe(false); expect(f.socket.closes).toBe(1)
    const q = fixture(); await tick(); q.socket.open()
    for (let i = 0; i < 6; i++) q.socket.message({ type: 'output', data: 'a'.repeat(200000) })
    await expect(q.channel.opened).rejects.toMatchObject({ uncertain: true }); expect(q.socket.closes).toBe(1)
    const bad = fixture(); await tick(); bad.socket.open(); bad.socket.onmessage?.({ data: 'a'.repeat(262145) })
    await expect(bad.channel.opened).rejects.toMatchObject({ uncertain: true })
})
test('prepare/proof/ready/inactivity deadlines are bounded without automatic connection retries', async () => {
    const prepare = fixture({ overrides: { deadlines: { prepare: 3 }, dependencies: { loadVm: async () => new Promise(() => {}) } } })
    await expect(prepare.channel.opened).rejects.toThrow('timed out'); expect(prepare.urls).toEqual([])
    const proof = fixture({ overrides: { deadlines: { proof: 3 }, dependencies: { proof: async () => new Promise(() => {}) } } })
    await expect(proof.channel.opened).rejects.toThrow('authentication timed out'); expect(proof.urls).toEqual([])
    const ready = fixture({ overrides: { deadlines: { ready: 3 } } }); await expect(ready.channel.opened).rejects.toThrow('did not become ready'); expect(ready.urls.length).toBe(1)
    const idle = fixture({ overrides: { deadlines: { inactivity: 3 } } }); await tick(); idle.socket.open(); idle.socket.message({ type: 'ready', username: 'synthetic-vm' }); await idle.channel.opened; await new Promise(resolve => setTimeout(resolve, 6)); expect(idle.socket.closes).toBe(1)
})
test('accepted channel survives caller receipt settlement but closes on next context/read and never reuses connection id', async () => {
    const f = fixture(); await tick(); f.socket.open(); f.socket.message({ type: 'ready', username: 'synthetic-vm' }); await f.channel.opened
    expect(f.controller.finish(f.operation, true)).toBe(true); expect(f.channel.input('still-connected')).toBe(true)
    f.controller.beginRead(f.controller.generation, true, 'synthetic-vm'); expect(f.channel.input('closed-by-refresh')).toBe(false)
    const next = fixture(); await tick(); expect(next.channel.id).not.toBe(f.channel.id); next.channel.close()
})

test('power awaits require renewed management before opening a console, and aged proof preparation cannot bypass fresh authority', async () => {
    let observations = 0
    const changed = fixture({ status: 'Stopped', overrides: { dependencies: { loadPublicServices: async () => permission(++observations === 1) } } })
    await expect(changed.channel.opened).rejects.toMatchObject({ uncertain: true })
    expect(changed.starts).toEqual(['start']); expect(observations).toBe(2); expect(changed.urls).toEqual([])
    const grant = permission(); let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const aged = fixture({ overrides: { dependencies: { loadPublicServices: async () => grant, proof: async () => { await pending; return { proof: 'late' } } } } })
    await tick(); grant.checkedAt = Date.now() - 31000; release()
    await expect(aged.channel.opened).rejects.toMatchObject({ uncertain: false }); expect(aged.urls).toEqual([])
})
test('output chunks preserve surrogate pairs and native input rate limits do not enqueue automatic replay', async () => {
    const f = fixture(); await tick(); f.socket.open(); f.socket.message({ type: 'ready', username: 'synthetic-vm' }); await f.channel.opened
    const chunks: string[] = []; f.channel.subscribe(event => { if (event.type === 'output') chunks.push(event.data) })
    const data = 'a'.repeat(8191) + '😀' + 'end'; f.socket.message({ type: 'output', data }); await tick()
    expect(chunks.join('')).toBe(data); expect(chunks[0]).toBe('a'.repeat(8191))
    for (let i = 0; i < 256; i++) expect(f.channel.input('x')).toBe(true)
    const sent = f.socket.sent.length; expect(f.channel.input('not-queued')).toBe(false)
    await tick(); expect(f.socket.sent.length).toBe(sent); f.channel.close()
})
test('installed React Native AbortController closes and clears console without unsupported signal methods', async () => {
    const { AbortController: NativeController } = await import('abort-controller'), old = globalThis.AbortController
    globalThis.AbortController = NativeController as unknown as typeof AbortController
    try {
        const f = fixture(); await tick(); f.socket.open(); f.socket.message({ type: 'ready', username: 'synthetic-vm' }); await f.channel.opened
        f.controller.hide(); expect(f.socket.closes).toBe(1); expect(f.channel.input('late')).toBe(false)
    } finally { globalThis.AbortController = old }
})

test('closed state is synchronously current even for a subscriber installed from private cleanup', async () => {
    const session: { current?: ReturnType<typeof openVmConsole> } = {}
    const states: string[] = []
    const f = fixture({ overrides: { onClear: () => { session.current?.subscribe(event => { if (event.type === 'state') states.push(event.state) }) } } })
    session.current = f.channel; await tick(); f.channel.close()
    expect(states).toEqual(['closed'])
})
