import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
const calls: Array<{ url: string; init: RequestInit }> = []
let payload: unknown = { conversations: [] }
let status = 200
let networkFailures = 0
let transientHttpResponses = 0
mock.module('./api', () => ({ apiFetch: async (_settings: unknown, url: string, init: RequestInit) => { calls.push({ url, init }); if (networkFailures > 0) { networkFailures--; throw new TypeError('Network request failed') } if (transientHttpResponses > 0) { transientHttpResponses--; return new Response(JSON.stringify(payload), { status: 503 }) } return new Response(JSON.stringify(payload), { status }) } }))
mock.module('expo-crypto', () => ({ randomUUID: () => '11111111-1111-4111-8111-111111111111' }))
const api = await import('./ai-workspace')
const settings = { siteBaseUrl: 'https://example.test', apiBaseUrl: 'https://api.example.test/api', codexApiPath: '/tools/ai', authToken: 'token', userId: 'user' } as Parameters<typeof api.fetchAiWorkspace>[0]
const item = (id: string, createdAt: string, state: 'queued' | 'running' | 'done' | 'error' = 'queued', conversationId = 'conversation-1') => ({ id, createdAt, status: state, conversationId, threadId: `chatgpt-${conversationId}`, prompt: `Prompt ${id}`, priority: 'next' as const, result: state === 'done' ? `Result ${id}` : undefined })
let socketMode = 'complete'
class FakeSocket {
    onclose: (() => void) | null = null
    onerror: (() => void) | null = null
    onmessage: ((event: { data: string }) => void) | null = null
    static sent: object[] = []
    static closed = 0
    constructor(url: string) {
        void url
        queueMicrotask(() => {
            if (socketMode === 'hold') return
            if (socketMode === 'unavailable') this.onerror?.()
            else this.onmessage?.({ data: JSON.stringify({ type: 'snapshot', clients: [{ name: 'Model' }] }) })
        })
    }
    send(raw: string) {
        const request = JSON.parse(raw)
        FakeSocket.sent.push(request)
        queueMicrotask(() => {
            if (socketMode === 'after-submit-error') { this.onclose?.(); return }
            this.onmessage?.({ data: JSON.stringify({ type: 'prompt_delta', conversationId: 'another-thread', delta: 'Wrong response' }) })
            this.onmessage?.({ data: JSON.stringify({ type: 'prompt_delta', conversationId: request.conversationId, delta: 'Hello' }) })
            this.onmessage?.({ data: JSON.stringify({ type: 'prompt_complete', conversationId: request.conversationId, content: 'Hello world' }) })
        })
    }
    close() { FakeSocket.closed++ }
}
const originalSocket = globalThis.WebSocket
beforeEach(() => {
    calls.length = 0; status = 200; payload = { conversations: [] }; networkFailures = 0; transientHttpResponses = 0; socketMode = 'complete'; FakeSocket.sent = []; FakeSocket.closed = 0
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket
})
afterEach(() => { globalThis.WebSocket = originalSocket })
describe('shared mobile AI workspace', () => {
    it('loads the website workspace through its AI service proxy and hydrates ISO dates', async () => {
        payload = { conversations: [{ id: 'thread', title: 'Existing chat', messages: [{ id: 'message', role: 'user', content: 'Hi', createdAt: '2026-10-22T12:00:00Z' }] }] }
        const values = await api.fetchAiWorkspace(settings)
        expect(calls[0].url).toBe('https://example.test/api/backend/ai/workspace')
        expect(values[0].messages[0].createdAt).toBe(Date.parse('2026-10-22T12:00:00Z'))
    })
    it('retries one transient workspace network error and does not retry authorization failures', async () => {
        networkFailures = 1
        expect(await api.fetchAiWorkspaceWithRetry(settings, undefined, 0)).toEqual([])
        expect(calls).toHaveLength(2)
        calls.length = 0
        status = 401; payload = { error: 'Unauthorized.' }
        await expect(api.fetchAiWorkspaceWithRetry(settings, undefined, 0)).rejects.toThrow('Unauthorized.')
        expect(calls).toHaveLength(1)
    })
    it('retries transient ChatGPT history server errors but preserves the original error', async () => {
        payload = { items: [] }; transientHttpResponses = 1
        expect(await api.fetchChatGptActivityWithRetry(settings, 'conversation-1', undefined, 0)).toEqual([])
        expect(calls).toHaveLength(2)
        expect(calls[0].url).toBe('https://example.test/api/prompt?conversationId=conversation-1&threadId=chatgpt-conversation-1')
        status = 401; payload = { error: 'Unauthorized.' }; calls.length = 0
        await expect(api.fetchChatGptActivityWithRetry(settings, 'conversation-1', undefined, 0)).rejects.toThrow('Unauthorized.')
        expect(calls).toHaveLength(1)
    })
    it('persists a new turn strictly after prior history even when the wall clock moves backward', async () => {
        const future = Date.parse('2026-10-22T12:00:01Z')
        const user = { id: 'z-user', role: 'user' as const, content: 'Question', createdAt: api.nextAiMessageTimestamp([{ createdAt: future }], future - 1000) }
        const assistant = { id: 'a-assistant', role: 'assistant' as const, content: 'OK', createdAt: user.createdAt + 1 }
        expect(user.createdAt).toBe(future + 1)
        expect(assistant.createdAt).toBeGreaterThan(user.createdAt)
        expect(api.nextAiMessageTimestamp([assistant], future - 1000)).toBe(assistant.createdAt + 1)
        payload = {}
        await api.persistAiMessage(settings, 'thread', user)
        await api.persistAiMessage(settings, 'thread', assistant)
        const canonical = calls.map(call => JSON.parse(String(call.init.body)))
            .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id))
        expect(canonical.map(message => message.id)).toEqual(['z-user', 'a-assistant'])
        payload = { conversations: [{ id: 'thread', title: 'Chat', messages: canonical }] }
        expect((await api.fetchAiWorkspace(settings))[0].messages.map(message => message.id)).toEqual(['z-user', 'a-assistant'])
    })
    it('repairs an equal-timestamp legacy single turn after canonical UUID ordering', async () => {
        const createdAt = '2026-10-22T12:00:00Z'
        payload = { conversations: [{ id: 'thread', messages: [
            { id: 'a-assistant', role: 'assistant', content: 'OK', createdAt },
            { id: 'z-user', role: 'user', content: 'Question', createdAt },
        ] }] }
        const conversation = (await api.fetchAiWorkspace(settings))[0]
        expect(conversation.messages.map(message => message.id)).toEqual(['z-user', 'a-assistant'])
        expect(conversation.messages.every(message => message.createdAt === Date.parse(createdAt))).toBe(true)
    })
    it('preserves ambiguous equal-time tool and multi-turn histories', async () => {
        const createdAt = '2026-10-22T12:00:00Z'
        const toolHistory = [
            { id: 'call', role: 'assistant', content: 'Calling tool', createdAt },
            { id: 'tool', role: 'tool', content: 'Tool output', createdAt },
            { id: 'user', role: 'user', content: 'Question', createdAt },
        ]
        const multiTurn = [
            { id: 'answer-1', role: 'assistant', content: 'First answer', createdAt },
            { id: 'question-1', role: 'user', content: 'First question', createdAt },
            { id: 'answer-2', role: 'assistant', content: 'Second answer', createdAt },
            { id: 'question-2', role: 'user', content: 'Second question', createdAt },
        ]
        payload = { conversations: [{ id: 'tools', messages: toolHistory }, { id: 'multiple', messages: multiTurn }] }
        const conversations = await api.fetchAiWorkspace(settings)
        expect(conversations[0].messages.map(message => message.id)).toEqual(toolHistory.map(message => message.id))
        expect(conversations[1].messages.map(message => message.id)).toEqual(multiTurn.map(message => message.id))
    })
    it('preserves an assistant-first conversation when its timestamps differ', async () => {
        payload = { conversations: [{ id: 'thread', messages: [
            { id: 'welcome', role: 'assistant', content: 'Welcome', createdAt: 1 },
            { id: 'user', role: 'user', content: 'Question', createdAt: 2 },
        ] }] }
        expect((await api.fetchAiWorkspace(settings))[0].messages.map(message => message.id)).toEqual(['welcome', 'user'])
    })
    it('preserves existing conversation identity and scopes chronological portal history', async () => {
        payload = { items: [item('new', '2026-10-22T12:00:00Z', 'running'), item('foreign', '2026-10-22T13:00:00Z', 'done', 'other'), item('old', '2026-10-22T11:00:00Z', 'done')] }
        const values = await api.fetchChatGptActivity(settings, 'conversation-1')
        expect(values.map(value => value.id)).toEqual(['old', 'new'])
        expect(calls[0].url).toContain('threadId=chatgpt-conversation-1')
        expect(api.portalMessages(values).at(-1)?.pending).toBe(true)
        expect(api.portalMessages(values).at(-1)?.content).toContain('working')
    })
    it('keeps both agents in the visible conversation after reopening or switching agents', () => {
        const native = [{ id: 'native-user', role: 'user' as const, content: 'Hanasand question', createdAt: Date.parse('2026-10-22T10:00:00Z') }, { id: 'native-answer', role: 'assistant' as const, content: 'Hanasand answer', createdAt: Date.parse('2026-10-22T10:00:01Z'), modelName: 'Hanasand GPT' }]
        const portal = [item('done', '2026-10-22T11:00:00Z', 'done')]
        const visible = api.workspaceMessages(native, portal)
        expect(visible.map(row => row.id)).toEqual(['native-user', 'native-answer', 'done-request', 'done-response'])
        expect(visible.at(-1)?.content).toBe('Result done')
        expect(native).toHaveLength(2)
        expect(api.workspaceMessages([], portal)).toHaveLength(2)
        expect(api.conversationContext(native, portal).map(row => row.content)).toEqual(visible.map(row => row.content))
    })
    it('sends role-preserving prior context once and native multipart without a JSON content type', async () => {
        payload = { items: [] }
        const prior = api.conversationContext([{ id: 'u', role: 'user', content: 'Earlier', createdAt: 1 }, { id: 'a', role: 'assistant', content: 'Earlier answer', createdAt: 2 }, { id: 'p', role: 'assistant', content: 'In line', createdAt: 3, pending: true }], [])
        await api.submitChatGptPrompt(settings, 'conversation-1', 'New question', prior)
        const form = calls[0].init.body as FormData
        expect(JSON.parse(String(form.get('context')))).toEqual([{ role: 'user', content: 'Earlier' }, { role: 'assistant', content: 'Earlier answer' }])
        expect(form.get('prompt')).toBe('New question')
        expect(form.get('threadId')).toBe('chatgpt-conversation-1')
        expect(new Headers(calls[0].init.headers).has('content-type')).toBe(false)
    })
    it('shows queued, running and terminal states without treating progress as a completed response', () => {
        const messages = api.portalMessages([item('q', '2026-10-22T11:00:00Z'), item('r', '2026-10-22T12:00:00Z', 'running'), item('d', '2026-10-22T13:00:00Z', 'done')])
        expect(messages.filter(message => message.role === 'assistant').map(message => [message.pending, message.content])).toEqual([[true, 'In the queue…'], [true, 'ChatGPT is working…'], [false, 'Result d']])
    })
    it('retains stable live conversation ID and appends the new prompt only once', async () => {
        const updates: string[] = []
        const result = await api.runHanasandPrompt(settings, 'stable-conversation', 'New prompt', [{ role: 'assistant', content: 'Previous answer' }], text => updates.push(text), new AbortController().signal)
        expect(FakeSocket.sent).toEqual([{ type: 'prompt_request', conversationId: 'stable-conversation', clientName: 'Model', messages: [{ role: 'assistant', content: 'Previous answer' }, { role: 'user', content: 'New prompt' }], maxTokens: 1024, temperature: 0.35 }])
        expect(updates).toEqual(['Hello'])
        expect(result.message).toBe('Hello world')
        expect(calls).toHaveLength(0)
    })
    it('never submits a second model request after the live prompt was accepted', async () => {
        socketMode = 'after-submit-error'
        await expect(api.runHanasandPrompt(settings, 'thread', 'Prompt', [], () => {}, new AbortController().signal)).rejects.toThrow('closed')
        expect(FakeSocket.sent).toHaveLength(1)
        expect(calls).toHaveLength(0)
    })
    it('uses HTTP fallback only when the live request could not be sent', async () => {
        socketMode = 'unavailable'; payload = { message: 'HTTP answer', status: 'completed' }
        expect((await api.runHanasandPrompt(settings, 'thread', 'Prompt', [], () => {}, new AbortController().signal)).message).toBe('HTTP answer')
        expect(calls[0].url).toBe('https://api.example.test/api/tools/ai')
    })
    it('cancels the live listener without submitting a fallback request', async () => {
        socketMode = 'hold'
        const controller = new AbortController()
        const pending = api.runHanasandPrompt(settings, 'thread', 'Prompt', [], () => {}, controller.signal)
        controller.abort()
        await expect(pending).rejects.toThrow('Stopped listening')
        expect(FakeSocket.closed).toBe(1)
        expect(calls).toHaveLength(0)
    })
})


