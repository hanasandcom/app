import { afterEach, expect, mock, test } from 'bun:test'
import type { AppSettings } from '../types'
mock.module('./profile-api', () => ({ supportBase: () => 'https://support.synthetic.invalid/api' }))
mock.module('./device-proof', () => ({ createDeviceProof: async () => { throw new Error('Real keystore must not be used.') } }))
const { startSupportLive, supportLiveAddresses } = await import('./support-live')
type Port = import('./support-live').SupportSocket
type Adapter = import('./support-live').SupportLiveAdapter
const settings = { siteBaseUrl: 'https://synthetic.invalid', userId: 'synthetic-agent', authToken: 'synthetic-token', impersonationToken: '' } as AppSettings
const cleanups: Array<() => void> = []
afterEach(() => { while (cleanups.length) cleanups.pop()!() })
function fixture() {
    const sent: string[] = [], statuses: string[] = [], connections: Array<{ url: string; origin: string }> = [], proofs: string[] = []
    let changed = 0, closed = 0
    const socket: Port = { send: value => sent.push(value), close: code => { closed++; socket.onclose?.({ code: code || 1000 }) }, onopen: null, onmessage: null, onclose: null, onerror: null }
    const adapter: Adapter = {
        proof: async (token, method, url) => { proofs.push(JSON.stringify({ token, method, url })); return { proof: 'synthetic-proof' } },
        socket: (url, origin) => { connections.push({ url, origin }); return socket }
    }
    const controller = new AbortController()
    const stop = startSupportLive(settings, { status: value => statuses.push(value), changed: () => { changed++ } }, controller.signal, adapter)
    cleanups.push(stop)
    return { socket, sent, statuses, connections, proofs, controller, changed: () => changed, closed: () => closed }
}
test('authenticated support socket signs HTTPS upgrade and sends credentials only in its frame', async () => {
    const f = fixture(); await Promise.resolve()
    expect(f.connections).toEqual([{ url: 'wss://support.synthetic.invalid/api/ws/support', origin: 'https://synthetic.invalid' }])
    expect(f.proofs[0]).toContain('https://support.synthetic.invalid/api/ws/support')
    expect(f.connections[0].url).not.toContain('synthetic-token')
    f.socket.onopen?.()
    expect(JSON.parse(f.sent[0])).toEqual({ type: 'auth', id: 'synthetic-agent', token: 'synthetic-token', dpop: 'synthetic-proof' })
    f.socket.onmessage?.({ data: '{"type":"changed"}' }); expect(f.changed()).toBe(0)
    f.socket.onmessage?.({ data: '{"type":"ready"}' }); f.socket.onmessage?.({ data: '{"type":"ready"}' })
    expect(f.changed()).toBe(1); expect(f.statuses.at(-1)).toBe('Live')
    f.socket.onmessage?.({ data: '{"type":"changed","id":"synthetic-ticket"}' }); expect(f.changed()).toBe(2)
})
test('policy rejection stops reconnect and hides credentials from status messages', async () => {
    const f = fixture(); await Promise.resolve()
    f.socket.onclose?.({ code: 1008 })
    expect(f.statuses.at(-1)).toBe('Refresh access to reconnect')
    expect(f.connections).toHaveLength(1)
    expect(JSON.stringify(f.statuses)).not.toContain('synthetic-token')
})
test('abort closes native transport and rejects late open/change handlers', async () => {
    const f = fixture(); await Promise.resolve()
    f.controller.abort(); f.socket.onopen?.(); f.socket.onmessage?.({ data: '{"type":"ready"}' })
    expect(f.closed()).toBe(1); expect(f.sent).toHaveLength(0); expect(f.changed()).toBe(0)
})
test('a late device proof after cancellation cannot create a socket', async () => {
    let finish!: (value: { proof: string }) => void, connections = 0
    const controller = new AbortController()
    const adapter: Adapter = { proof: () => new Promise(resolve => { finish = resolve }), socket: () => { connections++; throw new Error('Must not open') } }
    const stop = startSupportLive(settings, { status: () => {}, changed: () => {} }, controller.signal, adapter)
    cleanups.push(stop); controller.abort(); finish({ proof: 'synthetic-proof' }); await Promise.resolve()
    expect(connections).toBe(0)
})
test('binary, oversized and repeated malformed frames close the connection', async () => {
    for (const data of [new Uint8Array([1]), 'x'.repeat(1024 * 1024 + 1)]) {
        const f = fixture(); await Promise.resolve(); f.socket.onmessage?.({ data }); expect(f.closed()).toBe(1)
    }
    const f = fixture(); await Promise.resolve()
    for (let i = 0; i < 3; i++) f.socket.onmessage?.({ data: 'not-json' })
    expect(f.closed()).toBe(1)
})
test('insecure origins fail before credentials are signed or sent', () => {
    expect(() => supportLiveAddresses({ ...settings, siteBaseUrl: 'http://synthetic.invalid' })).toThrow('secure')
})
