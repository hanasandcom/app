import type { AppSettings } from '../../types'
import { getHeader } from '../../lib/headers'
import { apiFetch } from '../../lib/api'
import { organizationListBase } from '../../lib/organization-endpoint'
import { endpoint, isProtectedLogsContainerName, ownAccount, parseRuntimeLogs, parseStorage, parseTelemetry, record, staleTelemetry, systemScope, SystemError, validContainerId, type Access, type Storage, type Telemetry } from './model'
export type Transport = (settings: AppSettings, url: string, init: RequestInit) => Promise<Response>
export type RequestOptions = { transport?: Transport; timeoutMs?: number }
export function utf8Size(s: string) { let bytes = 0; for (const c of s) { const n = c.codePointAt(0)!; bytes += n < 128 ? 1 : n < 2048 ? 2 : n < 65536 ? 3 : 4 } return bytes }
async function request(settings: AppSettings, base: string, path: string, signal: AbortSignal, mutation = false, options: RequestOptions = {}) {
    if (!settings.userId || !settings.authToken) throw new SystemError('Sign in to inspect system operations.', 401)
    const controller = new AbortController(), abort = () => controller.abort()
    let dispatched = false, rejectAbort: (e: Error) => void = () => {}
    const interrupted = new Promise<never>((_, reject) => { rejectAbort = reject })
    const onAbort = () => rejectAbort(new SystemError(dispatched && mutation ? 'The action outcome is unknown. Refresh and review before another action.' : 'System request interrupted.', 0, dispatched && mutation))
    controller.signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, options.timeoutMs ?? 20000)
    const run = async () => {
        const url = endpoint(base, path)
        if (controller.signal.aborted) throw new SystemError('System request cancelled.')
        dispatched = true
        const response = await (options.transport || apiFetch)(settings, url, { method: path === 'system/storage/clear' ? 'POST' : 'GET', signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store', headers: {
            Accept: 'application/json', Authorization: `Bearer ${settings.authToken}`, id: settings.userId, ...(settings.impersonationToken ? { 'x-impersonation-token': settings.impersonationToken } : {}) } })
        if (Number(getHeader(response.headers, 'content-length')) > 4 * 1024 * 1024) throw new SystemError('System response exceeded the 4 MiB limit.', response.status, mutation)
        const content = await response.text()
        if (content.length > 4 * 1024 * 1024 || utf8Size(content) > 4 * 1024 * 1024) throw new SystemError('System response exceeded the 4 MiB limit.', response.status, mutation)
        if (!response.ok) throw new SystemError([401, 403].includes(response.status) ? 'System access could not be verified. Refresh manually.' : 'System service is unavailable. Refresh to try again.', response.status, mutation && response.status >= 500)
        try { return { status: response.status, body: JSON.parse(content) as unknown } } catch { throw new SystemError('System returned an unreadable receipt.', response.status, mutation) }
    }
    try { return await Promise.race([run(), interrupted]) }
    catch (e) { if (e instanceof SystemError) throw e; throw new SystemError(mutation && dispatched ? 'The action outcome is unknown. Refresh and review before another action.' : 'System is unavailable. Refresh to try again.', 0, mutation && dispatched) }
    finally { clearTimeout(timer); signal.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', onAbort) }
}
export async function loadAccess(s: AppSettings, signal: AbortSignal, options?: RequestOptions): Promise<Access> {
    const r = record((await request(s, organizationListBase(s), 'management/organizations?internalPages=1', signal, false, options)).body)
    if (typeof r.allowed !== 'boolean' || typeof r.canEdit !== 'boolean') throw new SystemError('System permission response is incomplete.')
    return { scope: systemScope(s), canRead: r.allowed, canWrite: r.allowed && r.canEdit && ownAccount(s) }
}
export async function loadTelemetry(s: AppSettings, signal: AbortSignal, options?: RequestOptions) { return parseTelemetry((await request(s, s.apiBaseUrl, 'system/snapshot', signal, false, options)).body) }
export async function loadStorage(s: AppSettings, signal: AbortSignal, options?: RequestOptions) { return parseStorage((await request(s, s.apiBaseUrl, 'system/storage', signal, false, options)).body) }
export async function loadRuntimeLogs(s: AppSettings, name: string, signal: AbortSignal, options?: RequestOptions) {
    if (!name || name.length > 300 || Array.from(name).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) throw new SystemError('Choose a valid container from the current inventory.')
    return parseRuntimeLogs((await request(s, s.apiBaseUrl, `logs/realtime?${new URLSearchParams({ limit: '120', service: name })}`, signal, false, options)).body)
}
function writer(s: AppSettings, a: Access) { if (!ownAccount(s) || a.scope !== systemScope(s) || !a.canWrite) throw new SystemError('Verify current system editing access in your own account.', 403) }
export async function restartContainer(s: AppSettings, a: Access, snapshot: Telemetry, id: string, signal: AbortSignal, options?: RequestOptions) {
    writer(s, a)
    const selected = snapshot.containers.find(c => c.id === id)
    if (!validContainerId(id) || staleTelemetry(snapshot) || !selected || ['dead', 'exited', 'removing'].includes(selected.state.toLowerCase())) throw new SystemError('Refresh and select a current container before restarting.')
    if (isProtectedLogsContainerName(selected.name)) throw new SystemError('Logs services cannot be restarted from the system dashboard.', 409)
    const r = record((await request(s, s.apiBaseUrl, `restart/${encodeURIComponent(id)}`, signal, true, options)).body)
    if (r.ok !== true || !Object.hasOwn(r, 'detail')) throw new SystemError('Restart receipt could not be verified. Review current state before another action.', 0, true)
}
export async function clearStorage(s: AppSettings, a: Access, storage: Storage, signal: AbortSignal, options?: RequestOptions) {
    writer(s, a)
    if (storage.stale || !Number.isFinite(Date.parse(storage.checkedAt)) || Date.now() - Date.parse(storage.checkedAt) > 900000 || Date.parse(storage.checkedAt) - Date.now() > 5000 || storage.running || storage.queued || !!storage.error) throw new SystemError('Refresh current idle storage figures before cleanup.')
    const r = await request(s, s.apiBaseUrl, 'system/storage/clear', signal, true, options)
    if (r.status !== 202 || record(r.body).queued !== true) throw new SystemError('Cleanup queue receipt could not be verified. Review storage before another action.', 0, true)
}
