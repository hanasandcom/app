import type { AppSettings } from '../types'
import { apiFetch } from './api'
import { organizationListBase } from './organization-endpoint'
import { loadToolOrganizations, type ToolOrganization } from './organization-tools'

export type DirectoryOrganization = {
    id: string
    name: string
    slug: string
    status: string
    memberCount: number | null
    createdAt: string | null
    lastActiveAt: string | null
}
export type DirectorySnapshot = { organizations: DirectoryOrganization[]; memberships: ToolOrganization[] }
export const directorySorts = [
    { key: 'name', label: 'Name' },
    { key: 'slug', label: 'Slug' },
    { key: 'status', label: 'Status' },
    { key: 'members', label: 'Members' },
    { key: 'created', label: 'Created' },
    { key: 'lastActive', label: 'Last active' }
] as const
export type DirectorySort = (typeof directorySorts)[number]['key']
export class DirectoryError extends Error {
    constructor(message: string, readonly status: number) { super(message) }
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown) => typeof value === 'string' ? value : ''
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
export const directoryScope = (settings: AppSettings) => JSON.stringify([
    settings.apiBaseUrl, settings.siteBaseUrl, settings.userId, settings.authToken,
    settings.impersonationToken, settings.impersonatingUserId, settings.selectedOrganizationId
])
export function parseDirectory(value: unknown): DirectoryOrganization[] {
    const body = record(value)
    if (!Array.isArray(body.organizations)) throw new Error('The organization directory response was incomplete. Refresh to try again.')
    const seen = new Set<string>()
    return body.organizations.map((value: unknown) => {
        const row = record(value), id = text(row.id), name = text(row.name)
        if (!id || !name || seen.has(id)) throw new Error('The organization directory contained an invalid or duplicate entry.')
        seen.add(id)
        const count = typeof row.member_count === 'number' || typeof row.member_count === 'string' && /^\d+$/.test(row.member_count)
            ? Number(row.member_count) : Number.NaN
        return {
            id, name, slug: text(row.slug), status: text(row.status) || 'unknown',
            memberCount: Number.isSafeInteger(count) && count >= 0 ? count : null,
            createdAt: date(row.created_at), lastActiveAt: date(row.last_active_at)
        }
    })
}
export async function loadOrganizationDirectory(settings: AppSettings, signal: AbortSignal): Promise<DirectorySnapshot> {
    if (!settings.userId || !settings.authToken) throw new Error('Sign in to view the organization directory.')
    const url = new URL(`${organizationListBase(settings).replace(/\/+$/, '')}/management/organizations`)
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('The organization directory requires an HTTPS address without credentials.')
    const controller = new AbortController(), abort = () => controller.abort()
    const timer = setTimeout(abort, 20000)
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    try {
        if (controller.signal.aborted) throw new Error('The directory request was cancelled.')
        const directory = apiFetch(settings, url.toString(), {
            method: 'GET', cache: 'no-store', signal: controller.signal,
            headers: { Authorization: `Bearer ${settings.authToken}`, id: settings.userId, Accept: 'application/json',
                ...(settings.impersonationToken ? { 'x-impersonation-token': settings.impersonationToken } : {}) }
        }).then(async (response) => {
            if (!response.ok) {
                const message = response.status === 401 ? 'Your session could not be verified. Sign in again.'
                    : response.status === 403 ? 'The organization directory requires active Hanasand administration access.'
                        : response.status === 429 ? 'Too many directory requests. Wait, then refresh.'
                            : 'The organization directory is temporarily unavailable. Refresh to try again.'
                throw new DirectoryError(message, response.status)
            }
            const payload = await response.json().catch(() => { throw new Error('The organization directory returned an unreadable response. Refresh to try again.') })
            return parseDirectory(payload)
        })
        const [organizations, memberships] = await Promise.all([directory, loadToolOrganizations(settings, controller.signal)])
        return { organizations, memberships }
    } finally { controller.abort(); clearTimeout(timer); signal.removeEventListener('abort', abort) }
}
export function canSwitchDirectoryOrganization(settings: AppSettings, organization: DirectoryOrganization, memberships: ToolOrganization[]) {
    return Boolean(settings.userId && settings.authToken && !settings.impersonationToken && !settings.impersonatingUserId
        && organization.status === 'active' && memberships.some((membership) => membership.id === organization.id && membership.status === 'active'))
}
export function directoryRows(organizations: DirectoryOrganization[], query: string, sort: DirectorySort, direction: 'asc' | 'desc') {
    const term = query.trim().toLocaleLowerCase()
    const compareText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
    return organizations.filter((org) => !term || `${org.name} ${org.slug} ${org.status}`.toLocaleLowerCase().includes(term)).sort((a, b) => {
        const left = sort === 'created' ? a.createdAt ? Date.parse(a.createdAt) : null : sort === 'lastActive' ? a.lastActiveAt ? Date.parse(a.lastActiveAt) : null : sort === 'members' ? a.memberCount : null
        const right = sort === 'created' ? b.createdAt ? Date.parse(b.createdAt) : null : sort === 'lastActive' ? b.lastActiveAt ? Date.parse(b.lastActiveAt) : null : sort === 'members' ? b.memberCount : null
        const numeric = ['created', 'lastActive', 'members'].includes(sort)
        // Missing measurements always follow measured ones, in either direction.
        if (numeric && (left === null || right === null)) {
            if (left === null && right !== null) return 1
            if (right === null && left !== null) return -1
        }
        const comparison = numeric ? (left ?? 0) - (right ?? 0) : compareText(a[sort as 'name' | 'slug' | 'status'], b[sort as 'name' | 'slug' | 'status'])
        return (direction === 'asc' ? 1 : -1) * comparison || compareText(a.name, b.name) || compareText(a.id, b.id)
    })
}
export type DirectoryRequest = { epoch: number; controller: AbortController }
/** A late read must never authorize a workspace switch on a later screen. */
export class DirectoryRequests {
    private epoch = 0
    private current: DirectoryRequest | null = null
    start() {
        this.invalidate()
        const request = { epoch: ++this.epoch, controller: new AbortController() }
        this.current = request
        return request
    }
    invalidate() { this.epoch++; this.current?.controller.abort(); this.current = null }
    canApply(request: DirectoryRequest, visible: boolean) { return visible && this.current === request && request.epoch === this.epoch && !request.controller.signal.aborted }
    finish(request: DirectoryRequest) { if (this.current !== request) return false; this.current = null; return true }
}
