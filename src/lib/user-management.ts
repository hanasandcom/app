import type { AppSettings } from '../types'
import { apiFetch } from './api'
import { organizationListBase } from './organization-endpoint'
import { reservedUsernames } from '../data/reserved-usernames'

export type UserOrganization = { id: string; name: string; slug: string; status: string }
export type ManagedUser = { id: string; name: string; username: string; email: string | null; active: boolean; avatar: string
    createdAt: string | null; lastLoginAt: string | null; deactivatedAt: string | null; deactivatedBy: string | null; organizations: UserOrganization[] }
export type ManagedProfile = { id: string; name: string; username: string; email: string | null; active: boolean; avatar: string; deletionScheduledAt: string | null }
export type UserAccess = { scope: string; canRead: boolean; canWrite: boolean }
export type UserSnapshot = { users: ManagedUser[]; access: UserAccess }
export type UserAction = 'activate' | 'deactivate' | 'delete'
export type UserMutationReceipt = { id: string; action: UserAction; active?: boolean; deletionScheduledAt?: string }
export class UserManagementError extends Error {
    constructor(message: string, readonly status = 0, readonly uncertain = false, readonly blocker?: { id: string; name: string; activeApiKey: boolean }) { super(message) }
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown) => typeof value === 'string' ? value : ''
export function userIdentifier(value: unknown): string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_.:@-]{1,200}$/.test(value) || ['.', '..'].includes(value)) throw new UserManagementError('The account identifier is invalid.')
    return value
}
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
export const userManagementScope = (settings: AppSettings) => JSON.stringify([settings.apiBaseUrl, settings.siteBaseUrl, settings.userId, settings.authToken, settings.selectedOrganizationId, settings.impersonationToken, settings.impersonatingUserId])
const own = (settings: AppSettings) => !settings.impersonationToken && !settings.impersonatingUserId
function address(base: string, path: string) {
    const url = new URL(base)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new UserManagementError('Users requires an HTTPS service address without credentials.')
    return `${url.href.replace(/\/+$/, '')}/${path}`
}
async function request(settings: AppSettings, path: string, signal: AbortSignal, init: RequestInit = {}, base = settings.apiBaseUrl) {
    if (!settings.userId || !settings.authToken) throw new UserManagementError('Sign in to manage users.', 401)
    const controller = new AbortController(), abort = () => controller.abort()
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true })
    const write = !!init.method && !['GET', 'HEAD'].includes(init.method)
    const timeout = setTimeout(abort, 25000)
    try {
        if (controller.signal.aborted) throw new UserManagementError('Request cancelled.')
        const response = await apiFetch({ ...settings, selectedOrganizationId: undefined }, address(base, path), {
            ...init, signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${settings.authToken}`, id: settings.userId,
                ...(settings.impersonationToken ? { 'x-impersonation-token': settings.impersonationToken } : {}) }
        })
        const value: unknown = await response.json().catch(() => null)
        if (controller.signal.aborted) throw new UserManagementError('The request was interrupted. Refresh and review before continuing.', 0, write)
        if (response.status === 404 && path === 'users' && record(value).error === 'There are no users.') return { value: [], status: 200 }
        if (!response.ok) {
            const body = record(value)
            const blocker = response.status === 409 && body.code === 'organization_ownership_transfer_required'
                ? { id: userIdentifier(body.organization_id), name: text(body.organization_name), activeApiKey: body.active_api_key === true } : undefined
            throw new UserManagementError(response.status === 401 ? 'Your session could not be verified.' : response.status === 403 ? 'Hanasand access is required.'
                : blocker ? `Transfer ownership or archive ${blocker.name || 'the organization'} before scheduling deletion.`
                    : response.status === 404 ? 'The account or profile is unavailable or not visible to you.' : 'Users is unavailable. Refresh and review before continuing.', response.status, write && response.status >= 500, blocker)
        }
        return { value, status: response.status }
    } catch (cause) {
        if (cause instanceof UserManagementError) throw cause
        throw new UserManagementError(write ? 'The outcome is unknown. Refresh and review before another action.' : 'Users could not be loaded. Refresh to retry.', 0, write)
    } finally { clearTimeout(timeout); signal.removeEventListener('abort', abort) }
}
export function parseManagedUsers(value: unknown, impersonated = false): ManagedUser[] {
    if (!Array.isArray(value) || value.length > 20000) throw new UserManagementError('The user directory response is invalid.')
    const seen = new Set<string>()
    return value.map(value => {
        const row = record(value), id = userIdentifier(row.id)
        if (seen.has(id) || typeof row.name !== 'string' || typeof row.active !== 'boolean'
            || row.email !== null && typeof row.email !== 'string' || !Array.isArray(row.organization_memberships)) throw new UserManagementError('The user directory contains an invalid account.')
        seen.add(id)
        const organizations = row.organization_memberships.map(value => {
            const org = record(value)
            if (typeof org.name !== 'string' || typeof org.status !== 'string') throw new UserManagementError('Organization membership data is incomplete.')
            return { id: userIdentifier(org.id), name: org.name, slug: text(org.slug), status: org.status }
        })
        if (new Set(organizations.map(org => org.id)).size !== organizations.length) throw new UserManagementError('Duplicate organization memberships were returned.')
        return { id, name: row.name, username: userIdentifier(text(row.username) || id), email: impersonated ? null : row.email as string | null, active: row.active,
            avatar: text(row.avatar), createdAt: date(row.created_at), lastLoginAt: date(row.last_login_at), deactivatedAt: date(row.deactivated_at), deactivatedBy: typeof row.deactivated_by === 'string' ? row.deactivated_by : null, organizations }
    })
}
export async function loadUserManagement(settings: AppSettings, signal: AbortSignal): Promise<UserSnapshot> {
    const permissions = record((await request(settings, 'management/organizations?internalPages=1', signal, {}, organizationListBase(settings))).value)
    if (permissions.allowed !== true || typeof permissions.canEdit !== 'boolean') throw new UserManagementError('Active Hanasand access could not be verified.', 403)
    const response = await request(settings, 'users', signal)
    const users = parseManagedUsers(response.value, !own(settings))
    const actor = users.find(user => user.id === settings.userId)
    return { users, access: { scope: userManagementScope(settings), canRead: true, canWrite: permissions.canEdit && own(settings) && actor?.active === true } }
}
export async function loadManagedProfile(settings: AppSettings, id: string, signal: AbortSignal): Promise<ManagedProfile> {
    const row = record((await request(settings, `user/${encodeURIComponent(userIdentifier(id))}`, signal)).value)
    if (row.id !== id || typeof row.name !== 'string' || typeof row.active !== 'boolean' || row.email !== null && typeof row.email !== 'string') throw new UserManagementError('The returned profile did not match the selected account.')
    return { id, name: row.name, username: userIdentifier(text(row.username) || id), email: own(settings) ? row.email as string | null : null, active: row.active, avatar: text(row.avatar), deletionScheduledAt: date(row.deletion_scheduled_at) }
}
export function managedAvatarUrl(settings: AppSettings, avatar: string) {
    try {
        if (!avatar || avatar.length > 4096) return null
        const url = new URL(avatar, settings.siteBaseUrl)
        return url.protocol === 'https:' && !url.username && !url.password ? url.href : null
    } catch { return null }
}
export function managedProfileUrl(settings: AppSettings, username: string) {
    const site = new URL(settings.siteBaseUrl)
    if (site.protocol !== 'https:' || site.username || site.password || site.search || site.hash) return null
    return new URL(`/profile/${encodeURIComponent(username)}`, site).href
}
export function isReservedUser(user: ManagedUser) {
    return !user.active && (reservedUsernames.includes(user.id.toLowerCase()) || reservedUsernames.includes(user.username.toLowerCase()))
}
export function visibleManagedUsers(users: ManagedUser[], query: string, showReserved: boolean) {
    const needle = query.trim().toLowerCase()
    return users.filter(user => (showReserved || !isReservedUser(user)) && [user.name, user.id, user.username, user.email || ''].some(value => value.toLowerCase().includes(needle)))
}
export function mayOpenUserOrganization(settings: AppSettings, snapshot: UserSnapshot, org: UserOrganization) {
    const actor = snapshot.users.find(user => user.id === settings.userId)
    return own(settings) && snapshot.access.scope === userManagementScope(settings) && actor?.active === true && org.status === 'active'
        && actor.organizations.some(item => item.id === org.id && item.status === 'active')
}
export async function changeManagedUser(settings: AppSettings, access: UserAccess, id: string, action: UserAction, signal: AbortSignal): Promise<UserMutationReceipt> {
    if (!own(settings) || !access.canWrite || access.scope !== userManagementScope(settings)) throw new UserManagementError('Refresh and verify editing access in your own account first.', 403)
    const target = userIdentifier(id)
    if (!['activate', 'deactivate', 'delete'].includes(action)) throw new UserManagementError('Choose a valid user action.')
    const { value, status } = await request(settings, `user/${encodeURIComponent(target)}${action === 'delete' ? '' : '/active'}`, signal,
        action === 'delete' ? { method: 'DELETE' } : { method: 'PUT', body: JSON.stringify({ active: action === 'activate' }) })
    const body = record(value), user = action === 'delete' ? record(body.user) : body
    if (status !== 200 || user.id !== target || action === 'delete' && (body.pending_deletion !== true || !date(user.deletion_scheduled_at))
        || action !== 'delete' && user.active !== (action === 'activate')) throw new UserManagementError('The change could not be confirmed. Refresh and review the account before retrying.', status, true)
    return { id: target, action, ...(action === 'delete' ? { deletionScheduledAt: date(user.deletion_scheduled_at)! } : { active: action === 'activate' }) }
}
export type UserConfirmation = { generation: number; selection: string; action: UserAction; scope: string }
export class UserManagementOperations {
    generation = 0
    visible = false
    pending = false
    locked = false
    selection = ''
    private readSequence = 0
    private manualRead?: { generation: number; sequence: number }
    private controller?: AbortController
    invalidate() { this.generation++; this.controller?.abort(); this.controller = undefined; this.manualRead = undefined }
    beginRead(explicit: boolean) {
        this.invalidate()
        const controller = new AbortController(); this.controller = controller
        const ticket = { generation: this.generation, sequence: ++this.readSequence }
        this.manualRead = explicit ? ticket : undefined
        return { ticket, controller }
    }
    current(generation: number) { return this.visible && generation === this.generation }
    finishRead(ticket: { generation: number; sequence: number }) {
        if (!this.current(ticket.generation)) return false
        if (ticket === this.manualRead) { this.manualRead = undefined; this.locked = false }
        return true
    }
    failRead(ticket: { generation: number; sequence: number }) {
        if (ticket === this.manualRead) this.manualRead = undefined
        if (this.current(ticket.generation)) this.locked = true
    }
    confirm(scope: string, action: UserAction): UserConfirmation { return { generation: this.generation, selection: this.selection, action, scope } }
    canConfirm(review: UserConfirmation, scope: string) { return this.current(review.generation) && !this.pending && !this.locked && review.selection === this.selection && review.scope === scope }
    beginWrite() {
        this.invalidate(); this.pending = true
        const controller = new AbortController(); this.controller = controller
        return { generation: this.generation, controller }
    }
    endWrite() { this.pending = false; this.generation++ }
}
