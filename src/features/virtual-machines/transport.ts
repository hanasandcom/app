import type { AppSettings } from '../../types'
import { apiFetch } from '../../lib/api'
export class VmError extends Error {
    constructor(message: string, readonly status = 0, readonly uncertain = false, readonly code = '') { super(message) }
}
export type VmTransport = (settings: AppSettings, url: string, init: RequestInit) => Promise<Response>
export type VmRequestOptions = { transport?: VmTransport; timeoutMs?: number }
export const ownAccount = (s: AppSettings) => !!s.userId && !!s.authToken && !s.impersonationToken && !s.impersonatingUserId
export const vmScope = (s: AppSettings) => JSON.stringify([s.apiBaseUrl, s.userId, s.authToken, s.selectedOrganizationId, s.impersonationToken, s.impersonatingUserId])
export function vmUrl(s: AppSettings, path: string) {
    let base: URL
    try { base = new URL(s.apiBaseUrl) } catch { throw new VmError('A valid secure API address is required.') }
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new VmError('Use a secure API address without credentials or query parameters.')
    return `${base.href.replace(/\/+$/, '')}/${path}`
}
export function utf8Size(value: string) { let size = 0; for (const c of value) { const n = c.codePointAt(0)!; size += n < 128 ? 1 : n < 2048 ? 2 : n < 65536 ? 3 : 4 } return size }
export function requireOwn(s: AppSettings) { if (!ownAccount(s)) throw new VmError('Use your own signed-in account for this operation.', 403) }
export async function vmRequest(s: AppSettings, path: string, method: string, signal: AbortSignal, options: VmRequestOptions = {}, body?: unknown, effect = false, deadlineMs = 20000) {
    if (!s.userId || !s.authToken) throw new VmError('Sign in to view virtual machines.', 401)
    if (effect) requireOwn(s)
    const url = vmUrl(s, path), controller = new AbortController()
    let dispatched = false, rejectAbort: (e: VmError) => void = () => {}
    const cancelled = new Promise<never>((_, reject) => { rejectAbort = reject })
    const interrupted = () => rejectAbort(new VmError(effect && dispatched ? 'The operation outcome is unknown. Review current state before another attempt.' : 'VM request interrupted.', 0, effect && dispatched))
    const abort = () => controller.abort()
    controller.signal.addEventListener('abort', interrupted, { once: true })
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, options.timeoutMs ?? deadlineMs)
    const run = async () => {
        if (controller.signal.aborted) throw new VmError('VM request cancelled.')
        const organizationId = s.selectedOrganizationId && s.selectedOrganizationId !== 'personal' ? s.selectedOrganizationId : undefined
        dispatched = true
        const response = await (options.transport || apiFetch)(s, url, { method, signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store', headers: {
            Authorization: `Bearer ${s.authToken}`, id: s.userId, Accept: 'application/json',
            ...(organizationId ? { 'x-organization-id': organizationId } : {}),
            ...(s.impersonationToken ? { 'x-impersonation-token': s.impersonationToken } : {}),
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
        const max = 8 * 1024 * 1024
        if (Number(response.headers.get('content-length')) > max) throw new VmError('VM response exceeded its size limit.', response.status, effect)
        const content = await response.text()
        if (content.length > max || utf8Size(content) > max) throw new VmError('VM response exceeded its size limit.', response.status, effect)
        let value: unknown
        try { value = JSON.parse(content) } catch { throw new VmError('VM response could not be verified.', response.status, effect) }
        if (!response.ok) throw new VmError([401, 403].includes(response.status) ? 'VM access could not be verified.' : 'The VM service could not complete this request. Review current state.', response.status, effect && response.status >= 500)
        return { status: response.status, value }
    }
    try { return await Promise.race([run(), cancelled]) }
    catch (error) { if (error instanceof VmError) throw error; throw new VmError(effect && dispatched ? 'The operation outcome is unknown. Review current state before another attempt.' : 'The VM service is unavailable.', 0, effect && dispatched) }
    finally { clearTimeout(timer); signal.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', interrupted) }
}
