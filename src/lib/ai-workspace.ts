import * as Crypto from 'expo-crypto'
import type { AiChatMessage, AiRunDetails, AppSettings } from '../types'
import { apiFetch } from './api'

export type WorkspaceMessage = Omit<AiChatMessage, 'role'> & {
    role: 'user' | 'assistant' | 'tool'
    modelName?: string | null
    metadata?: Record<string, unknown>
}
export type AiConversation = {
    id: string
    title: string
    messages: WorkspaceMessage[]
    archivedAt?: string | null
    updatedAt: string
    collaboration?: { role?: string }
}
export type PromptPortalItem = {
    id: string
    conversationId?: string
    threadId?: string
    prompt: string
    status: 'queued' | 'running' | 'done' | 'error'
    priority: 'now' | 'next'
    createdAt: string
    startedAt?: string
    completedAt?: string
    result?: string
    files?: Array<{ id: string; name?: string }>
}
export type PromptContextMessage = { role: 'user' | 'assistant'; content: string; modelName?: string; files?: Array<{ itemId: string; fileId: string }> }

export type AiMembershipState = { scope: string; status: 'loading' | 'member' | 'nonmember' | 'error'; error?: string }
export type AiPortalHistoryState = { scope: string; status: 'loading' | 'ready' | 'error' }
class AiServiceHttpError extends Error {
    constructor(message: string, readonly status: number) { super(message) }
}
export function aiAccountScope(settings: AppSettings) {
    // Memory-only scope: never persist, render, or log credentials.
    return JSON.stringify([settings.siteBaseUrl, settings.apiBaseUrl, settings.userId, settings.authToken, settings.impersonatingUserId, settings.impersonationToken, settings.selectedOrganizationId])
}
export function aiPortalHistoryScope(account: string, conversationId: string) { return JSON.stringify([account, conversationId]) }
export function aiConversationContextReady(account: string, conversationId: string, persisted: boolean, membership: AiMembershipState, history: AiPortalHistoryState) {
    if (!persisted) return true
    if (membership.scope !== account || membership.status === 'loading' || membership.status === 'error') return false
    return membership.status === 'nonmember' || history.scope === aiPortalHistoryScope(account, conversationId) && history.status === 'ready'
}
export function aiAgentCanSubmit(agent: 'hanasand' | 'chatgpt', contextReady: boolean, account: string, membership: AiMembershipState, uncertain: boolean) {
    return contextReady && (agent === 'hanasand' || membership.scope === account && membership.status === 'member' && !uncertain)
}
export function aiMessageLabel(message: WorkspaceMessage) {
    return message.role === 'user' ? 'You' : message.modelName || (message.role === 'tool' ? 'Tool' : 'Assistant')
}

