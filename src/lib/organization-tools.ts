import type { AppSettings } from '../types'
import { apiFetch } from './api'
import { organizationListBase } from './organization-endpoint'

const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
const text = (value: unknown) => (typeof value === 'string' ? value : '')
const rows = (value: unknown) => (Array.isArray(value) ? value.map(record) : [])
export type ToolOrganization = { id: string; name: string; role: string; status: string }
export type OrganizationApiKey = {
    id: string
    name: string
    organizationId: string
    keyPrefix: string
    enabled: boolean
    expiresAt: string
    lastUsedAt: string
    createdAt: string
    scopes: Array<{ method: string; route: string; enabled: boolean }>
}
export class OrganizationToolError extends Error {
    constructor(
        message: string,
        readonly status: number
    ) {
        super(message)
    }
}
export function organizationToolScope(settings: AppSettings) {
    return JSON.stringify([
        settings.apiBaseUrl,
        settings.siteBaseUrl,
        settings.userId,
        settings.authToken,
        settings.impersonationToken,
        settings.selectedOrganizationId
    ])
}
export function canManageApiKeys(organization: ToolOrganization) {
    return ['owner', 'admin'].includes(organization.role.toLowerCase())
}
export function isActiveOrganization(organization: ToolOrganization) {
    return organization.status === 'active'
}
function requireScope(settings: AppSettings, organizationId?: string, mutation = false) {
    if (!settings.authToken || !settings.userId) throw new Error('Sign in to manage organization tools.')
    if (organizationId !== undefined && (!organizationId || organizationId === 'personal'))
        throw new Error('Select an organization first.')
    if (mutation && settings.impersonationToken)
        throw new Error('Return to your own account before changing organization tools.')
}
function errorText(body: Record<string, unknown>, status: number) {
    if (status === 401) return 'Your session could not be verified. Refresh and try again.'
    if (status === 403) return 'You do not have access to this organization task.'
    if (status === 429) return 'Too many organization requests. Wait a moment and retry.'
    if (status >= 500) return 'Organization services are temporarily unavailable. Please retry.'
    return (
        text(body.error) ||
        text(record(body.error).message) ||
        `Organization request failed (${status}). Please retry.`
    )
}
async function request(
    settings: AppSettings,
    organizationId: string | undefined,
    path: string,
    init: RequestInit,
    base = settings.apiBaseUrl
) {
    requireScope(settings, organizationId, !!init.method && init.method !== 'GET')
    const url = new URL(`${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`)
    if (url.protocol !== 'https:' || url.username || url.password)
        throw new Error('Organization services require secure HTTPS URLs.')
    const controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), 20000)
    const abort = () => controller.abort()
    if (init.signal?.aborted) controller.abort()
    else init.signal?.addEventListener('abort', abort, { once: true })
    try {
        const headers = new Headers(init.headers)
        headers.set('Accept', 'application/json')
        headers.set('Content-Type', 'application/json')
        const response = await apiFetch(
            organizationId ? { ...settings, selectedOrganizationId: organizationId } : settings,
            url.toString(),
            { ...init, signal: controller.signal, cache: 'no-store', headers }
        )
        const body = record(await response.json().catch(() => null))
        return { response, body }
    } finally {
        clearTimeout(timer)
        init.signal?.removeEventListener('abort', abort)
    }
}
const apiPath = (organizationId: string, suffix: string) =>
    `organizations/${encodeURIComponent(organizationId)}/${suffix}`
