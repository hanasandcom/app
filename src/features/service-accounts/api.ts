import type { AppSettings } from '../../types'
import { getHeader } from '../../lib/headers'
import { apiFetch } from '../../lib/api'
import { organizationListBase } from '../../lib/organization-endpoint'
import { Access, Directory, Endpoint, ServiceAccountError, accountDetails, endpointId, identifier, own, parseDirectory, parseEndpoint, record, requireWriter, rows, serviceUrl, sessionScope, text } from './model'
export type Transport = (settings: AppSettings, url: string, init: RequestInit) => Promise<Response>
export type RequestOptions = { transport?: Transport; timeoutMs?: number }
const bytes = (s: string) => { let n = 0; for (const c of s) { const code = c.codePointAt(0)!; n += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4 } return n }
async function request(s: AppSettings, path: string, signal: AbortSignal, options: RequestOptions, method = 'GET', body?: unknown, base = s.apiBaseUrl) {
    if (!s.userId || !s.authToken) throw new ServiceAccountError('Sign in to manage service accounts.', 401)
    const write = method !== 'GET'
    if (write && !own(s)) throw new ServiceAccountError('Use your own account to change service accounts.', 403)
    const url = serviceUrl(base, path), controller = new AbortController(), abort = () => controller.abort()
    let dispatched = false, rejectAbort: (error: ServiceAccountError) => void = () => {}
    const cancelled = new Promise<never>((_, reject) => { rejectAbort = reject })
    const interrupted = () => rejectAbort(new ServiceAccountError('The request was interrupted. Refresh and review before another attempt.', 0, write && dispatched))
    controller.signal.addEventListener('abort', interrupted, { once: true })
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, options.timeoutMs ?? 25000)
    try {
        return await Promise.race([cancelled, (async () => {
            if (controller.signal.aborted) throw new ServiceAccountError('Request cancelled.')
            dispatched = true
            const response = await (options.transport || apiFetch)({ ...s, selectedOrganizationId: undefined }, url, { method, signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error',
                headers: { Accept: 'application/json', Authorization: `Bearer ${s.authToken}`, id: s.userId, ...(s.impersonationToken ? { 'x-impersonation-token': s.impersonationToken } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
            const max = 8 * 1024 * 1024
            if (Number(getHeader(response.headers, 'content-length')) > max) throw new ServiceAccountError('The response exceeds its size limit.', response.status, write)
            const content = await response.text()
            if (content.length > max || bytes(content) > max) throw new ServiceAccountError('The response exceeds its size limit.', response.status, write)
            let value: unknown
            try { value = JSON.parse(content) } catch { throw new ServiceAccountError('The service account response could not be verified.', response.status, write) }
            if (!response.ok) throw new ServiceAccountError(response.status === 401 ? 'Your session could not be verified.' : response.status === 403 ? 'Current Hanasand access is required.' : response.status === 404 ? 'The service account is no longer available.' : 'The service account request failed. Refresh and review current state.', response.status, write && response.status >= 500)
            return { status: response.status, value }
        })()])
    } catch (error) {
        if (error instanceof ServiceAccountError) throw error
        throw new ServiceAccountError(write && dispatched ? 'The operation outcome is unknown. Refresh and review before another attempt.' : 'Service accounts are unavailable. Refresh to try again.', 0, write && dispatched)
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', interrupted) }
}
export async function loadAccess(s: AppSettings, signal: AbortSignal, options: RequestOptions = {}): Promise<Access> {
    const response = await request(s, 'management/organizations?internalPages=1', signal, options, 'GET', undefined, organizationListBase(s)), body = record(response.value)
    if (response.status !== 200 || typeof body.allowed !== 'boolean' || typeof body.canEdit !== 'boolean') throw new ServiceAccountError('Service account access could not be verified.')
    return { scope: sessionScope(s), canRead: body.allowed, canWrite: body.allowed && body.canEdit && own(s), checkedAt: Date.now() }
}
export async function loadDirectory(s: AppSettings, signal: AbortSignal, options: RequestOptions = {}): Promise<Directory> {
    const response = await request(s, 'service-accounts', signal, options)
    if (response.status !== 200) throw new ServiceAccountError('The service account directory response is invalid.')
    return parseDirectory(response.value)
}
export async function createAccount(s: AppSettings, access: Access, directory: Directory, input: { name: string; description: string; scopes: Endpoint[] }, signal: AbortSignal, options: RequestOptions = {}) {
    requireWriter(s, access)
    const details = accountDetails(input.name, input.description), ids = input.scopes.map(endpointId)
    if (!ids.length || ids.length > directory.endpoints.length || new Set(ids).size !== ids.length || ids.some(id => !directory.endpoints.some(e => endpointId(e) === id))) throw new ServiceAccountError('Choose current supported endpoint scopes.')
    const response = await request(s, 'service-accounts', signal, options, 'POST', { ...details, scopes: input.scopes.map(({ method, route }) => ({ method, route })) })
    try {
        const body = record(response.value), key = record(body.apiKey), secret = text(body.secret, 100)
        const scopes = rows(key.scopes, 100).map(parseEndpoint)
        if (response.status !== 201 || !/^hsk_[a-f0-9]{12}_[a-f0-9]{48}$/.test(secret) || key.name !== details.name || key.enabled !== true || key.keyPrefix !== secret.split('_')[1]
            || (!identifier(key.ownerId).startsWith('svc_') || String(key.ownerId).length <= 4) || scopes.length !== ids.length || new Set(scopes.map(endpointId)).size !== ids.length || scopes.some(e => !ids.includes(endpointId(e))) || rows(key.scopes).some(value => record(value).enabled !== true) || directory.accounts.some(row => row.id === key.ownerId)) throw new Error()
        return { id: identifier(key.ownerId), keyId: identifier(key.id), secret }
    } catch { throw new ServiceAccountError('The account creation receipt could not be verified. Review current accounts before another attempt.', response.status, true) }
}
export async function updateAccount(s: AppSettings, access: Access, id: string, input: { name: string; description: string }, signal: AbortSignal, options: RequestOptions = {}) {
    requireWriter(s, access); const target = identifier(id), details = accountDetails(input.name, input.description)
    const response = await request(s, `service-accounts/${encodeURIComponent(target)}`, signal, options, 'PATCH', details)
    try { const row = record(response.value); if (response.status !== 200 || row.id !== target || row.name !== details.name || row.description !== details.description) throw new Error(); return { id: target, ...details } }
    catch { throw new ServiceAccountError('The account update receipt could not be verified. Refresh current state.', response.status, true) }
}
export async function revokeAccount(s: AppSettings, access: Access, id: string, signal: AbortSignal, options: RequestOptions = {}) {
    requireWriter(s, access); const response = await request(s, `service-accounts/${encodeURIComponent(identifier(id))}`, signal, options, 'DELETE')
    try { const message = text(record(response.value).message); if (response.status !== 200 || !message.trim()) throw new Error(); return { message } }
    catch { throw new ServiceAccountError('The revocation receipt could not be verified. Review the account and its keys.', response.status, true) }
}
export const serviceAccountServices = { loadAccess, loadDirectory, createAccount, updateAccount, revokeAccount }
export type Services = typeof serviceAccountServices
