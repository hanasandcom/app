import { Platform } from 'react-native'
import { create, isSupported } from 'react-native-passkeys'
import type { AppSettings } from '../types'
import { apiFetch } from './api'
import { organizationListBase } from './organization-endpoint'
import { supportBase } from './support-endpoint'
import { headerRecord, setHeader } from './headers'
export { supportBase } from './support-endpoint'

export type AccountIdentity = { id: string; name: string; username: string; email?: string; active?: boolean }
export type AccountSession = {
    token_id: number; id: string; ip: string | null; private_ip?: string; current: boolean; user_agent: string
    created_at: string; last_seen_at: string; revoked_at: string | null
    network?: { provider?: string | null; country?: string | null; region?: string | null; city?: string | null } | null
}

/** Device hints are descriptive; only the server's current flag identifies this session. */
export function describeAccountSession(session: AccountSession) {
    const agent = session.user_agent || ''
    let device = 'Device details unavailable'
    if (/hanasand[-_\s]?desktop|desktop[-_\s]?app|tauri|electron/i.test(agent)) device = 'Hanasand desktop app'
    else if (/hanasand[-_\s]?mobile|mobile[-_\s]?app|reactnative|expo|okhttp/i.test(agent)) device = 'Mobile app'
    else if (agent && !(!session.ip && /^Bun\//i.test(agent))) {
        if (/curl|node|bun\/|monitor|playwright|python/i.test(agent)) device = 'Automation or API client'
        else {
            const os = /iphone/i.test(agent) ? 'iPhone' : /ipad/i.test(agent) ? 'iPad' : /android/i.test(agent) ? 'Android' : /windows/i.test(agent) ? 'Windows' : /macintosh|mac os x/i.test(agent) ? 'macOS' : /linux/i.test(agent) ? 'Linux' : ''
            const browser = /Edg[AiOS]*\//i.test(agent) ? 'Edge' : /OPR\//i.test(agent) ? 'Opera' : /Firefox\/|FxiOS\//i.test(agent) ? 'Firefox' : /Chrome\/|CriOS\//i.test(agent) ? 'Chrome' : /Safari\//i.test(agent) ? 'Safari' : ''
            device = browser && os ? `${browser} on ${os}` : browser || os || 'Unknown client'
        }
    }
    const privateAddress = !session.ip && session.private_ip
    const location = [...new Set([session.network?.city, session.network?.region, session.network?.country].filter(Boolean))].join(', ')
    return {
        device,
        address: session.ip ? `Public IP ${session.ip}` : privateAddress ? `Private IP ${privateAddress}` : 'Public IP was not captured for this login',
        network: privateAddress ? 'Private network' : session.network?.provider || 'Unavailable',
        location: privateAddress ? 'Unavailable for private addresses' : location || 'Unavailable',
    }
}

export function visibleSessionLocation(location: string) {
    const value = location.trim().replace(/^approximate\s+location\s*:\s*/i, '').trim()
    return !value || /^unavailable(?:\s+for\s+private\s+addresses)?$/i.test(value) ? null : value
}

export function filterAccountSessions(sessions: AccountSession[], query: string) {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return sessions
    return sessions.filter(session => {
        const details = describeAccountSession(session)
        const searchable = [details.device, details.address, details.network, details.location, session.user_agent, session.current ? 'this device current session' : '', session.revoked_at ? 'revoked' : 'active'].join(' ').toLocaleLowerCase()
        return terms.every(term => searchable.includes(term))
    })
}
export type AccountPasskey = { credentialId: string; label: string; algorithm: string; createdAt: string; lastUsedAt: string | null }
export type AccountSshKey = {
    id: number; name: string; fingerprint: string; keyType: string; addedAt: string
    lastUsedAt: string | null; lastUsedServer: string | null; lastUsedIp: string | null; lastUsedUserAgent: string | null
}
export type SupportTicket = { id: string; subject: string; status: string; last_message?: string; updated_at: string
    user_id?: string | null; resolution_version?: number; feedback_rating?: number | null; feedback_comment?: string | null }
export type SupportMessage = { id: string; sender_id: string | null; sender_name: string; body: string; created_at: string }
export type Organization = {
    id: string; tenantId?: string; name: string; slug?: string; role?: string; status?: string; lifecycleStatus?: string
    memberCount?: number; ownerCount?: number; activeMemberCount?: number; pendingInviteCount?: number; sharedWatchlistCount?: number
}
export type OrganizationMember = { userId: string; email?: string; name?: string; role: string; status: string; joinedAt?: string }
export type OrganizationInvite = { id: string; email: string; role: string; status: string; expiresAt?: string }
export type OrganizationSettings = {
    name?: string; slug?: string; defaultWebhookPolicy?: string; alertVisibilityPolicy?: string
    lifecycleStatus?: string; retentionDays?: number
}

export class AccountRequestError extends Error {
    constructor(message: string, readonly status: number) { super(message) }
}

/** Uses the same authenticated transport as the other native account APIs. */
export async function accountRequest<T>(settings: AppSettings, path: string, init: RequestInit = {}, base = settings.apiBaseUrl): Promise<T> {
    if (!settings.authToken || !settings.userId) throw new Error('Log in again to manage your account.')
    const url = `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
    if (new URL(url).protocol !== 'https:') throw new Error('Use HTTPS for account services.')
    const requestHeaders = headerRecord(init.headers)
    setHeader(requestHeaders, 'Content-Type', 'application/json')
    setHeader(requestHeaders, 'Authorization', `Bearer ${settings.authToken}`)
    setHeader(requestHeaders, 'id', settings.userId)
    if (settings.impersonationToken) setHeader(requestHeaders, 'x-impersonation-token', settings.impersonationToken)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    const cancel = () => controller.abort()
    if (init.signal?.aborted) controller.abort()
    else init.signal?.addEventListener('abort', cancel)
    let response: Response
    try {
        response = await apiFetch(settings, url, {
            ...init,
            headers: requestHeaders,
            signal: controller.signal,
        })
    } finally {
        clearTimeout(timer)
        init.signal?.removeEventListener('abort', cancel)
    }
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
        const error = payload?.error
        throw new AccountRequestError(typeof error === 'string' ? error : error?.message || `Request failed (${response.status}).`, response.status)
    }
    if (payload === null && response.status !== 204) throw new Error('The service returned an invalid response.')
    return payload as T
}

function list<T>(payload: Record<string, unknown>, key: string): T[] {
    if (!Array.isArray(payload[key])) throw new Error('The service returned an invalid list.')
    return payload[key] as T[]
}

export const fetchAccountIdentity = (settings: AppSettings) => accountRequest<AccountIdentity>(settings, `user/${encodeURIComponent(settings.userId)}`)
export const updateAccountIdentity = (settings: AppSettings, name: string, username: string) => accountRequest<AccountIdentity>(settings, 'user/self', { method: 'PUT', body: JSON.stringify({ name: name.trim(), username: username.trim() }) })
export const fetchAccountSessions = async (settings: AppSettings) => list<AccountSession>(await accountRequest(settings, 'auth/sessions'), 'sessions')
export async function revokeAccountSession(settings: AppSettings, tokenId: number) {
    const result = await accountRequest<{ revoked: boolean }>(settings, `auth/sessions/${tokenId}`, { method: 'DELETE' })
    if (result.revoked !== true) throw new Error('This session could not be revoked. Refresh sessions and try again.')
}
export async function logOutCurrentAccountSession(settings: AppSettings, clearLocalSession: () => Promise<void>, selected?: AccountSession) {
    let serverRevoked = false
    try {
        const current = selected ?? (await fetchAccountSessions(settings)).find(session => session.current && !session.revoked_at)
        if (current?.current && !current.revoked_at) {
            await revokeAccountSession(settings, current.token_id)
            serverRevoked = true
        }
    } catch {
        // A remote failure must not prevent removing this device's credentials.
    }
    await clearLocalSession()
    return { serverRevoked }
}
export const revokeOtherAccountSessions = (settings: AppSettings) => accountRequest(settings, 'auth/sessions/revoke', { method: 'POST', body: JSON.stringify({ keep_current: true }) })
export const fetchAccountPasskeys = async (settings: AppSettings) => list<AccountPasskey>(await accountRequest(settings, 'auth/passkeys'), 'passkeys')
export const removeAccountPasskey = (settings: AppSettings, id: string) => accountRequest(settings, `auth/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' })
export const renameAccountPasskey = (settings: AppSettings, id: string, label: string) => accountRequest(settings, `auth/passkeys/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ label: label.trim() }) })
export const nativePasskeysSupported = () => (Platform.OS === 'ios' || Platform.OS === 'android') && isSupported()
export async function registerAccountPasskey(settings: AppSettings) {
    if (!nativePasskeysSupported()) throw new Error('Passkeys are unavailable on this device.')
    const options = await accountRequest<{ challengeId: string; publicKey: Parameters<typeof create>[0] }>(settings, 'auth/passkeys/register/options')
    if (!options.challengeId || !options.publicKey?.challenge) throw new Error('Unable to start passkey enrollment.')
    const credential = await create(options.publicKey)
    if (!credential) throw new Error('No passkey was created.')
    await accountRequest(settings, 'auth/passkeys/register/verify', {
        method: 'POST', body: JSON.stringify({ challengeId: options.challengeId, credential, label: Platform.OS === 'ios' ? 'Passkey iPhone' : 'Passkey Android' }),
    })
}
export const fetchAccountSshKeys = async (settings: AppSettings) => list<AccountSshKey>(await accountRequest(settings, 'user/self/ssh-keys'), 'keys')
export const addAccountSshKey = (settings: AppSettings, name: string, publicKey: string) => accountRequest(settings, 'user/self/ssh-keys', { method: 'POST', body: JSON.stringify({ name: name.trim(), publicKey: publicKey.trim() }) })
export const removeAccountSshKey = (settings: AppSettings, id: number) => accountRequest(settings, `user/self/ssh-keys/${id}`, { method: 'DELETE' })
// In-memory scope only. Never log or persist this credential-bearing key.
export function supportAccountScope(settings: AppSettings) {
    return JSON.stringify([supportBase(), settings.apiBaseUrl, settings.userId, settings.authToken, settings.impersonationToken, settings.impersonatingUserId])
}
export function supportTicketAccess(settings: AppSettings, ticket?: SupportTicket) {
    const ownAccount = !settings.impersonationToken && !settings.impersonatingUserId
    const owned = ownAccount && ticket?.user_id === settings.userId
    return { ownAccount, canReply: owned && ticket?.status === 'open', canFeedback: owned && ticket?.status === 'closed'
        && Number.isSafeInteger(ticket.resolution_version) && Number(ticket.resolution_version) >= 0 && ticket.feedback_rating === null }
}
function retryableSupportReadFailure(error: unknown) {
    if (error instanceof AccountRequestError) return error.status === 429 || error.status >= 500
    return error instanceof TypeError && /network request failed|failed to fetch|network error/i.test(error.message)
}
function waitForSupportRetry(signal: AbortSignal | undefined, delayMs: number) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) { reject(signal.reason || new Error('Support request was cancelled.')); return }
        const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve() }, delayMs)
        const cancel = () => { clearTimeout(timer); reject(signal?.reason || new Error('Support request was cancelled.')) }
        signal?.addEventListener('abort', cancel, { once: true })
    })
}
async function supportReadWithRetry<T>(read: () => Promise<T>, signal?: AbortSignal, retryDelayMs = 500) {
    try { return await read() }
    catch (error) {
        if (signal?.aborted || !retryableSupportReadFailure(error)) throw error
        await waitForSupportRetry(signal, retryDelayMs)
        return read()
    }
}
function supportWrite(settings: AppSettings) {
    if (!supportTicketAccess(settings).ownAccount) throw new Error('Return to your own account to write to Support.')
}
function supportId(id: string) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) throw new Error('Choose a valid support conversation.')
    return encodeURIComponent(id)
}
export const fetchAccountSupportTickets = async (settings: AppSettings, signal?: AbortSignal) => supportReadWithRetry(
    async () => list<SupportTicket>(await accountRequest(settings, 'support/my-tickets', { signal, credentials: 'omit' }, supportBase()), 'tickets'), signal,
)
export const fetchSupportMessages = async (settings: AppSettings, id: string, signal?: AbortSignal) => supportReadWithRetry(
    async () => list<SupportMessage>(await accountRequest(settings, `support/tickets/${supportId(id)}/messages`, { signal, credentials: 'omit' }, supportBase()), 'messages'), signal,
)
export function sendSupportMessage(settings: AppSettings, id: string, subject: string, message: string, requestId?: string) {
    supportWrite(settings)
    if (!message.trim() || message.length > 10000 || subject.length > 160) throw new Error('Keep the subject under 160 characters and the message under 10,000 characters.')
    return accountRequest<{ id?: string; messageId?: string; ok?: boolean }>(settings, id ? `support/tickets/${supportId(id)}/messages` : 'support/tickets', {
        method: 'POST', credentials: 'omit', body: JSON.stringify(id ? { message: message.trim(), ...(requestId ? { requestId } : {}) } : { subject: subject.trim(), message: message.trim() }),
    }, supportBase()).then(result => {
        if (id ? result?.ok !== true || !result.messageId : !result?.id) throw new Error('Message delivery was not confirmed. Refresh to check the conversation.')
        return result
    })
}
export function sendSupportFeedback(settings: AppSettings, ticket: SupportTicket, rating: number, comment: string) {
    supportWrite(settings)
    if (!supportTicketAccess(settings, ticket).canFeedback) throw new Error('Refresh your closed conversation before leaving feedback.')
    if (!Number.isInteger(rating) || rating < 1 || rating > 5 || comment.length > 2000) throw new Error('Choose 1–5 stars and keep feedback under 2,000 characters.')
    return accountRequest<{ ok: boolean }>(settings, `support/tickets/${supportId(ticket.id)}/feedback`, { method: 'POST', credentials: 'omit',
        body: JSON.stringify({ rating, comment: rating <= 3 ? comment.trim() : '', resolutionVersion: ticket.resolution_version }),
    }, supportBase()).then(result => { if (result?.ok !== true) throw new Error('Feedback was not confirmed. Refresh to check it.'); return result })
}
export const fetchOrganizations = async (settings: AppSettings, signal?: AbortSignal) => list<Organization>(await accountRequest(settings, 'organizations', { signal }, organizationListBase(settings)), 'organizations')

function retryableOrganizationReadFailure(error: unknown) {
    if (error instanceof AccountRequestError) return error.status === 429 || error.status >= 500
    return error instanceof TypeError && /network request failed|failed to fetch|network error/i.test(error.message)
}

function waitForOrganizationRetry(signal: AbortSignal | undefined, delayMs: number) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) { reject(signal.reason || new Error('Organization lookup was cancelled.')); return }
        const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve() }, delayMs)
        const cancel = () => { clearTimeout(timer); reject(signal?.reason || new Error('Organization lookup was cancelled.')) }
        signal?.addEventListener('abort', cancel, { once: true })
    })
}

/** Retry one transient failure while loading the workspace picker on app startup. */
export async function fetchOrganizationsWithRetry(settings: AppSettings, signal?: AbortSignal, retryDelayMs = 500) {
    try {
        return await fetchOrganizations(settings, signal)
    } catch (error) {
        if (signal?.aborted || !retryableOrganizationReadFailure(error)) throw error
        await waitForOrganizationRetry(signal, retryDelayMs)
        return fetchOrganizations(settings, signal)
    }
}
export const organizationPath = (id: string, suffix: string) => `organizations/${encodeURIComponent(id)}/${suffix}`
export const fetchOrganizationMembers = async (settings: AppSettings, id: string) => list<OrganizationMember>(await accountRequest(settings, organizationPath(id, 'members')), 'members')
export const fetchOrganizationInvites = async (settings: AppSettings, id: string) => list<OrganizationInvite>(await accountRequest(settings, organizationPath(id, 'invites')), 'invites')
export async function fetchOrganizationSettings(settings: AppSettings, id: string): Promise<OrganizationSettings> {
    const payload = await accountRequest<{ settings: OrganizationSettings; organization?: Organization }>(settings, organizationPath(id, 'settings'))
    return { ...payload.settings, name: payload.organization?.name ?? payload.settings?.name, slug: payload.organization?.slug ?? payload.settings?.slug }
}