export async function loadToolOrganizations(
    settings: AppSettings,
    signal: AbortSignal
): Promise<ToolOrganization[]> {
    const { response, body } = await request(settings, undefined, 'organizations', { signal }, organizationListBase(settings))
    if (!response.ok) throw new OrganizationToolError(errorText(body, response.status), response.status)
    if (!Array.isArray(body.organizations))
        throw new Error('The organization list was invalid. Refresh and try again.')
    return rows(body.organizations).flatMap((row) =>
        typeof row.id === 'string' && typeof row.name === 'string'
            ? [
                {
                    id: row.id,
                    name: row.name,
                    role: text(row.role),
                    status: text(row.lifecycleStatus) || text(row.status)
                }
            ]
            : []
    )
}
export function normalizeOrganizationApiKey(
    value: unknown,
    organizationId: string
): OrganizationApiKey | null {
    const row = record(value)
    if (!text(row.id) || row.organizationId !== organizationId) return null
    return {
        id: text(row.id),
        name: text(row.name),
        organizationId,
        keyPrefix: /^[a-f0-9]{12}$/.test(text(row.keyPrefix)) ? text(row.keyPrefix) : '',
        enabled: row.enabled === true,
        expiresAt: text(row.expiresAt),
        lastUsedAt: text(row.lastUsedAt),
        createdAt: text(row.createdAt),
        scopes: rows(row.scopes).map((scope) => ({
            method: text(scope.method),
            route: text(scope.route),
            enabled: scope.enabled === true
        }))
    }
}
function keyPermission(settings: AppSettings, organization: ToolOrganization) {
    requireScope(settings, organization.id, true)
    if (!canManageApiKeys(organization))
        throw new Error('Organization owners and administrators manage API keys.')
}
export async function loadOrganizationApiKeys(
    settings: AppSettings,
    organization: ToolOrganization,
    signal: AbortSignal
): Promise<OrganizationApiKey[]> {
    keyPermission(settings, organization)
    const { response, body } = await request(
        settings,
        organization.id,
        apiPath(organization.id, 'api-keys'),
        { signal }
    )
    if (!response.ok) throw new OrganizationToolError(errorText(body, response.status), response.status)
    if (body.organizationId !== organization.id || !Array.isArray(body.apiKeys))
        throw new Error('The API-key list did not match this organization.')
    return body.apiKeys.flatMap((value) => {
        const item = normalizeOrganizationApiKey(value, organization.id)
        return item ? [item] : []
    })
}
export async function createOrganizationApiKey(
    settings: AppSettings,
    organization: ToolOrganization,
    name: string,
    signal: AbortSignal
) {
    keyPermission(settings, organization)
    if (!isActiveOrganization(organization))
        throw new Error('Reactivate the organization before creating an API key.')
    const clean = name.trim()
    if (clean.length < 2 || clean.length > 80) throw new Error('API key name must contain 2–80 characters.')
    const { response, body } = await request(
        settings,
        organization.id,
        apiPath(organization.id, 'api-keys'),
        { method: 'POST', body: JSON.stringify({ name: clean }), signal }
    )
    if (!response.ok) throw new OrganizationToolError(errorText(body, response.status), response.status)
    const apiKey = normalizeOrganizationApiKey(body.apiKey, organization.id),
        secret = text(body.secret)
    if (!apiKey || !/^hsk_[a-f0-9]{12}_[a-f0-9]{48}$/.test(secret))
        throw new Error('Key creation could not be confirmed. Refresh the list before creating another key.')
    return { apiKey, secret }
}
export async function revokeOrganizationApiKey(
    settings: AppSettings,
    organization: ToolOrganization,
    keyId: string,
    signal: AbortSignal
) {
    keyPermission(settings, organization)
    if (!keyId) throw new Error('Select an API key to revoke.')
    const { response, body } = await request(
        settings,
        organization.id,
        apiPath(organization.id, `api-keys/${encodeURIComponent(keyId)}`),
        { method: 'DELETE', signal }
    )
    if (!response.ok) throw new OrganizationToolError(errorText(body, response.status), response.status)
    const apiKey = normalizeOrganizationApiKey(body.apiKey, organization.id)
    if (!apiKey) throw new Error('Revocation could not be confirmed. Refresh the list.')
    return apiKey
}

export function mayRevealCreatedApiKey(active: boolean, foreground: boolean, focused: boolean) {
    return active && foreground && focused
}
