import { beforeEach, expect, mock, test } from 'bun:test'
import type { AppSettings } from '../types'
import type { AiMetricsObserver, AiMetricsSocket, AiMetricsSocketTransport } from './ai-metrics-live'
mock.module('./api', () => ({ apiFetch: async () => { throw new Error('No HTTP in live protocol tests') }, fetchAiModels: async () => [] }))
const api = await import('./ai-metrics-live')
const settings = { apiBaseUrl: 'https://api.synthetic.invalid/api', userId: 'synthetic', authToken: 'synthetic-token', impersonationToken: '', impersonatingUserId: '' } as AppSettings
class Socket implements AiMetricsSocket {
    onopen: (() => void) | null = null
    onmessage: ((event: { data: unknown }) => void) | null = null
    onerror: (() => void) | null = null
    onclose: ((event: { code?: number }) => void) | null = null
    sent: Record<string, unknown>[] = []
    closed = false
    send(body: string) { this.sent.push(JSON.parse(body)) }
    close() { this.closed = true }
    event(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }) }
}
const sockets: Socket[] = [], requests: Array<{ url: string; headers: Record<string, string> }> = [], signed: string[] = []
const transport: AiMetricsSocketTransport = (url, headers) => { requests.push({ url, headers }); const socket = new Socket(); sockets.push(socket); return socket }
const live = api.createAiMetricsLive(transport, async (_settings, url) => { signed.push(url); return { Authorization: 'Bearer synthetic-token', dpop: 'synthetic-proof' } })
const input = { clientName: 'chosen', conversationId: 'synthetic-conversation', messages: [{ role: 'user' as const, content: 'Synthetic test only' }] }
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const snapshot = { type: 'snapshot', clients: [{ name: 'chosen', model: { status: 'idle' } }], participants: 2 }
beforeEach(() => { sockets.length = 0; requests.length = 0; signed.length = 0 })

