import { beforeEach, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { AppSettings } from '../types'
const requests: Array<{ settings: AppSettings; input: string; init: RequestInit; transport: typeof fetch }> = []
mock.module('expo/fetch', () => ({ fetch: () => { throw new Error('Real network is forbidden in synthetic tests.') } }))
mock.module('./api', () => ({ apiFetch: async (settings: AppSettings, input: string, init: RequestInit, transport: typeof fetch) => { requests.push({ settings, input, init, transport }); return transport(input, init) } }))
const { createTrafficSseParser, openTrafficStream, parseTrafficBatch, TrafficStreamError } = await import('./traffic-stream')
const { locatedTrafficCountries, countryCentroids, trafficWorldPaths, projectTrafficPoint } = await import('../data/traffic-geography')
const settings = { apiBaseUrl: 'https://traffic.synthetic.invalid/api', userId: 'fixture', authToken: 'fixture-session', selectedOrganizationId: 'fixture-org' } as AppSettings
const batch = (id = '12', iso = 'NO', count = 2) => [{ iso, count, max_id: id, timestamp: '2026-10-23 03:00:00+00' }]
const callbacks = () => ({ onReady: () => {}, onBatch: () => {} })
const bytes = (value: string) => new TextEncoder().encode(value)
function streamFixture() {
    let source!: ReadableStreamDefaultController<Uint8Array>, canceled = false
    const body = new ReadableStream<Uint8Array>({ start(controller) { source = controller }, cancel() { canceled = true } })
    const transport = (async () => new Response(body, { headers: { 'content-type': 'text/event-stream; charset=utf-8' } })) as unknown as typeof fetch
    return { source: () => source, transport, canceled: () => canceled }
}
beforeEach(() => { requests.length = 0 })

test('SSE parser handles fragmented CRLF, comments, multiline data and dispatches only complete events', () => {
    const events: Array<{ event: string; data: string }> = [], parser = createTrafficSseParser(event => events.push(event))
    for (const fragment of [': heartbeat\r', '\nevent: ready\r\ndata: {"status":', '"connected"}\r\n\r', '\nevent: traffic\ndata: [\ndata: {"iso":"NO"}\ndata: ]\n\n', 'data: incomplete']) parser.push(fragment)
    expect(events).toEqual([{ event: 'ready', data: '{"status":"connected"}' }, { event: 'traffic', data: '[\n{"iso":"NO"}\n]' }])
})
test('SSE buffer, line, event and chunk sizes are bounded before unbounded accumulation', () => {
    for (const value of ['x'.repeat(33000), 'x'.repeat(262145)]) expect(() => createTrafficSseParser(() => {}).push(value)).toThrow(TrafficStreamError)
    const parser = createTrafficSseParser(() => {})
    expect(() => { for (let i = 0; i < 4; i++) parser.push(`data: ${'x'.repeat(20000)}\n`) }).toThrow('limit')
})
test('batch parser validates counts, unique country groups, exact safe cursor and explicit-zone timestamps', () => {
    expect(parseTrafficBatch(JSON.stringify(batch()))[0]).toEqual({ iso: 'NO', count: 2, max_id: '12', timestamp: '2026-10-23T03:00:00.000Z' })
    for (const value of [{}, [{ ...batch()[0], count: 0 }], [{ ...batch()[0], count: 1.2 }], batch('9007199254740992'), batch('001'), batch('2', 'UNKNOWN'), [...batch(), ...batch()], [...batch('1', 'NO', 600), ...batch('2', 'US', 600)], [{ ...batch()[0], timestamp: '2026-10-23 03:00:00' }]]) expect(() => parseTrafficBatch(JSON.stringify(value))).toThrow()
})
test('actual streaming read goes through apiFetch fourth transport with selected session and only GET/SSE headers', async () => {
    const fixture = streamFixture(), controller = new AbortController(); let ready = 0, received = 0
    const pending = openTrafficStream(settings, { domain: 'example.test:443', after: '10' }, { onReady: () => { ready++ }, onBatch: entries => { received += entries[0].count; controller.abort() } }, controller.signal, fixture.transport)
    fixture.source().enqueue(bytes(`event: ready\r\ndata: {"status":"connected"}\r\n\r\nevent: traffic\ndata: ${JSON.stringify(batch())}\n\n`))
    await expect(pending).rejects.toThrow(TrafficStreamError)
    expect(ready).toBe(1); expect(received).toBe(2); expect(fixture.canceled()).toBe(true)
    expect(requests).toHaveLength(1); expect(requests[0].settings).toBe(settings); expect(requests[0].transport).toBe(fixture.transport)
    const url = new URL(requests[0].input); expect(url.pathname).toBe('/api/traffic/live'); expect(url.searchParams.get('domain')).toBe('example.test:443'); expect(url.searchParams.get('after')).toBe('10')
    expect(requests[0].init.credentials).toBe('omit'); expect(requests[0].init.redirect).toBe('error'); expect(requests[0].init.body).toBeUndefined()
    expect(new Headers(requests[0].init.headers).get('accept')).toBe('text/event-stream'); expect(requests[0].init.signal?.aborted).toBe(true)
})
test('byte chunk boundaries preserve UTF-8; stale cursors never trigger duplicate live callbacks', async () => {
    const fixture = streamFixture(), controller = new AbortController(), received: string[] = []
    const pending = openTrafficStream(settings, { domain: '', after: '10' }, { onReady: () => {}, onBatch: entries => { received.push(entries[0].max_id); controller.abort() } }, controller.signal, fixture.transport)
    const body = bytes(`: Norwegian æ heartbeat\n\nevent: traffic\ndata: ${JSON.stringify(batch('10'))}\n\nevent: traffic\ndata: ${JSON.stringify(batch('11'))}\n\n`)
    for (const byte of body) fixture.source().enqueue(new Uint8Array([byte]))
    await expect(pending).rejects.toThrow(); expect(received).toEqual(['11'])
})
test('401/403 errors retain explicit status and do not retry or parse private error content', async () => {
    for (const status of [401, 403]) {
        requests.length = 0
        const transport = (async () => new Response('private-source-value', { status })) as unknown as typeof fetch
        try { await openTrafficStream(settings, { domain: '' }, callbacks(), new AbortController().signal, transport); throw new Error('Expected failure') } catch (error) {
            expect(error).toBeInstanceOf(TrafficStreamError); expect((error as InstanceType<typeof TrafficStreamError>).status).toBe(status); expect(String(error)).not.toContain('private-source-value')
        }
        expect(requests).toHaveLength(1)
    }
})
test('incorrect media type, stream failure, malformed frames and oversized byte chunks cancel without leaking payload', async () => {
    const wrongType = (async () => Response.json({ private: 'not-for-display' })) as unknown as typeof fetch
    await expect(openTrafficStream(settings, { domain: '' }, callbacks(), new AbortController().signal, wrongType)).rejects.toThrow('streaming is unavailable')
    for (const value of ['event: traffic-error\ndata: private-source-value\n\n', 'event: traffic\ndata: private-source-value\n\n', 'event: ready\ndata: {}\n\n']) {
        const fixture = streamFixture(), pending = openTrafficStream(settings, { domain: '' }, callbacks(), new AbortController().signal, fixture.transport)
        fixture.source().enqueue(bytes(value)); await expect(pending).rejects.toThrow(); expect(fixture.canceled()).toBe(true)
    }
    const fixture = streamFixture(), pending = openTrafficStream(settings, { domain: '' }, callbacks(), new AbortController().signal, fixture.transport)
    fixture.source().enqueue(new Uint8Array(262145)); await expect(pending).rejects.toThrow('limit'); expect(fixture.canceled()).toBe(true)
})
test('pre-aborted and invalid cursor/scope requests make no fetch; external abort stops a pending read', async () => {
    const already = new AbortController(); already.abort()
    await expect(openTrafficStream(settings, { domain: '' }, callbacks(), already.signal)).rejects.toThrow()
    for (const input of [{ domain: '/bad' }, { domain: '', after: '9007199254740992' }]) await expect(openTrafficStream(settings, input, callbacks(), new AbortController().signal)).rejects.toThrow()
    expect(requests).toHaveLength(0)
    const fixture = streamFixture(), controller = new AbortController(), pending = openTrafficStream(settings, { domain: '' }, callbacks(), controller.signal, fixture.transport)
    await Promise.resolve(); controller.abort(); await expect(pending).rejects.toThrow(); expect(requests[0].init.signal?.aborted).toBe(true)
})
test('idle stream watchdog aborts and settles even when no chunks arrive', async () => {
    const original = globalThis.setTimeout
    globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => original(handler, timeout === 45000 ? 1 : timeout, ...args)) as typeof setTimeout
    try {
        const fixture = streamFixture()
        await expect(openTrafficStream(settings, { domain: '' }, callbacks(), new AbortController().signal, fixture.transport)).rejects.toThrow('stopped responding')
        expect(fixture.canceled()).toBe(true)
    } finally { globalThis.setTimeout = original }
})
test('exact existing geometry and coordinates render real world paths; country shares exclude unknown/nonlocated records', () => {
    expect(countryCentroids.NO).toEqual([62, 10]); expect(projectTrafficPoint([90, -180])).toEqual([0, 0]); expect(trafficWorldPaths.length).toBeGreaterThan(150); expect(trafficWorldPaths[0]).toContain('Z')
    const row = { id: '1', country_iso: 'NO', timestamp: '2026-10-23T03:00:00Z' } as import('./traffic').TrafficRecord
    const countries = locatedTrafficCountries([row, { ...row, id: '2', country_iso: 'US' }, { ...row, id: '3', country_iso: 'XX' }, { ...row, id: '4', country_iso: null }])
    expect(countries.map(item => item.iso)).toEqual(['NO', 'US']); expect(countries.reduce((sum, item) => sum + item.count, 0)).toBe(2)
    expect(locatedTrafficCountries(Array.from({ length: 201 }, (_, index) => ({ ...row, id: String(index + 1) })))[0].count).toBe(200)
})
test('screen source bounds reconnects, pauses authorization failures until Refresh and cancels all scope/focus/background work', () => {
    const source = readFileSync(`${import.meta.dir}/../screens/TrafficMapScreen.tsx`, 'utf8')
    for (const marker of ['key={trafficAccountKey(settings)}', 'useIsFocused()', 'generation.current++; running.current?.abort()', '!controller.signal.aborted && own === generation.current', '[401, 403].includes(cause.status)', 'failures >= 5', 'setBlocked(false); setRevision', 'controller.abort(); generation.current++', 'countryCentroids[item.iso]', 'located requests in the latest loaded 200-request window', '.slice(-40)']) expect(source).toContain(marker)
    expect(source).not.toContain('new EventSource'); expect(source).not.toContain('Linking.openURL')
})
