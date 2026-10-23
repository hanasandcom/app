import { beforeEach, expect, mock, test } from 'bun:test'
import type { AppSettings } from '../types'
import type { LoadSocket } from './load-test-live'
const calls: { settings: AppSettings; url: string; init: RequestInit }[] = []
let response: () => Promise<Response> = async () => new Response('{}')
mock.module('./api', () => ({ apiFetch: async (settings: AppSettings, input: string, init: RequestInit) => { calls.push({ settings, url: String(input), init }); return response() } }))
const api = await import('./load-tests')
const live = await import('./load-test-live')
const settings = { apiBaseUrl: 'https://api.synthetic.invalid/api', siteBaseUrl: 'https://synthetic.invalid', userId: 'synthetic-account', authToken: 'synthetic-token', impersonationToken: '', impersonatingUserId: '', selectedOrganizationId: 'synthetic-org' } as AppSettings
const row = (change: Record<string, unknown> = {}) => ({ id: 'scan-1', url: 'https://endpoint.invalid/', status: 'done', logs: [], errors: [], timeout: 30, stages: [{ duration: '30s', target: 1 }], summary: {}, ...change })
const quota = { plan: 'free', limit: 5, used: 2, remaining: 3, resetsAt: null }
const signal = () => new AbortController().signal
const reply = (value: unknown, status = 200) => { response = async () => new Response(JSON.stringify(value), { status }) }
beforeEach(() => { calls.length = 0; reply({}) })