test('signed public HTTPS target becomes WSS with headers, never credentials in query', async () => {
    const cancel = new AbortController(), updates: unknown[] = []
    const observer: AiMetricsObserver = { snapshot: (...value) => updates.push(value), update: value => updates.push(value), participants: value => updates.push(value), state: () => {}, error: () => {} }
    const stop = await live.observe(settings, cancel.signal, observer)
    expect(signed).toEqual(['https://api.synthetic.invalid/api/client/ws/gpt'])
    expect(requests[0].url).toBe('wss://api.synthetic.invalid/api/client/ws/gpt')
    expect(new URL(requests[0].url).search).toBe('')
    expect(requests[0].headers.dpop).toBe('synthetic-proof')
    sockets[0].event(snapshot)
    expect(updates).toHaveLength(1)
    cancel.abort(); stop()
    expect(sockets[0].closed).toBe(true)
    expect(sockets[0].onmessage).toBeNull()
})
test('prompt waits for snapshot and submits once to exactly selected client with website limits', async () => {
    const cancel = new AbortController(), deltas: string[] = []
    const promise = live.test(settings, input, cancel.signal, value => deltas.push(value), () => {})
    await tick()
    sockets[0].onopen?.()
    expect(sockets[0].sent).toHaveLength(0)
    sockets[0].event(snapshot); sockets[0].event(snapshot)
    expect(sockets[0].sent).toEqual([{ type: 'prompt_request', ...input, maxTokens: 512, temperature: 0.7 }])
    sockets[0].event({ type: 'prompt_delta', conversationId: 'other', delta: 'ignore' })
    sockets[0].event({ type: 'prompt_delta', conversationId: input.conversationId, clientName: 'wrong', delta: 'ignore' })
    sockets[0].event({ type: 'prompt_delta', conversationId: input.conversationId, delta: 'First' })
    sockets[0].event({ type: 'prompt_delta', conversationId: input.conversationId, content: 'Full replacement' })
    sockets[0].event({ type: 'prompt_complete', conversationId: input.conversationId, content: 'Completed' })
    expect(await promise).toBe('Completed')
    expect(deltas).toEqual(['First', 'Full replacement', 'Completed'])
    expect(sockets[0].closed).toBe(true)
})
test('absent target never falls back to another model or another endpoint', async () => {
    const promise = live.test(settings, input, new AbortController().signal, () => {}, () => {})
    const rejection = promise.catch(cause => cause)
    await tick(); sockets[0].event({ type: 'snapshot', clients: [{ name: 'other' }] })
    expect(String(await rejection)).toContain('no longer connected')
    expect(sockets[0].sent).toHaveLength(0)
    expect(requests).toHaveLength(1)
})
test('abort after submission is uncertain, closes and never retries', async () => {
    const cancel = new AbortController(), promise = live.test(settings, input, cancel.signal, () => {}, () => {})
    const caught = promise.catch(cause => cause as InstanceType<typeof api.AiMetricsPromptError>)
    await tick(); sockets[0].event(snapshot); cancel.abort()
    const cause = await caught
    expect(cause).toBeInstanceOf(api.AiMetricsPromptError)
    expect((cause as InstanceType<typeof api.AiMetricsPromptError>).submitted).toBe(true)
    expect(sockets[0].sent).toHaveLength(1)
    expect(sockets[0].closed).toBe(true)
})
test('pre-abort and either impersonation state prevent submission', async () => {
    const cancel = new AbortController(); cancel.abort()
    await expect(live.test(settings, input, cancel.signal, () => {}, () => {})).rejects.toThrow('cancelled')
    for (const changed of [{ impersonationToken: 'synthetic' }, { impersonatingUserId: 'synthetic' }]) await expect(live.test({ ...settings, ...changed }, input, new AbortController().signal, () => {}, () => {})).rejects.toThrow('own account')
    expect(sockets).toHaveLength(0)
})
test('authorization close codes surface a manual-refresh status', async () => {
    const errors: number[] = []
    await live.observe(settings, new AbortController().signal, { snapshot: () => {}, update: () => {}, participants: () => {}, state: () => {}, error: cause => errors.push(cause.status) })
    sockets[0].onclose?.({ code: 4403 })
    expect(errors).toEqual([403])
    expect(sockets[0].closed).toBe(true)
})
test('malformed, binary and UTF8 oversized events reject; a disconnected observer cannot apply late updates', async () => {
    expect(() => api.parseAiMetricsEvent('{')).toThrow()
    expect(() => api.parseAiMetricsEvent(new ArrayBuffer(2))).toThrow()
    expect(() => api.parseAiMetricsEvent(JSON.stringify({ type: 'update', text: '💡'.repeat(600000) }))).toThrow('limit')
    let updates = 0, errors = 0
    await live.observe(settings, new AbortController().signal, { snapshot: () => { updates++ }, update: () => { updates++ }, participants: () => {}, state: () => {}, error: () => { errors++ } })
    sockets[0].onmessage?.({ data: '{' }); sockets[0].event(snapshot)
    expect(errors).toBe(1); expect(updates).toBe(0)
})
test('invalid prompt shapes never connect or reuse a secret-bearing response', async () => {
    for (const changed of [{ conversationId: '../bad' }, { clientName: '' }, { messages: [] }, { messages: [{ role: 'user' as const, content: 'x'.repeat(8001) }] }]) await expect(live.test(settings, { ...input, ...changed }, new AbortController().signal, () => {}, () => {})).rejects.toThrow()
    expect(sockets).toHaveLength(0)
})
test('empty completion and model errors cannot be reported as successful completion', async () => {
    for (const type of ['prompt_complete', 'prompt_error']) {
        const promise = live.test(settings, input, new AbortController().signal, () => {}, () => {})
        const caught = promise.catch(cause => cause)
        await tick(); sockets.at(-1)!.event(snapshot)
        sockets.at(-1)!.event({ type, conversationId: input.conversationId, error: 'synthetic-secret-must-not-echo' })
        const cause = await caught
        expect(cause).toBeInstanceOf(api.AiMetricsPromptError)
        expect(cause.submitted).toBe(true)
        expect(String(cause)).not.toContain('synthetic-secret')
    }
})
