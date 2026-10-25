import type { AppSettings } from '../../types'
import { endpoint, record, SystemError, text } from './model'
import { utf8Size } from './api'
export type SystemSocket = { onopen: (() => void) | null; onmessage: ((e: { data: unknown }) => void) | null; onclose: ((e: { code: number }) => void) | null; onerror: (() => void) | null; send: (s: string) => void; close: () => void }
export type SocketTransport = (url: string) => SystemSocket
export type ProofFactory = (token: string, method: string, url: string) => Promise<{ proof: string }>
export async function watchSystem(s: AppSettings, signal: AbortSignal, observer: { data: (v: unknown) => void; status: (v: string) => void; error: (e: SystemError) => void }, transport: SocketTransport = url => new WebSocket(url) as unknown as SystemSocket,
    proofFactory: ProofFactory = async (...args) => (await import('../../lib/device-proof')).createDeviceProof(...args), retryDelayMs = 2000) {
    if (signal.aborted) return () => {}
    const target = endpoint(s.apiBaseUrl, 'ws/system')
    let socket: SystemSocket | null = null
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined
    let stopped = false, received = 0
    const retryDelay = Number.isFinite(retryDelayMs) ? Math.max(0, Math.min(30000, retryDelayMs)) : 2000
    const closeSocket = () => {
        if (deadlineTimer !== undefined) clearTimeout(deadlineTimer)
        deadlineTimer = undefined
        const current = socket
        socket = null
        if (!current) return
        current.onopen = null; current.onclose = null; current.onmessage = null; current.onerror = null
        current.close()
    }
    const stop = () => {
        if (stopped) return
        stopped = true
        if (retryTimer !== undefined) clearTimeout(retryTimer)
        retryTimer = undefined
        signal.removeEventListener('abort', stop)
        closeSocket()
    }
    const disconnect = (message: string, status = 0) => {
        if (stopped || signal.aborted) return
        closeSocket()
        if (status === 403) {
            stop()
            observer.status('Disconnected · permission required')
            observer.error(new SystemError(message, status))
            return
        }
        if (retryTimer !== undefined) return
        observer.status('Reconnecting · retrying shortly')
        retryTimer = setTimeout(() => {
            retryTimer = undefined
            void connect()
        }, retryDelay)
    }
    const invalid = (message: string) => {
        if (stopped || signal.aborted) return
        stop()
        observer.status('Disconnected · refresh to reconnect')
        observer.error(new SystemError(message))
    }
    async function connect() {
        if (stopped || signal.aborted) return
        observer.status('Connecting')
        try {
            // Every reconnect gets a new nonce and proof; proofs cannot be replayed.
            const proof = await boundedProof(() => proofFactory(s.authToken, 'GET', target), signal)
            if (!proof || stopped || signal.aborted) return
            const current = transport(target.replace(/^https:/, 'wss:'))
            socket = current
            let sent = false
            const deadline = () => {
                if (deadlineTimer !== undefined) clearTimeout(deadlineTimer)
                deadlineTimer = setTimeout(() => disconnect('Live telemetry timed out.'), 15000)
            }
            deadline()
            current.onopen = () => {
                if (stopped || signal.aborted || socket !== current || sent) return
                try {
                    sent = true
                    current.send(JSON.stringify({ type: 'auth', id: s.userId, token: s.authToken, dpop: proof.proof }))
                    deadline()
                } catch { disconnect('Live system connection failed.') }
            }
            current.onmessage = event => {
                if (stopped || signal.aborted || socket !== current) return
                try {
                    if (typeof event.data !== 'string' || utf8Size(event.data) > 4 * 1024 * 1024) throw new Error()
                    received += utf8Size(event.data)
                    if (received > 64 * 1024 * 1024) { invalid('Live view reached its session limit. Refresh to reconnect.'); return }
                    const value: unknown = JSON.parse(event.data), r = record(value)
                    if (r.type === 'error') { disconnect(text(r.message) || 'Live system telemetry is unavailable.'); return }
                    if (r.type !== 'snapshot') { invalid('The live system frame was invalid.'); return }
                    observer.data(value); observer.status('Live · sampled each second'); deadline()
                } catch { invalid('The live system frame was invalid.') }
            }
            current.onclose = event => disconnect(event.code === 1008
                ? 'Live telemetry requires current Hanasand editing access. Use manual refresh for permitted reads.'
                : 'Live system connection closed.', event.code === 1008 ? 403 : 0)
            current.onerror = () => disconnect('Live system connection failed.')
        } catch {
            if (!stopped && !signal.aborted) disconnect('Live system authentication failed.')
        }
    }
    signal.addEventListener('abort', stop, { once: true })
    await connect()
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
