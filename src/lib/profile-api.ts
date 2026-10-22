import { Platform } from 'react-native'
import { create, isSupported } from 'react-native-passkeys'
import type { AppSettings } from '../types'
import { apiFetch } from './api'

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
export type SupportTicket = { id: string; subject: string; status: string; last_message?: string; updated_at: string }
export type SupportMessage = { id: string; sender_id: string | null; sender_name: string; body: string; created_at: string }
export type Organization = {
    id: string; tenantId?: string; name: string; slug?: string; role?: string; status?: string; lifecycleStatus?: string
    memberCount?: number; activeMemberCount?: number; pendingInviteCount?: number; sharedWatchlistCount?: number
}
export type OrganizationMember = { userId: string; email?: string; name?: string; role: string; status: string; joinedAt?: string }
export type OrganizationInvite = { id: string; email: string; role: string; status: string; expiresAt?: string }
export type OrganizationSettings = {
    name?: string; slug?: string; defaultWebhookPolicy?: string; alertVisibilityPolicy?: string
    lifecycleStatus?: string; retentionDays?: number
}

/** Uses the same authenticated transport as the other native account APIs. */
export async function accountRequest<T>(settings: AppSettings, path: string, init: RequestInit = {}, base = settings.apiBaseUrl): Promise<T> {
    if (!settings.authToken || !settings.userId) throw new Error('Log in again to manage your account.')
    const url = `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
    if (new URL(url).protocol !== 'https:') throw new Error('Use HTTPS for account services.')
    const requestHeaders = new Headers(init.headers)
    requestHeaders.set('Content-Type', 'application/json')
    requestHeaders.set('Authorization', `Bearer ${settings.authToken}`)
    requestHeaders.set('id', settings.userId)
    if (settings.impersonationToken) requestHeaders.set('x-impersonation-token', settings.impersonationToken)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    let response: Response
    try {
        response = await apiFetch(settings, url, {
            ...init,
            headers: requestHeaders,
            signal: init.signal || controller.signal,
        })
    } finally {
        clearTimeout(timer)
    }
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
        const error = payload?.error
        throw new Error(typeof error === 'string' ? error : error?.message || `Request failed (${response.status}).`)
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
export const fetchAccountSupportTickets = async (settings: AppSettings) => list<SupportTicket>(await accountRequest(settings, 'support/my-tickets', {}, process.env.EXPO_PUBLIC_SUPPORT_API || 'https://support.hanasand.com/api'), 'tickets')
export const fetchSupportMessages = async (settings: AppSettings, id: string) => list<SupportMessage>(await accountRequest(settings, `support/tickets/${encodeURIComponent(id)}/messages`, {}, process.env.EXPO_PUBLIC_SUPPORT_API || 'https://support.hanasand.com/api'), 'messages')
export const sendSupportMessage = (settings: AppSettings, id: string, subject: string, message: string) => accountRequest<{ id?: string }>(settings, id ? `support/tickets/${encodeURIComponent(id)}/messages` : 'support/tickets', { method: 'POST', body: JSON.stringify(id ? { message } : { subject, message }) }, process.env.EXPO_PUBLIC_SUPPORT_API || 'https://support.hanasand.com/api')
export const fetchOrganizations = async (settings: AppSettings) => list<Organization>(await accountRequest(settings, 'organizations'), 'organizations')
export const organizationPath = (id: string, suffix: string) => `organizations/${encodeURIComponent(id)}/${suffix}`
export const fetchOrganizationMembers = async (settings: AppSettings, id: string) => list<OrganizationMember>(await accountRequest(settings, organizationPath(id, 'members')), 'members')
export const fetchOrganizationInvites = async (settings: AppSettings, id: string) => list<OrganizationInvite>(await accountRequest(settings, organizationPath(id, 'invites')), 'invites')
export async function fetchOrganizationSettings(settings: AppSettings, id: string): Promise<OrganizationSettings> {
    const payload = await accountRequest<{ settings: OrganizationSettings; organization?: Organization }>(settings, organizationPath(id, 'settings'))
    return { ...payload.settings, name: payload.organization?.name ?? payload.settings?.name, slug: payload.organization?.slug ?? payload.settings?.slug }
}