test('history uses exact account transport, finite limit and no visit mutations', async () => {
    reply([row()]); const result = await api.loadTestHistory(settings, 'mine', signal())
    expect(result).toHaveLength(1); expect(calls[0].url).toBe('https://api.synthetic.invalid/api/tests/mine?limit=50')
    expect(calls[0].settings).toBe(settings)
    expect(calls[0].init).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store' })
    expect(calls[0].url).not.toContain('visits')
    reply([]); expect(await api.loadTestHistory(settings, 'recent', signal())).toEqual([])
})
test('invalid list and detail are errors, never empty success or a different scan', async () => {
    for (const value of [{}, { tests: [] }, [row(), row()], [row({ id: '../bad' })]]) {
        reply(value); await expect(api.loadTestHistory(settings, 'recent', signal())).rejects.toThrow()
    }
    reply(row({ id: 'other' })); await expect(api.loadTestResult(settings, 'scan-1', signal())).rejects.toThrow('different')
    reply(null); await expect(api.loadTestResult(settings, 'scan-1', signal())).rejects.toThrow('missing')
})
test('missing metrics remain null; real zero remains zero and actual med is preserved', () => {
    const parsed = api.parseLoadTest(row({ summary: { requests: 0, failureRate: 0, duration: { med: 4, p95: 9 } }, p95_delta_ms: -3 }))
    expect(parsed.summary.requests).toBe(0); expect(parsed.summary.checks).toBeNull()
    expect(parsed.summary.failureRate).toBe(0); expect(parsed.summary.duration.med).toBe(4)
    expect(parsed.summary.duration.p50).toBeNull(); expect(parsed.p95Delta).toBe(-3)
    expect(parsed.previous).toBeNull(); expect(parsed.summary.series).toEqual([])
})
test('series retain only supplied numeric fields, are bounded, and carry no invented zeros', () => {
    const parsed = api.parseLoadSummary({ latency: [{ time: 1, p50: 4 }, { time: 2, p95: 8 }], rps: Array.from({ length: 400 }, (_, time) => ({ time, value: 1 })) })
    expect(parsed.series[0].points).toHaveLength(300)
    expect(parsed.series[1].points[0].values).toEqual({ p50: 4 })
    expect(parsed.series[1].points[1].values).toEqual({ p95: 8 })
})
test('launch preserves supported presets and validates before any request', async () => {
    for (const preset of api.loadPresets) expect(api.validateLoadDraft({ ...preset, url: 'endpoint.invalid/#fragment' }).url).toBe('https://endpoint.invalid/')
    for (const change of [{ url: 'file:///tmp/no' }, { url: 'https://user:password@endpoint.invalid' }, { timeout: 0 }, { stages: [] }, { stages: [{ duration: '601s', target: 1 }] }, { stages: [{ duration: '10s', target: 101 }] }]) {
        await expect(api.createLoadTest(settings, { url: 'https://endpoint.invalid', timeout: 30, stages: [{ duration: '10s', target: 1 }], ...change }, signal())).rejects.toThrow()
    }
    expect(calls).toHaveLength(0)
})
test('create sends exact normalized payload and parses server allowance receipt', async () => {
    reply({ ...row({ status: 'queued' }), quota })
    const result = await api.createLoadTest(settings, { url: 'endpoint.invalid', timeout: 45, stages: [{ duration: '30s', target: 5 }] }, signal())
    expect(result.quota?.remaining).toBe(3); expect(result.test.status).toBe('queued')
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ url: 'https://endpoint.invalid/', timeout: 45, stages: [{ duration: '30s', target: 5 }] })
})
test('quota402 is known denial and never converted into another submission', async () => {
    reply({ quota: { ...quota, remaining: 0 } }, 402)
    try { await api.createLoadTest(settings, { ...api.loadPresets[0], url: 'https://endpoint.invalid' }, signal()); throw new Error('Expected denial') }
    catch (cause) { expect(cause).toBeInstanceOf(api.LoadTestError); const error = cause as InstanceType<typeof api.LoadTestError>; expect(error.status).toBe(402); expect(error.uncertain).toBe(false); expect(error.quota?.remaining).toBe(0) }
    expect(calls).toHaveLength(1)
})
test('rerun uses empty body and encoded existing ID;409 is known running state', async () => {
    reply({ ok: true, status: 'queued' }); await api.rerunLoadTest(settings, '.scan:one@account', signal())
    expect(calls[0].url).toEndWith('/test/.scan%3Aone%40account/rerun'); expect(calls[0].init.body).toBe('{}')
    reply({ error: 'already running' }, 409)
    try { await api.rerunLoadTest(settings, 'scan-1', signal()) } catch (cause) { expect((cause as InstanceType<typeof api.LoadTestError>).uncertain).toBe(false) }
    expect(calls).toHaveLength(2)
})
test('transport,500 and malformed success receipts lock outcome without retry', async () => {
    const failures = [async () => { throw new Error('Synthetic transport loss') }, async () => new Response('{}', { status: 500 }), async () => new Response('{}')]
    for (const failure of failures) {
        response = failure
        try { await api.rerunLoadTest(settings, 'scan-1', signal()); throw new Error('Expected uncertainty') }
        catch (cause) { expect((cause as InstanceType<typeof api.LoadTestError>).uncertain).toBe(true) }
    }
    expect(calls).toHaveLength(3)
})
test('no write leaves device during either impersonation state or pre-abort', async () => {
    for (const changed of [{ impersonationToken: 'synthetic-impersonation' }, { impersonatingUserId: 'other' }]) await expect(api.rerunLoadTest({ ...settings, ...changed }, 'scan-1', signal())).rejects.toThrow('read-only')
    const controller = new AbortController(); controller.abort()
    await expect(api.rerunLoadTest(settings, 'scan-1', controller.signal)).rejects.toThrow('before submission')
    expect(calls).toHaveLength(0)
})
test('late aborted body is rejected and uses compatible AbortController forwarding', async () => {
    const controller = new AbortController()
    response = async () => ({ ok: true, status: 200, text: async () => { controller.abort(); return JSON.stringify(row()) } } as Response)
    await expect(api.loadTestResult(settings, 'scan-1', controller.signal)).rejects.toThrow('interrupted')
    expect(calls).toHaveLength(1)
})
test('endpoint and ID validation excludes credentials, traversal and query injection', async () => {
    for (const id of ['.', '..', '../scan', 'scan%2fnext', 'scan?x', 'scan\\x']) await expect(api.loadTestResult(settings, id, signal())).rejects.toThrow('valid')
    for (const base of ['http://synthetic.invalid/api', 'https://user:pw@synthetic.invalid/api', 'https://synthetic.invalid/api?token=x']) expect(() => api.loadEndpoint(base, 'test')).toThrow()
    expect(calls).toHaveLength(0)
})
test('output and response limits are explicit and bounded', async () => {
    const output = api.boundLoadOutput(Array.from({ length: 600 }, () => 'x'.repeat(9000)))
    expect(output.limited).toBe(true); expect(output.rows.length).toBeLessThanOrEqual(500)
    expect(output.rows.join('').length).toBeLessThanOrEqual(128 * 1024)
    reply({ x: 'x'.repeat(2 * 1024 * 1024) }); await expect(api.loadTestQuota(settings, signal())).rejects.toThrow('limit')
})
test('manual read tickets cannot reconcile a newer unknown write or be consumed twice', () => {
    let operation = 4, serial = 10
    const ticket = { operation, serial }
    expect(api.canReconcileLoad(ticket, operation, serial)).toBe(true)
    serial++; expect(api.canReconcileLoad(ticket, operation, serial)).toBe(false)
    operation++; expect(api.canReconcileLoad(ticket, operation, 10)).toBe(false)
    expect(api.canReconcileLoad(null, operation, serial)).toBe(false)
})
class Socket implements LoadSocket {
    onopen: (() => void) | null = null
    onclose: (() => void) | null = null
    onerror: (() => void) | null = null
    onmessage: ((event: { data: unknown }) => void) | null = null
    closed = false
    close() { this.closed = true }
    event(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }) }
}
test('public live join sends no credentials/auth frame, stops on abort and never reconnects', () => {
    const socket = new Socket(), urls: string[] = [], events: unknown[] = [], controller = new AbortController()
    const stop = live.joinLoadTestLive(settings, 'scan-1', controller.signal, { status: () => {}, error: () => {}, event: event => events.push(event) }, url => { urls.push(url); return socket })
    expect(urls).toEqual(['wss://api.synthetic.invalid/api/ws/test/scan-1'])
    expect(urls[0]).not.toContain(settings.authToken)
    socket.event({ type: 'join', participants: 2 }); expect(events).toHaveLength(1)
    const late = socket.onmessage; controller.abort(); stop()
    late?.({ data: JSON.stringify({ type: 'update', data: { type: 'log', message: 'late' } }) })
    expect(events).toHaveLength(1); expect(socket.closed).toBe(true); expect(urls).toHaveLength(1)
})
test('live events validate frames and preserve done/failure metrics', () => {
    for (const value of ['{', new ArrayBuffer(2), JSON.stringify({ type: 'join', participants: -1 }), '💡'.repeat(20000)]) expect(() => live.parseLoadLiveEvent(value)).toThrow()
    const event = live.parseLoadLiveEvent(JSON.stringify({ type: 'update', data: { type: 'done', code: 1, durationMs: 200, summary: { requests: 5 } } }))
    const next = live.applyLoadLive(api.parseLoadTest(row()), event)
    expect(next.status).toBe('failed'); expect(next.summary.requests).toBe(5); expect(next.summary.failureRate).toBeNull(); expect(next.durationMs).toBe(200)
})
test('stream errors terminate this explicit join rather than reconnect or mutate result silently', () => {
    const socket = new Socket(), errors: string[] = []
    live.joinLoadTestLive(settings, 'scan-1', signal(), { status: () => {}, event: () => {}, error: error => errors.push(error) }, () => socket)
    socket.onmessage?.({ data: '{' }); expect(socket.closed).toBe(true); expect(errors).toHaveLength(1)
    expect(socket.onmessage).toBeNull()
})
test('native targets renew across operation/structural boundaries while ordinary typing remains stable', async () => {
    let generation = 0, host = 0, value = 'draft'
    const targets = new Map<number, (input: string) => void>()
    const commit = () => { targets.clear(); const captured = generation; targets.set(host, input => { if (api.canEditLoad({ active: true, pending: false, locked: false, generation }, captured)) value = input }); return host }
    const before = commit(); targets.get(before)?.('typed'); expect(value).toBe('typed')
    generation++; host++; commit(); targets.get(before)?.('late'); expect(value).toBe('typed')
    const screen = await Bun.file(new URL('../screens/LoadTestsScreen.tsx', import.meta.url)).text()
    const ui = await Bun.file(new URL('../components/LoadTestWorkspace.tsx', import.meta.url)).text()
    expect(ui).toContain('<TextInput key={nativeKey}')
    expect(screen).toContain('if (structural) renew()')
    expect(screen).toContain('canReconcileLoad(ticket, operation.current, serial.current)')
    expect(screen).toContain('Join public live output?')
    expect(screen).toContain('I have permission · Start')
    expect(screen).not.toContain('setInterval')
    expect(ui).not.toContain('?? 0')
})