function endpoint(base: string, path: string) {
    const url = `${base.trim().replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
    if (new URL(url).protocol !== 'https:') throw new Error('Use HTTPS for AI services.')
    return url
}
async function request<T>(settings: AppSettings, url: string, init: RequestInit = {}, timeoutMs = 20000): Promise<T> {
    if (!settings.userId || !settings.authToken) throw new Error('Sign in to use your AI workspace.')
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${settings.authToken}`)
    headers.set('id', settings.userId)
    if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
    const controller = new AbortController()
    const abort = () => controller.abort()
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    init.signal?.addEventListener('abort', abort, { once: true })
    if (init.signal?.aborted) controller.abort()
    let response: Response
    let body
    try {
        response = await apiFetch(settings, url, { ...init, headers, signal: controller.signal })
        body = await response.json().catch(() => null)
    } catch (cause) {
        if (timedOut) throw new Error('The AI service request timed out.', { cause })
        throw cause
    } finally {
        clearTimeout(timeout)
        init.signal?.removeEventListener('abort', abort)
    }
    if (!response.ok) throw new AiServiceHttpError(typeof body?.error === 'string' ? body.error : body?.error?.message || `AI service request failed (${response.status}).`, response.status)
    if (!body || typeof body !== 'object') throw new Error('The AI service returned an invalid response.')
    return body as T
}
function workspaceUrl(settings: AppSettings, path: string) { return endpoint(settings.siteBaseUrl, `api/backend/ai/${path}`) }
function normalizeMessage(value: Omit<WorkspaceMessage, 'createdAt'> & { createdAt: number | string }): WorkspaceMessage {
    const createdAt = typeof value.createdAt === 'number' ? value.createdAt : Date.parse(value.createdAt)
    return {
        ...value, createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
        durationMs: value.durationMs ?? (typeof value.metadata?.durationMs === 'number' ? value.metadata.durationMs : undefined),
        thoughtSummary: value.thoughtSummary ?? (typeof value.metadata?.thoughtSummary === 'string' ? value.metadata.thoughtSummary : undefined),
        toolUses: value.toolUses ?? (Array.isArray(value.metadata?.toolUses) ? value.metadata.toolUses as AiChatMessage['toolUses'] : undefined),
        fileSummaries: value.fileSummaries ?? (Array.isArray(value.metadata?.fileSummaries) ? value.metadata.fileSummaries as AiChatMessage['fileSummaries'] : undefined),
    }
}
function normalizeConversation(value: AiConversation): AiConversation {
    if (!value.id || !Array.isArray(value.messages)) throw new Error('The AI service returned an invalid conversation.')
    const messages = value.messages.map(normalizeMessage)
    // Older native single-turn chats could persist both rows in the same millisecond.
    // Keep ambiguous multi-turn and tool histories in their original server order.
    if (messages.length === 2 && messages[0].role === 'assistant' && messages[1].role === 'user'
        && messages[0].createdAt === messages[1].createdAt) messages.reverse()
    return { ...value, messages, title: value.title || 'New chat' }
}
export function nextAiMessageTimestamp(messages: Pick<WorkspaceMessage, 'createdAt'>[], now = Date.now()) {
    return messages.reduce((next, message) => Number.isFinite(message.createdAt) ? Math.max(next, message.createdAt + 1) : next, now)
}
export function newConversation(): AiConversation {
    return { id: Crypto.randomUUID(), title: 'New chat', messages: [], updatedAt: new Date().toISOString() }
}
export async function fetchAiWorkspace(settings: AppSettings, signal?: AbortSignal): Promise<AiConversation[]> {
    const body = await request<{ conversations?: AiConversation[] }>(settings, workspaceUrl(settings, 'workspace'), { signal })
    if (!Array.isArray(body.conversations)) throw new Error('The AI service returned an invalid workspace.')
    return body.conversations.map(normalizeConversation)
}
function retryableReadFailure(error: unknown) {
    if (error instanceof AiServiceHttpError) return error.status === 429 || error.status >= 500
    if (error instanceof TypeError) return /network request failed|failed to fetch|network error/i.test(error.message)
    return error instanceof Error && error.message === 'The AI service request timed out.'
}
function waitForReadRetry(signal: AbortSignal | undefined, delayMs: number) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) { reject(signal.reason || new Error('Workspace lookup was cancelled.')); return }
        const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve() }, delayMs)
        const cancel = () => { clearTimeout(timer); reject(signal?.reason || new Error('Workspace lookup was cancelled.')) }
        signal?.addEventListener('abort', cancel, { once: true })
    })
}
/** Retry one transient website workspace read; never replay writes or auth failures. */
export async function fetchAiWorkspaceWithRetry(settings: AppSettings, signal?: AbortSignal, retryDelayMs = 400) {
    try {
        return await fetchAiWorkspace(settings, signal)
    } catch (error) {
        if (signal?.aborted || !retryableReadFailure(error)) throw error
        await waitForReadRetry(signal, retryDelayMs)
        return fetchAiWorkspace(settings, signal)
    }
}
export async function createAiConversation(settings: AppSettings, conversation: AiConversation): Promise<AiConversation> {
    const body = await request<AiConversation>(settings, workspaceUrl(settings, 'conversations'), {
        method: 'POST', body: JSON.stringify({ id: conversation.id, title: conversation.title, modelStrategy: 'auto' }),
    })
    // The creation response has no message rows; preserve the local draft until hydration.
    return normalizeConversation({ ...body, messages: body.messages || [] })
}
export async function persistAiMessage(settings: AppSettings, conversationId: string, message: WorkspaceMessage) {
    await request(settings, workspaceUrl(settings, `conversations/${encodeURIComponent(conversationId)}/messages`), {
        method: 'PUT', body: JSON.stringify({
            ...message, createdAt: new Date(message.createdAt).toISOString(),
            pending: Boolean(message.pending), error: Boolean(message.error), modelName: message.modelName || null,
            metadata: { ...message.metadata, durationMs: message.durationMs, thoughtSummary: message.thoughtSummary, toolUses: message.toolUses, fileSummaries: message.fileSummaries },
        }),
    })
}
export function chatGptThreadId(conversationId: string) { return `chatgpt-${conversationId}` }
function portalUrl(settings: AppSettings, conversationId?: string) {
    const url = endpoint(settings.siteBaseUrl, 'api/prompt')
    return conversationId ? `${url}?${new URLSearchParams({ conversationId, threadId: chatGptThreadId(conversationId) })}` : url
}
function portalItems(payload: { items?: PromptPortalItem[] }, conversationId: string) {
    if (!Array.isArray(payload.items)) throw new Error('ChatGPT returned an invalid activity list.')
    return payload.items.filter(item => item.threadId ? item.threadId === chatGptThreadId(conversationId) : item.conversationId === conversationId)
        .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id))
}
export async function fetchChatGptActivity(settings: AppSettings, conversationId: string, signal?: AbortSignal) {
    return portalItems(await request(settings, portalUrl(settings, conversationId), { signal }), conversationId)
}
export async function fetchChatGptActivityWithRetry(settings: AppSettings, conversationId: string, signal?: AbortSignal, retryDelayMs = 400) {
    try {
        return await fetchChatGptActivity(settings, conversationId, signal)
    } catch (error) {
        if (signal?.aborted || !retryableReadFailure(error)) throw error
        await waitForReadRetry(signal, retryDelayMs)
        return fetchChatGptActivity(settings, conversationId, signal)
    }
}
export async function submitChatGptPrompt(settings: AppSettings, conversationId: string, prompt: string, context: PromptContextMessage[], signal?: AbortSignal) {
    const form = new FormData()
    form.append('prompt', prompt)
    form.append('conversationId', conversationId)
    form.append('threadId', chatGptThreadId(conversationId))
    form.append('priority', 'next')
    form.append('context', JSON.stringify(context))
    return portalItems(await request(settings, portalUrl(settings), { method: 'POST', body: form, signal }), conversationId)
}
export function portalMessages(items: PromptPortalItem[]): WorkspaceMessage[] {
    return items.flatMap(item => {
        const pending = item.status === 'queued' || item.status === 'running'
        const statusText = item.status === 'queued' ? (item.priority === 'now' ? 'Up next' : 'In the queue')
            : item.status === 'running' ? 'ChatGPT is working' : item.status === 'done' ? 'Finished' : 'Could not complete'
        const metadata = { promptPortalId: item.id, promptPortalStatus: item.status, threadId: item.threadId, statusText, files: item.files }
        return [
            { id: `${item.id}-request`, role: 'user' as const, content: item.prompt, createdAt: Date.parse(item.createdAt), modelName: 'ChatGPT', metadata },
            { id: `${item.id}-response`, role: 'assistant' as const, content: pending ? `${statusText}…` : item.result || (item.status === 'error' ? 'The request could not be completed.' : 'Completed without a text response.'), createdAt: Date.parse(item.completedAt || item.startedAt || item.createdAt), modelName: 'ChatGPT', pending, error: item.status === 'error', metadata },
        ]
    })
}
export function workspaceMessages(messages: WorkspaceMessage[], portal: PromptPortalItem[]): WorkspaceMessage[] {
    return [...messages, ...portalMessages(portal)].sort((left, right) => left.createdAt - right.createdAt)
}
export function conversationContext(messages: WorkspaceMessage[], portal: PromptPortalItem[]): PromptContextMessage[] {
    return workspaceMessages(messages, portal)
        .filter(message => !message.pending && !message.error && message.content.trim())
        .map(message => {
            const itemId = String(message.metadata?.promptPortalId || '')
            const files = itemId && Array.isArray(message.metadata?.files)
                ? (message.metadata.files as Array<{ id?: string }>).flatMap(file => file.id ? [{ itemId, fileId: file.id }] : []) : []
            return { role: message.role === 'user' ? 'user' : 'assistant', content: message.content, ...(message.modelName ? { modelName: message.modelName } : {}), ...(files.length ? { files } : {}) }
        })
}

