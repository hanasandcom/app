import type { AppSettings } from '../types'
import { createDeviceProof } from './device-proof'
import { supportBase } from './support-endpoint'

export type SupportLiveStatus = 'Connecting' | 'Live' | 'Reconnecting' | 'Refresh access to reconnect' | 'Live updates unavailable'
export type SupportSocket = {
    send: (message: string) => void; close: (code?: number) => void
    onopen: (() => void) | null; onmessage: ((event: { data: unknown }) => void) | null
    onclose: ((event: { code: number }) => void) | null; onerror: (() => void) | null
}
export type SupportLiveAdapter = {
    socket: (url: string, origin: string) => SupportSocket
    proof: (token: string, method: string, url: string) => Promise<{ proof: string }>
}
const nativeAdapter: SupportLiveAdapter = {
    socket: (url, origin) => {
        const NativeSocket = WebSocket as unknown as new (url: string, protocols: undefined, options: { headers: { origin: string } }) => SupportSocket
        return new NativeSocket(url, undefined, { headers: { origin } })
    },
    proof: createDeviceProof
}
export function supportLiveAddresses(settings: AppSettings) {
    const proof = new URL(`${supportBase().replace(/\/+$/, '')}/ws/support`)
    const site = new URL(settings.siteBaseUrl)
    if (proof.protocol !== 'https:' || proof.username || proof.password || proof.search || proof.hash
        || site.protocol !== 'https:' || site.username || site.password) throw new Error('Support live updates require secure service addresses.')
    const socket = new URL(proof); socket.protocol = 'wss:'
    return { socket: socket.toString(), proof: proof.toString(), origin: site.origin }
}
/** The DPoP target is the HTTPS upgrade request. Credentials travel only in the authenticated frame. */
export function startSupportLive(settings: AppSettings, callbacks: {
    status: (status: SupportLiveStatus) => void; changed: () => void
}, signal: AbortSignal, adapter: SupportLiveAdapter = nativeAdapter) {
    const address = supportLiveAddresses(settings)
    let stopped = false, socket: SupportSocket | null = null, failures = 0, generation = 0
    let retry: ReturnType<typeof setTimeout> | undefined, deadline: ReturnType<typeof setTimeout> | undefined
    function stop() {
        if (stopped) return
        stopped = true; generation++; clearTimeout(retry); clearTimeout(deadline)
        signal.removeEventListener('abort', stop)
        const previous = socket; socket = null; previous?.close(1000)
    }
    async function connect() {
        if (stopped || signal.aborted) return
        const own = ++generation
        callbacks.status(failures ? 'Reconnecting' : 'Connecting')
        try {
            if (!settings.authToken || settings.authToken.length > 512 || !settings.userId || settings.userId.length > 200) throw new Error('Sign in first.')
            const { proof } = await adapter.proof(settings.authToken, 'GET', address.proof)
            if (stopped || signal.aborted || generation !== own) return
            const next = adapter.socket(address.socket, address.origin)
            socket = next
            let ready = false, invalid = 0
            const active = () => !stopped && generation === own && socket === next
            deadline = setTimeout(() => { if (active() && !ready) next.close(1000) }, 10000)
            next.onopen = () => {
                if (!active()) return
                next.send(JSON.stringify({ type: 'auth', id: settings.userId, token: settings.authToken,
                    ...(settings.impersonationToken ? { impersonationToken: settings.impersonationToken } : {}), dpop: proof }))
            }
            next.onmessage = event => {
                if (!active()) return
                if (typeof event.data !== 'string' || event.data.length > 1024 * 1024) { next.close(1009); return }
                try {
                    const data: unknown = JSON.parse(event.data)
                    if (!data || typeof data !== 'object') throw new Error('Invalid frame')
                    const type = (data as { type?: unknown }).type
                    if (type === 'ready' && !ready) { ready = true; failures = 0; clearTimeout(deadline); callbacks.status('Live'); callbacks.changed() }
                    else if (type === 'changed' && ready) callbacks.changed()
                } catch { if (++invalid >= 3) next.close(1002) }
            }
            next.onerror = () => { if (active()) next.close(1000) }
            next.onclose = event => {
                if (!active()) return
                socket = null; clearTimeout(deadline)
                if (event.code === 1008) { callbacks.status('Refresh access to reconnect'); return }
                reconnect()
            }
        } catch { if (!stopped && generation === own) reconnect() }
    }
    function reconnect() {
        failures++
        if (failures >= 5) { callbacks.status('Live updates unavailable'); return }
        callbacks.status('Reconnecting')
        retry = setTimeout(() => { retry = undefined; void connect() }, Math.min(15000, 1000 * 2 ** failures))
    }
    if (signal.aborted) stop()
    else { signal.addEventListener('abort', stop); void connect() }
    return stop
}