test('legacy interval and millisecond timeout normalize without fabricated duration', () => {
    const parsed = api.parseLoadTest(row({ timeout: 30000, duration: { minutes: 1, seconds: 2, milliseconds: 5 } }))
    expect(parsed.timeout).toBe(30); expect(parsed.durationMs).toBe(62005)
    expect(api.loadDurationMs({})).toBeNull(); expect(api.loadDurationMs({ months: 1 })).toBeNull()
    expect(api.parseLoadSummary({ failureRate: 5, requests: -1 }).failureRate).toBeNull()
    expect(api.parseLoadSummary({ requests: -1 }).requests).toBeNull()
    expect(api.validateLoadDraft({ ...api.loadPresets[0], url: 'endpoint.invalid:8443/check' }).url).toBe('https://endpoint.invalid:8443/check')
})
test('bounded output keeps the latest content and does not discard newest lines first', () => {
    const result = api.boundLoadOutput([...Array.from({ length: 500 }, () => 'x'.repeat(8000)), 'Latest retained line'])
    expect(result.rows.at(-1)).toBe('Latest retained line')
    expect(result.limited).toBe(true)
})


test('done closes the explicit socket and a pre-aborted join opens nothing', () => {
    const socket = new Socket(), events: string[] = [], states: string[] = []
    live.joinLoadTestLive(settings, 'scan-1', signal(), { status: value => states.push(value), event: event => events.push(event.kind), error: () => {} }, () => socket)
    socket.event({ type: 'update', data: { type: 'done', code: 0, summary: {} } })
    expect(socket.closed).toBe(true); expect(events).toEqual(['done']); expect(states.at(-1)).toContain('finished')
    const controller = new AbortController(); controller.abort()
    live.joinLoadTestLive(settings, 'scan-1', controller.signal, { status: () => {}, event: () => {}, error: () => {} }, () => { throw new Error('No socket after cancellation') })
})
test('public stream session byte limit closes without retry or unlimited retained messages', () => {
    const socket = new Socket(), errors: string[] = []
    live.joinLoadTestLive(settings, 'scan-1', signal(), { status: () => {}, event: () => {}, error: value => errors.push(value) }, () => socket)
    for (let index = 0; index < 40; index++) socket.event({ type: 'update', data: { type: 'log', message: 'x'.repeat(60000) } })
    expect(socket.closed).toBe(true); expect(errors).toHaveLength(1); expect(errors[0]).toContain('session limit')
})


