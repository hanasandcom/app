import type { AppSettings } from '../types'
import { aiMetricsEndpoint, AiMetricsError, aiMetricsLimit, aiNumber, aiRecord, aiText, aiUtf8Bytes, parseAiClient, type AiMetricsClient } from './ai-metrics'

export type AiMetricsSocket = {
    onopen: (() => void) | null
    onmessage: ((event: { data: unknown }) => void) | null
    onerror: (() => void) | null
    onclose: ((event: { code?: number }) => void) | null
    send: (body: string) => void
    close: () => void
}
export type AiMetricsSocketTransport = (url: string, headers: Record<string, string>) => AiMetricsSocket
export type AiMetricsAuthorization = (settings: AppSettings, httpsUrl: string) => Promise<Record<string, string>>
export type AiMetricsObserver = {
    snapshot: (clients: AiMetricsClient[], participants: number | null) => void
    update: (client: AiMetricsClient) => void
    participants: (count: number | null) => void
    state: (state: 'connecting' | 'connected' | 'disconnected') => void
    error: (error: AiMetricsError) => void
}
export type AiTestMessage = { role: 'user' | 'assistant'; content: string }
export type AiTestInput = { clientName: string; conversationId: string; messages: AiTestMessage[] }
export type AiMetricsLive = {
    observe: (settings: AppSettings, signal: AbortSignal, observer: AiMetricsObserver) => Promise<() => void>
    test: (settings: AppSettings, input: AiTestInput, signal: AbortSignal, onContent: (content: string) => void, onStarted: () => void) => Promise<string>
}
export class AiMetricsPromptError extends AiMetricsError {
    constructor(message: string, readonly submitted: boolean, status = 0) { super(message, status) }
}
const defaultTransport: AiMetricsSocketTransport = (url, headers) => {
    const NativeSocket = WebSocket as unknown as new (url: string, protocols?: string[], options?: { headers: Record<string, string> }) => AiMetricsSocket
    return new NativeSocket(url, undefined, { headers })
}
const defaultAuthorization: AiMetricsAuthorization = async (settings, url) => {
    if (!settings.userId || !settings.authToken) throw new AiMetricsError('Sign in to inspect AI operations.', 401)
    const { createDeviceProof, getDevicePublicJwk } = await import('./device-proof')
    const proof = await createDeviceProof(settings.authToken, 'GET', url)
    return { Authorization: `Bearer ${settings.authToken}`, id: settings.userId, dpop: proof.proof, 'x-device-proof-url': proof.url, 'x-device-proof-method': 'GET', 'x-device-public-jwk': JSON.stringify(await getDevicePublicJwk()), ...(settings.impersonationToken ? { 'x-impersonation-token': settings.impersonationToken } : {}) }
}
export function parseAiMetricsEvent(data: unknown) {
    if (typeof data !== 'string' || aiUtf8Bytes(data) > aiMetricsLimit) throw new AiMetricsError('Live AI event exceeded its limit or used an unsupported format.')
    try {
        const value: unknown = JSON.parse(data)
        if (!value || typeof value !== 'object' || Array.isArray(value) || typeof aiRecord(value).type !== 'string') throw new Error()
        return aiRecord(value)
    } catch { throw new AiMetricsError('Live AI returned an invalid event. Refresh to reconnect.') }
}
function clientsFromSnapshot(value: unknown) {
    if (!Array.isArray(value) || value.length > 512) throw new AiMetricsError('Live AI snapshot is invalid.')
    const clients = value.map(parseAiClient)
    if (new Set(clients.map(client => client.name)).size !== clients.length) throw new AiMetricsError('Live AI snapshot contains duplicate clients.')
    return clients
}
function closeStatus(code?: number) { return [4401, 4001].includes(code || 0) ? 401 : [4403, 4003, 1008].includes(code || 0) ? 403 : 0 }
export function validAiTest(input: AiTestInput) {
    if (!input.clientName.trim() || input.clientName.length > 300 || !/^[A-Za-z0-9_-]{1,100}$/.test(input.conversationId) || !input.messages.length || input.messages.length > 40 || input.messages.some(message => !['user', 'assistant'].includes(message.role) || !message.content.trim()) || input.messages.at(-1)?.role !== 'user' || aiUtf8Bytes(JSON.stringify(input.messages)) > 65536) throw new AiMetricsPromptError('Enter a prompt of at most 8,000 characters and keep the test conversation under 64 KB.', false)
    if (input.messages.at(-1)!.content.length > 8000) throw new AiMetricsPromptError('Keep the prompt under 8,000 characters.', false)
}
export function createAiMetricsLive(transport: AiMetricsSocketTransport = defaultTransport, authorize: AiMetricsAuthorization = defaultAuthorization): AiMetricsLive {
    return {
        async observe(settings, signal, observer) {
            observer.state('connecting')
            const target = aiMetricsEndpoint(settings.apiBaseUrl, 'client/ws/gpt')
            const headers = await authorize(settings, target)
            if (signal.aborted) return () => {}
            const socket = transport(target.replace(/^https:/, 'wss:'), headers)
            let closed = false
            const timer = setTimeout(() => fail(new AiMetricsError('Live AI connection timed out. Refresh to reconnect.')), 15000)
            function stop() {
                if (closed) return
                closed = true; clearTimeout(timer); signal.removeEventListener('abort', stop)
                socket.onopen = null; socket.onmessage = null; socket.onerror = null; socket.onclose = null; socket.close()
            }
            function fail(cause: AiMetricsError) { if (closed) return; stop(); observer.state('disconnected'); observer.error(cause) }
            signal.addEventListener('abort', stop, { once: true })
            socket.onopen = () => { if (!closed) observer.state('connected') }
            socket.onerror = () => fail(new AiMetricsError('Live AI disconnected. Refresh to reconnect.'))
            socket.onclose = event => fail(new AiMetricsError('Live AI disconnected. Refresh to reconnect.', closeStatus(event.code)))
            socket.onmessage = event => {
                if (closed || signal.aborted) return
                try {
                    const body = parseAiMetricsEvent(event.data)
                    if (body.type === 'snapshot') { clearTimeout(timer); observer.snapshot(clientsFromSnapshot(body.clients), aiNumber(body.participants)) }
                    if (body.type === 'update') observer.update(parseAiClient(body.client))
                    if (body.type === 'join' || body.type === 'update') observer.participants(aiNumber(body.participants))
                } catch (cause) { fail(cause instanceof AiMetricsError ? cause : new AiMetricsError('Live AI returned invalid telemetry. Refresh to reconnect.')) }
            }
            return stop
        },
        async test(settings, input, signal, onContent, onStarted) {
            validAiTest(input)
            if (settings.impersonationToken || settings.impersonatingUserId) throw new AiMetricsPromptError('Return to your own account before testing a model.', false)
            const target = aiMetricsEndpoint(settings.apiBaseUrl, 'client/ws/gpt')
            const headers = await authorize(settings, target)
            if (signal.aborted) throw new AiMetricsPromptError('Test cancelled before submission.', false)
            return new Promise<string>((resolve, reject) => {
                const socket = transport(target.replace(/^https:/, 'wss:'), headers)
                let settled = false, submitted = false, content = ''
                let timer = setTimeout(() => finish(new AiMetricsPromptError('The model test connection timed out.', submitted)), 15000)
                function finish(cause?: AiMetricsPromptError, result?: string) {
                    if (settled) return
                    settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort)
                    socket.onmessage = null; socket.onopen = null; socket.onerror = null; socket.onclose = null; socket.close()
                    if (cause) reject(cause); else resolve(result || '')
                }
                function abort() { finish(new AiMetricsPromptError(submitted ? 'Stopped listening. The submitted test may still be running. Refresh before trying again.' : 'Test cancelled before submission.', submitted)) }
                signal.addEventListener('abort', abort, { once: true })
                socket.onerror = () => finish(new AiMetricsPromptError('Model test disconnected. Refresh before trying again.', submitted))
                socket.onclose = event => finish(new AiMetricsPromptError('Model test connection closed. Refresh before trying again.', submitted, closeStatus(event.code)))
                socket.onmessage = event => {
                    if (settled || signal.aborted) return
                    try {
                        const body = parseAiMetricsEvent(event.data)
                        if (body.type === 'snapshot' && !submitted) {
                            if (!clientsFromSnapshot(body.clients).some(client => client.name === input.clientName)) { finish(new AiMetricsPromptError('The selected model client is no longer connected.', false)); return }
                            submitted = true
                            socket.send(JSON.stringify({ type: 'prompt_request', conversationId: input.conversationId, clientName: input.clientName, messages: input.messages, maxTokens: 512, temperature: 0.7 }))
                            clearTimeout(timer); timer = setTimeout(() => finish(new AiMetricsPromptError('The model has not finished. Its outcome is uncertain; refresh before another test.', true)), 120000)
                            return
                        }
                        if (!submitted || body.conversationId !== input.conversationId || body.clientName && body.clientName !== input.clientName) return
                        if (body.type === 'prompt_started') onStarted()
                        if (body.type === 'prompt_delta' || body.type === 'prompt_complete') {
                            const next = typeof body.content === 'string' && body.content ? body.content : body.type === 'prompt_delta' ? content + aiText(body.delta, aiMetricsLimit) : content
                            if (aiUtf8Bytes(next) > aiMetricsLimit) throw new Error()
                            content = next; onContent(content)
                            if (body.type === 'prompt_complete') {
                                if (!content.trim()) finish(new AiMetricsPromptError('The model completed without text. Refresh before another test.', true))
                                else finish(undefined, content)
                            }
                        }
                        if (body.type === 'prompt_error') finish(new AiMetricsPromptError('The selected model reported an error. Refresh before another test.', true))
                    } catch { finish(new AiMetricsPromptError('Invalid model response. Refresh before another test.', submitted)) }
                }
            })
        },
    }
}
export const aiMetricsLive = createAiMetricsLive()
