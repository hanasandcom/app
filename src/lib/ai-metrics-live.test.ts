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

test('pre-send validation, authorization and vanished target failures retain draft without prompt_request', async () => {
    const reviewed = { prompt: input.messages[0].content, clientName: input.clientName, epoch: 7, revision: 1 }
    for (const failure of ['validation', '401', '403', 'vanished']) {
        sockets.length = 0
        let draft = { ...reviewed }, accepted = 0
        const client = failure === '401' || failure === '403'
            ? api.createAiMetricsLive(transport, async () => { throw new api.AiMetricsPromptError('Access rejected', false, Number(failure)) })
            : live
        const onAccepted = () => {
            accepted++
            draft = { ...draft, prompt: api.aiPromptDraftAfterAcceptance(draft, reviewed) }
        }
        const promise = client.test(settings, failure === 'validation' ? { ...input, messages: [] } : input,
            new AbortController().signal, () => {}, onAccepted).then(value => { onAccepted(); return value })
        const caught = promise.catch(cause => cause)
        await tick()
        if (failure === 'vanished') sockets[0].event({ type: 'snapshot', clients: [{ name: 'other' }] })
        expect(await caught).toBeInstanceOf(api.AiMetricsPromptError)
        expect(sockets.flatMap(socket => socket.sent)).toHaveLength(0)
        expect(accepted).toBe(0)
        expect(draft.prompt).toBe(reviewed.prompt)
    }
})

test('accepted prompt clears only the matching draft and preserves edits and lifecycle changes', async () => {
    const reviewed = { prompt: input.messages[0].content, clientName: input.clientName, epoch: 7, revision: 1 }
    let draft = { ...reviewed }
    const onAccepted = () => { draft = { ...draft, prompt: api.aiPromptDraftAfterAcceptance(draft, reviewed) } }
    const promise = live.test(settings, input, new AbortController().signal, () => {}, onAccepted)
    await tick(); sockets[0].event(snapshot)
    expect(draft.prompt).toBe(reviewed.prompt)
    expect(sockets[0].sent).toHaveLength(1)
    sockets[0].event({ type: 'prompt_started', conversationId: input.conversationId })
    expect(draft.prompt).toBe('')
    sockets[0].event({ type: 'prompt_complete', conversationId: input.conversationId, content: 'Complete' })
    expect(await promise).toBe('Complete')
    for (const changed of [{ prompt: 'New draft' }, { epoch: 8 }, { clientName: 'other' }, { revision: 3 }]) {
        const current = { ...reviewed, ...changed }
        expect(api.aiPromptDraftAfterAcceptance(current, reviewed)).toBe(current.prompt)
    }
    const component = await Bun.file(new URL('../components/AiMetricsPrompt.tsx', import.meta.url)).text()
    expect(component).toContain('aiPromptDraftAfterAcceptance(latest.current, snapshot)')
    expect(component).toContain('if (!mounted.current || accepted')
    expect(component).toContain('latest.current.revision !== snapshot.revision')
    expect(component).not.toContain('setPrompt(\'\')')
    const screen = await Bun.file(new URL('../screens/AiMetricsScreen.tsx', import.meta.url)).text()
    expect(screen).toContain('onSend={send}')
    expect(screen).toContain('onAccepted()\n                        setTestStatus(\'Selected client is generating…\')')
})


test('captured input callbacks cannot restore an accepted prompt after send returns idle', async () => {
    const state = { mounted: true, disabled: false, busy: false, pending: false, currentGeneration: 0 }
    let prompt = 'Reviewed synthetic prompt'
    const capture = () => {
        const generation = state.currentGeneration
        return (value: string) => { if (api.canEditAiPrompt({ ...state, generation })) prompt = value }
    }
    const oldCallback = capture()
    oldCallback('Reviewed synthetic prompt')
    expect(prompt).toBe('Reviewed synthetic prompt')
    state.pending = true; state.currentGeneration++ // Immediate send claim, before a disabled render.
    oldCallback('Queued before busy rendered')
    expect(prompt).toBe('Reviewed synthetic prompt')
    state.currentGeneration++; prompt = '' // Accepted callback clears only the reviewed draft.
    const acceptedCallback = capture()
    oldCallback('Queued after acceptance')
    acceptedCallback('Still pending')
    expect(prompt).toBe('')
    state.pending = false; state.currentGeneration++ // Completion invalidates every earlier callback.
    oldCallback('Late callback after idle')
    acceptedCallback('Late accepted-generation callback after idle')
    expect(prompt).toBe('')
    capture()('Fresh idle draft')
    expect(prompt).toBe('Fresh idle draft')
    const component = await Bun.file(new URL('../components/AiMetricsPrompt.tsx', import.meta.url)).text()
    expect(component).toContain('canEditAiPrompt({ mounted: mounted.current')
    expect(component).toContain('generation: capturedGeneration, currentGeneration: generation.current')
    expect(component).toContain('onChangeText={value => edit(value, inputGeneration)}')
    expect(component).toContain('pending.current = true; generation.current++')
    expect(component).toContain('accepted = true; generation.current++')
    expect(component).toContain('pending.current = false; generation.current++')
    expect(component).toContain('generation.current !== snapshot.inputGeneration')
    expect(component).toContain('await onSend(snapshot.prompt, snapshot.epoch')
})
test('input ownership rejects unmounted, disabled, busy and pending events independently', () => {
    const valid = { mounted: true, disabled: false, busy: false, pending: false, generation: 4, currentGeneration: 4 }
    expect(api.canEditAiPrompt(valid)).toBe(true)
    for (const change of [{ mounted: false }, { disabled: true }, { busy: true }, { pending: true }, { generation: 3 }, { currentGeneration: 5 }])
        expect(api.canEditAiPrompt({ ...valid, ...change })).toBe(false)
})
test('pre-send failure retains its draft but only a fresh idle callback can edit it', async () => {
    const state = { mounted: true, disabled: false, busy: false, pending: false, currentGeneration: 0 }
    let prompt = 'Retained pre-send draft'
    const capture = () => {
        const generation = state.currentGeneration
        return (value: string) => { if (api.canEditAiPrompt({ ...state, generation })) prompt = value }
    }
    const oldCallback = capture()
    state.pending = true; state.currentGeneration++
    try { await Promise.reject(new api.AiMetricsPromptError('Synthetic validation failure', false)) }
    catch { expect(prompt).toBe('Retained pre-send draft') }
    finally { state.pending = false; state.currentGeneration++ }
    oldCallback('Stale value')
    expect(prompt).toBe('Retained pre-send draft')
    capture()('Corrected pre-send draft')
    expect(prompt).toBe('Corrected pre-send draft')
})