describe('AI history readiness', () => {
    const account = api.aiAccountScope(settings)
    const member = { scope: account, status: 'member' as const }
    const ready = { scope: api.aiPortalHistoryScope(account, 'chat'), status: 'ready' as const }
    it('requires complete current portal history for both agents in a persisted eligible chat', () => {
        expect(api.aiConversationContextReady(account, 'chat', true, member, ready)).toBe(true)
        for (const state of ['loading', 'error'] as const) {
            expect(api.aiConversationContextReady(account, 'chat', true, member, { ...ready, status: state })).toBe(false)
            expect(api.aiConversationContextReady(account, 'chat', true, { scope: account, status: state }, ready)).toBe(false)
        }
        expect(api.aiConversationContextReady(account, 'other-chat', true, member, ready)).toBe(false)
    })
    it('old account/service/organization/impersonation readiness cannot unlock a new scope', () => {
        for (const changed of [{ authToken: 'new-token' }, { userId: 'other' }, { selectedOrganizationId: 'other-org' }, { siteBaseUrl: 'https://other.test' }, { apiBaseUrl: 'https://other.test/api' }, { impersonatingUserId: 'other' }, { impersonationToken: 'other-token' }]) {
            const next = api.aiAccountScope({ ...settings, ...changed })
            expect(next).not.toBe(account)
            expect(api.aiConversationContextReady(next, 'chat', true, member, ready)).toBe(false)
            expect(api.aiConversationContextReady(next, 'chat', true, { ...member, scope: next }, ready)).toBe(false)
        }
    })
    it('fresh Hanasand chats have no history dependency; verified nonmembers need no portal request', () => {
        for (const status of ['loading', 'error'] as const) expect(api.aiConversationContextReady(account, 'fresh', false, { scope: '', status }, { scope: '', status: 'loading' })).toBe(true)
        expect(api.aiConversationContextReady(account, 'chat', true, { scope: account, status: 'nonmember' }, { scope: '', status: 'loading' })).toBe(true)
        expect(api.aiConversationContextReady(account, 'chat', true, { scope: 'old', status: 'nonmember' }, ready)).toBe(false)
    })
    it('a successful scoped retry restores readiness without accepting old history', () => {
        const failed = { scope: ready.scope, status: 'error' as const }
        expect(api.aiConversationContextReady(account, 'chat', true, member, failed)).toBe(false)
        expect(api.aiConversationContextReady(account, 'chat', true, member, ready)).toBe(true)
    })
    it('requires verified membership for fresh ChatGPT while preserving fresh Hanasand and uncertain-submit guards', () => {
        for (const status of ['loading', 'error', 'nonmember'] as const) {
            const lookup = { scope: account, status }
            expect(api.aiAgentCanSubmit('hanasand', true, account, lookup, false)).toBe(true)
            expect(api.aiAgentCanSubmit('chatgpt', true, account, lookup, false)).toBe(false)
        }
        expect(api.aiAgentCanSubmit('chatgpt', true, account, member, false)).toBe(true)
        expect(api.aiAgentCanSubmit('chatgpt', true, account, member, true)).toBe(false)
        expect(api.aiAgentCanSubmit('chatgpt', true, 'other', member, false)).toBe(false)
        expect(api.aiAgentCanSubmit('hanasand', false, account, member, false)).toBe(false)
    })
    it('historical assistant labels use message provenance, never composer selection', () => {
        const assistant = { id: 'legacy', role: 'assistant' as const, content: 'Old answer', createdAt: 1 }
        expect(api.aiMessageLabel(assistant)).toBe('Assistant')
        expect(api.aiMessageLabel({ ...assistant, modelName: null })).toBe('Assistant')
        expect(api.aiMessageLabel({ ...assistant, modelName: 'Hanasand GPT' })).toBe('Hanasand GPT')
        expect(api.aiMessageLabel({ ...assistant, modelName: 'ChatGPT' })).toBe('ChatGPT')
        expect(api.aiMessageLabel({ ...assistant, role: 'user' })).toBe('You')
    })
})