test('custom HTTPS HTTP transport receives explicit actor headers rather than relying on managed-domain injection', async () => {
    reply([row()])
    const custom = { ...settings, apiBaseUrl: 'https://configured.synthetic.invalid/api' }
    await api.loadTestHistory(custom, 'mine', signal())
    expect(calls[0].url).toBe('https://configured.synthetic.invalid/api/tests/mine?limit=50')
    const headers = new Headers(calls[0].init.headers)
    expect(headers.get('authorization')).toBe('Bearer synthetic-token')
    expect(headers.get('id')).toBe('synthetic-account')
    expect(headers.get('x-impersonation-token')).toBeNull()
    reply([row()])
    await api.loadTestHistory({ ...custom, impersonationToken: 'synthetic-delegation' }, 'recent', signal())
    expect(new Headers(calls[1].init.headers).get('x-impersonation-token')).toBe('synthetic-delegation')
    reply({ ok: true, status: 'queued' })
    await api.rerunLoadTest(custom, 'scan-1', signal())
    expect(new Headers(calls[2].init.headers).get('authorization')).toBe('Bearer synthetic-token')
    expect(new Headers(calls[2].init.headers).get('id')).toBe('synthetic-account')
    expect(calls[2].init.credentials).toBe('omit')
})


test('old native Refresh target cannot mint a manual reconciliation ticket after an unknown write', async () => {
    const state = { active: true, pending: false, reading: false, generation: 0 }
    let serial = 0, operation = 0, locked = false, mountedGeneration = -1, target = 0
    const targets = new Map<number, () => Promise<void>>()
    function commit() {
        if (mountedGeneration !== state.generation) { targets.delete(target); target++; mountedGeneration = state.generation }
        const captured = state.generation
        targets.set(target, async () => {
            if (!api.canReadLoadInput(state, captured)) return
            const ticket = { operation, serial: ++serial }
            await api.loadTestHistory(settings, 'mine', signal())
            if (api.canReconcileLoad(ticket, operation, serial)) { locked = false; serial++ }
        })
        return target
    }
    reply([])
    expect(locked).toBe(false)
    const before = commit(), capturedBeforeCommit = targets.get(before)!
    state.pending = true; state.generation++; operation++
    await capturedBeforeCommit(); expect(calls).toHaveLength(0)
    commit()
    locked = true; state.pending = false; state.generation++ // POST500 completed; new idle host.
    const fresh = commit()
    await targets.get(before)?.()
    expect(calls).toHaveLength(0); expect(locked).toBe(true)
    await targets.get(fresh)?.()
    expect(calls).toHaveLength(1); expect(locked).toBe(false)
    const source = await Bun.file(new URL('../screens/LoadTestsScreen.tsx', import.meta.url)).text()
    expect(source).toContain('key={`refresh:${hostRevision}`}')
    expect(source).toContain('if (readableInput()) void refresh(true)')
    expect(source).toContain('pending.current || manual && !readableInput()')
})
