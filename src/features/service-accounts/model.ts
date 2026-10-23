// Contracts: Core 6b2a22e6d4895198005824f3dc15615fbd9d9cea serviceAccounts.ts and apiKeyQueries/Records/Credentials.
import type { AppSettings } from '../../types'
export class ServiceAccountError extends Error {
    constructor(message: string, readonly status = 0, readonly uncertain = false) { super(message) }
}
export type Endpoint = { method: string; route: string; label: string }
export type AccountKey = { id: string; enabled: boolean; prefix: string; lastUsedAt: string | null; createdAt: string | null; scopes: (Endpoint & { enabled: boolean })[] }
export type ServiceAccount = { id: string; name: string; description: string; active: boolean; createdAt: string | null; keys: AccountKey[] }
export type Access = { scope: string; canRead: boolean; canWrite: boolean; checkedAt: number }
export type Directory = { accounts: ServiceAccount[]; endpoints: Endpoint[] }
export const own = (s: AppSettings) => !!s.userId && !!s.authToken && !s.impersonationToken && !s.impersonatingUserId
export const sessionScope = (s: AppSettings) => JSON.stringify([s.apiBaseUrl, s.siteBaseUrl, s.userId, s.authToken, s.selectedOrganizationId, s.impersonationToken, s.impersonatingUserId])
export function serviceUrl(base: string, path: string) {
    let parsed: URL
    try { parsed = new URL(base) } catch { throw new ServiceAccountError('Use a valid HTTPS service address.') }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new ServiceAccountError('Use an HTTPS service address without credentials or query parameters.')
    return `${parsed.href.replace(/\/+$/, '')}/${path}`
}
// This management job is global. Workspace changes must not bypass an unresolved operation on the same service/account.
export function intentScope(s: AppSettings) {
    let service = 'invalid-service'
    try { service = serviceUrl(s.apiBaseUrl, '') } catch { /* The transport rejects invalid configuration before dispatch. */ }
    return JSON.stringify([service, s.userId, own(s) ? 'own' : 'impersonated', 'global-service-accounts'])
}
export function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServiceAccountError('The service account response is invalid.'); return value as Record<string, unknown> }
export function text(value: unknown, max = 2000) { if (typeof value !== 'string' || value.length > max) throw new ServiceAccountError('The service account response contains invalid text.'); return value }
export function identifier(value: unknown) { const id = text(value, 200); if (!/^[A-Za-z0-9_.:@-]+$/.test(id) || ['.', '..'].includes(id)) throw new ServiceAccountError('The account identifier is invalid.'); return id }
export function rows(value: unknown, max = 10000): unknown[] { if (!Array.isArray(value) || value.length > max) throw new ServiceAccountError('The service account list is invalid or too large.'); return value }
function timestamp(value: unknown) { if (value === null) return null; const date = text(value, 100); if (!Number.isFinite(Date.parse(date))) throw new ServiceAccountError('The service account timestamp is invalid.'); return date }
export const endpointId = (e: Pick<Endpoint, 'method' | 'route'>) => `${e.method} ${e.route}`
export function parseEndpoint(value: unknown): Endpoint {
    const row = record(value), method = text(row.method, 10), route = text(row.route, 300)
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method) || !/^\/api\/[A-Za-z0-9_:/.-]+$/.test(route) || route.split('/').some(part => ['.', '..'].includes(part))) throw new ServiceAccountError('An endpoint scope is invalid.')
    return { method, route, label: row.label === undefined ? '' : text(row.label, 300) }
}
export function parseDirectory(value: unknown): Directory {
    const body = record(value), endpoints = rows(body.endpoints, 100).map(parseEndpoint), ids = new Set<string>(), keys = new Set<string>()
    if (new Set(endpoints.map(endpointId)).size !== endpoints.length) throw new ServiceAccountError('Duplicate endpoint scopes were returned.')
    const accounts = rows(body.accounts).map(value => {
        const row = record(value), id = identifier(row.id)
        if (ids.has(id) || typeof row.active !== 'boolean') throw new ServiceAccountError('The service account list is inconsistent.')
        ids.add(id)
        return { id, name: text(row.name, 100), description: row.description === null || row.description === undefined ? '' : text(row.description), active: row.active, createdAt: timestamp(row.created_at),
            keys: rows(row.keys, 1000).map(value => {
                const key = record(value), keyId = identifier(key.id)
                if (keys.has(keyId) || key.ownerId !== id || typeof key.enabled !== 'boolean') throw new ServiceAccountError('A service account key is inconsistent.')
                keys.add(keyId)
                const scopes = rows(key.scopes, 100).map(value => { const row = record(value); if (typeof row.enabled !== 'boolean') throw new ServiceAccountError('A key scope is incomplete.'); return { ...parseEndpoint(row), enabled: row.enabled } })
                if (new Set(scopes.map(endpointId)).size !== scopes.length) throw new ServiceAccountError('Duplicate key scopes were returned.')
                return { id: keyId, enabled: key.enabled, prefix: text(key.keyPrefix, 100), createdAt: timestamp(key.createdAt), lastUsedAt: timestamp(key.lastUsedAt), scopes }
            }) }
    })
    return { accounts, endpoints }
}
export function requireWriter(settings: AppSettings, access: Access) {
    const age = Date.now() - access.checkedAt
    if (!own(settings) || access.scope !== sessionScope(settings) || !access.canWrite || age < -5000 || age > 30000) throw new ServiceAccountError('Refresh editing access in your own account before changing service accounts.', 403)
}
export function accountRows(directory: Directory, query: string, order: 'asc' | 'desc', includeRevoked: boolean) {
    const needle = query.trim().toLowerCase()
    return directory.accounts.filter(row => (includeRevoked || row.active) && [row.name, row.id, row.description, ...row.keys.flatMap(key => key.scopes.map(scope => `${scope.method} ${scope.route} ${scope.label}`))].some(value => value.toLowerCase().includes(needle)))
        .sort((a, b) => (order === 'asc' ? 1 : -1) * (a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) || a.id.localeCompare(b.id)))
}
export function accountDetails(name: string, description: string) {
    if (!name.trim() || name.trim().length > 100 || description.length > 2000) throw new ServiceAccountError('Enter a name up to 100 characters and a description up to 2,000 characters.')
    return { name: name.trim(), description: description.trim() }
}
