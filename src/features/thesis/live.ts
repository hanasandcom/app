import type { AppSettings } from '../../types'
import { ownAccount, thesisEndpoint, ThesisError } from './api'
import { document, type ThesisDocument } from './document'

export type ThesisSocket = {
    onopen: (() => void) | null
    onmessage: ((event: { data: unknown }) => void) | null
    onerror: (() => void) | null
    onclose: ((event: { code?: number }) => void) | null
    send: (data: string) => void
    close: () => void
}
export type ThesisSocketFactory = (url: string) => ThesisSocket
export type ThesisSigner = (token: string, method: string, url: string) => Promise<{ proof: string }>
export type ThesisLive = ReturnType<typeof createThesisLive>
export function createThesisLive(factory: ThesisSocketFactory = url => new (WebSocket as unknown as new (url: string) => ThesisSocket)(url), sign: ThesisSigner = async (...args) => (await import('../../lib/device-proof')).createDeviceProof(...args)) {
    return async (settings: AppSettings, signal: AbortSignal, receive: (doc: ThesisDocument) => void, state: (message: string, denied?: boolean) => void) => {
        ownAccount(settings)
        const target = thesisEndpoint(settings.apiBaseUrl, 'ws/thesis')
        const signed = await sign(settings.authToken, 'GET', target)
        if (signal.aborted) return () => {}
        const socket = factory(target.replace(/^https:/, 'wss:'))
        let closed = false
        const timer = setTimeout(() => fail('Live connection timed out. Refresh to reconnect.'), 15000)
        function stop() {
            if (closed) return
            closed = true; clearTimeout(timer); signal.removeEventListener('abort', stop)
            socket.onopen = null; socket.onmessage = null; socket.onclose = null; socket.onerror = null
            socket.close()
        }
        function fail(message: string, denied = false) { if (closed) return; stop(); state(message, denied) }
        signal.addEventListener('abort', stop, { once: true })
        socket.onopen = () => {
            if (closed || signal.aborted) return
            const auth = JSON.stringify({ type: 'auth', id: settings.userId, token: settings.authToken, dpop: signed.proof })
            if (new TextEncoder().encode(auth).length > 4096) { fail('The live authentication request exceeded its limit.'); return }
            socket.send(auth)
        }
        socket.onmessage = event => {
            if (closed || signal.aborted) return
            try {
                if (typeof event.data !== 'string' || new TextEncoder().encode(event.data).length > 4_100_000) throw new ThesisError('Invalid live document.')
                const next = document(JSON.parse(event.data))
                clearTimeout(timer); state('Live'); receive(next)
            } catch { fail('Live returned an invalid document. Refresh to reconnect.') }
        }
        socket.onerror = () => fail('Live disconnected. Your draft is kept; refresh to reconnect.')
        socket.onclose = event => fail(event.code === 1008 ? 'Thesis live access was denied. Refresh your account access.' : 'Live disconnected. Refresh to reconnect.', event.code === 1008)
        return stop
    }
}
export const thesisLive = createThesisLive()