/** Connects to the website's live model channel; falls back only before a prompt was submitted. */
export async function runHanasandPrompt(settings: AppSettings, conversationId: string, prompt: string, context: PromptContextMessage[], onDelta: (content: string) => void, signal: AbortSignal): Promise<AiRunDetails> {
    const socketUrl = endpoint(settings.apiBaseUrl, 'client/ws/gpt').replace(/^https:/, 'wss:')
    try {
        const message = await new Promise<string>((resolve, reject) => {
            let sent = false
            let content = ''
            let settled = false
            const socket = new WebSocket(socketUrl)
            const cleanup = () => { clearTimeout(timeout); signal.removeEventListener('abort', abort); socket.onclose = null; socket.onerror = null; socket.close() }
            const finish = (error?: Error, result?: string) => {
                if (settled) return
                settled = true
                cleanup()
                if (error) reject(Object.assign(error, { submitted: sent }))
                else resolve(result || '')
            }
            const abort = () => finish(Object.assign(new Error('Stopped listening for this response.'), { name: 'AbortError' }))
            let timeout = setTimeout(() => finish(new Error('The live model connection is unavailable.')), 5000)
            signal.addEventListener('abort', abort, { once: true })
            if (signal.aborted) { abort(); return }
            socket.onerror = () => finish(new Error('The live model connection failed.'))
            socket.onclose = () => finish(new Error('The live model connection closed before the answer finished.'))
            socket.onmessage = event => {
                if (settled) return
                try {
                    const body = JSON.parse(String(event.data))
                    if (body.type === 'snapshot' && !sent) {
                        const clients = Array.isArray(body.clients) ? body.clients : []
                        const client = clients.sort((a: { model?: { tps?: number } }, b: { model?: { tps?: number } }) => (b.model?.tps || 0) - (a.model?.tps || 0))[0]
                        if (!client?.name) { finish(new Error('No live model is connected.')); return }
                        socket.send(JSON.stringify({ type: 'prompt_request', conversationId, clientName: client.name, messages: [...context.map(({ role, content }) => ({ role, content })), { role: 'user', content: prompt }], maxTokens: 1024, temperature: 0.35 }))
                        sent = true
                        clearTimeout(timeout)
                        timeout = setTimeout(() => finish(new Error('The live model has not finished. Refresh this conversation before sending again.')), 90000)
                        return
                    }
                    if (!sent || body.conversationId !== conversationId) return
                    if (body.type === 'prompt_delta') { content += String(body.delta || ''); onDelta(content) }
                    if (body.type === 'prompt_complete') finish(undefined, String(body.content || content))
                    if (body.type === 'prompt_error') finish(new Error(String(body.error || 'The model failed to answer.')))
                } catch { finish(new Error('The live model returned an invalid response.')) }
            }
        })
        if (!message.trim()) throw Object.assign(new Error('The model finished without a text response.'), { submitted: true })
        return { message }
    } catch (error) {
        if (signal.aborted || (error as { submitted?: boolean }).submitted) throw error
        const body = await request<AiRunDetails & { status?: string }>(settings, endpoint(settings.siteBaseUrl, 'api/backend/tools/ai'), {
            method: 'POST', body: JSON.stringify({ prompt, context: JSON.stringify(context) }), signal,
        }, 120000)
        if (body.status === 'connecting') throw new Error(body.message || 'No model is connected. Try again shortly.', { cause: error })
        if (!body.message) throw new Error('The model returned no answer.', { cause: error })
        return body
    }
}
