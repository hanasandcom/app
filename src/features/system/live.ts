import type { AppSettings } from '../../types'
import { endpoint, record, SystemError, text } from './model'
import { utf8Size } from './api'
export type SystemSocket = { onopen: (() => void) | null; onmessage: ((e: { data: unknown }) => void) | null; onclose: ((e: { code: number }) => void) | null; onerror: (() => void) | null; send: (s: string) => void; close: () => void }
export type SocketTransport = (url: string) => SystemSocket
export type ProofFactory = (token: string, method: string, url: string) => Promise<{ proof: string }>
export async function watchSystem(s: AppSettings, signal: AbortSignal, observer: { data: (v: unknown) => void; status: (v: string) => void; error: (e: SystemError) => void }, transport: SocketTransport = url => new WebSocket(url) as unknown as SystemSocket,
    proofFactory: ProofFactory = async (...args) => (await import('../../lib/device-proof')).createDeviceProof(...args)) {
    if (signal.aborted) return () => {}
    const target = endpoint(s.apiBaseUrl, 'ws/system')
    const proof = await boundedProof(() => proofFactory(s.authToken, 'GET', target), signal)
    if (!proof) return () => {}
    if (signal.aborted) return () => {}
    const socket = transport(target.replace(/^https:/, 'wss:'))
    let closed = false, received = 0, sent = false
    let timer: ReturnType<typeof setTimeout>
    const stop = () => { if (closed) return; closed = true; clearTimeout(timer); signal.removeEventListener('abort', stop); socket.onopen = null; socket.onclose = null; socket.onmessage = null; socket.onerror = null; socket.close() }
    function fail(message: string, status = 0) { if (!closed) { stop(); observer.status('Disconnected · reconnect manually'); observer.error(new SystemError(message, status)) } }
    function deadline() { clearTimeout(timer); timer = setTimeout(() => fail('Live system telemetry timed out. Refresh to reconnect.'), 15000) }
    signal.addEventListener('abort', stop, { once: true }); deadline(); observer.status('Connecting')
    socket.onopen = () => { if (!closed && !signal.aborted && !sent) { sent = true; socket.send(JSON.stringify({ type: 'auth', id: s.userId, token: s.authToken, dpop: proof.proof })); deadline() } }
    socket.onmessage = event => {
        if (closed || signal.aborted) return
        try {
            if (typeof event.data !== 'string' || utf8Size(event.data) > 4 * 1024 * 1024) throw new Error()
            received += utf8Size(event.data)
            if (received > 64 * 1024 * 1024) { fail('Live view reached its session limit. Reconnect manually.'); return }
            const value: unknown = JSON.parse(event.data), r = record(value)
            if (r.type === 'error') { fail(text(r.message) || 'Live system telemetry is unavailable.'); return }
            if (r.type !== 'snapshot') throw new Error()
            observer.data(value); observer.status('Live · sampled each second'); deadline()
        } catch { fail('The live system frame was invalid.') }
    }
    socket.onclose = event => fail(event.code === 1008 ? 'Live telemetry requires current Hanasand editing access. Use manual refresh for permitted reads.' : 'Live system connection closed.', event.code === 1008 ? 403 : 0)
    socket.onerror = () => fail('Live system connection failed. No reconnect was attempted.')
    return stop
}

async function boundedProof(make: () => ReturnType<ProofFactory>, signal: AbortSignal) {
    let timer: ReturnType<typeof setTimeout> | undefined
    let abort: () => void = () => {}
    const interrupted = new Promise<null>((resolve) => { abort = () => resolve(null) })
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SystemError('System authentication timed out. Reconnect manually.')), 15000)
    })
    signal.addEventListener('abort', abort, { once: true })
    try { return await Promise.race([make(), interrupted, timeout]) }
    finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
}
