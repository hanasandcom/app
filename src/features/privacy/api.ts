import type { AppSettings } from '../../types'
import { apiFetch } from '../../lib/api'
import { canUsePrivacyAction, matchedPrivacyOutcome, parsePrivacyExport, parsePrivacyState, privacyId, PrivacyError, row, text, utf8Size, type PrivacyAction, type PrivacyReceipt, type PrivacyState } from './model'

export type PrivacyTransport = (settings: AppSettings, url: string, init: RequestInit) => Promise<Response>
export type PrivacyRequestOptions = { transport?: PrivacyTransport; timeoutMs?: number }
async function request(settings: AppSettings, signal: AbortSignal, body: unknown, offset: number, options: PrivacyRequestOptions) {
    const org = privacyId(settings.selectedOrganizationId), base = new URL(settings.apiBaseUrl)
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new PrivacyError('Privacy requires an HTTPS service address without credentials.')
    if (!settings.userId || !settings.authToken) throw new PrivacyError('Sign in to view organization privacy.', 401)
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new PrivacyError('Choose a valid history page.')
    const url = `${base.href.replace(/\/+$/, '')}/organizations/${encodeURIComponent(org)}/privacy${body === undefined ? `?itemOffset=${offset}&itemLimit=50` : ''}`
    const controller = new AbortController(), abort = () => controller.abort()
    let submitted = false, timer: ReturnType<typeof setTimeout> | undefined
    let rejectAborted: (error: Error) => void = () => undefined
    const cancelled = new Promise<never>((_, reject) => { rejectAborted = reject })
    const onAbort = () => rejectAborted(new PrivacyError(submitted ? 'The outcome is unknown. Refresh and review request history before continuing.' : 'Privacy request was interrupted.', 0, submitted))
    controller.signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true })
    const run = async () => {
        if (controller.signal.aborted) throw new PrivacyError('Privacy request was cancelled.')
        submitted = body !== undefined
        const response = await (options.transport || apiFetch)(settings, url, {
            method: body === undefined ? 'GET' : 'POST', signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${settings.authToken}`, id: settings.userId,
                ...(settings.impersonationToken ? { 'x-impersonation-token': settings.impersonationToken } : {}) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        const maximum = body !== undefined && row(body).action === 'export' ? 16 * 1024 * 1024 : 4 * 1024 * 1024
        const length = Number(response.headers.get('content-length'))
        if (length > maximum) throw new PrivacyError('The response is too large to open safely on this device.', response.status, submitted)
        // Native implementations without a readable stream allocate text before this result-size check.
        const content = await response.text()
        if (content.length > maximum || utf8Size(content) > maximum) throw new PrivacyError('The response is too large to open safely on this device.', response.status, submitted)
        let value: unknown
        try { value = JSON.parse(content) } catch { throw new PrivacyError('Privacy returned an unreadable response. Refresh and review history.', response.status, submitted) }
        return { response, value }
    }
    try {
        timer = setTimeout(abort, options.timeoutMs ?? (body === undefined ? 30000 : 60000))
        return await Promise.race([run(), cancelled])
    } catch (cause) {
        if (cause instanceof PrivacyError) throw cause
        throw new PrivacyError(submitted ? 'The outcome is unknown. Refresh and review request history before continuing.' : 'Privacy could not be loaded. Refresh to retry.', 0, submitted)
    } finally {
        clearTimeout(timer); signal.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', onAbort)
    }
}
function failure(status: number, write = false): PrivacyError {
    return new PrivacyError(status === 401 ? 'Your session could not be verified. Sign in again.'
        : status === 403 ? 'You do not have permission, or deletion reauthentication failed.'
            : status === 404 ? 'This organization is unavailable or no longer accessible.'
                : status === 409 ? 'A privacy request is already active or this request ID has been used. Refresh and review history.'
                    : status === 400 ? 'The confirmation or privacy request was not accepted.'
                        : 'Privacy is unavailable. Refresh and review history.', status, write && (status >= 500 || status === 409))
}
export async function loadPrivacy(settings: AppSettings, signal: AbortSignal, offset = 0, options: PrivacyRequestOptions = {}) {
    const { response, value } = await request(settings, signal, undefined, offset, options)
    if (!response.ok) throw failure(response.status)
    const state = parsePrivacyState(value, settings)
    if (state.page.offset !== offset || state.page.limit !== 50) throw new PrivacyError('Privacy records returned the wrong page.')
    return state
}
export async function performPrivacyAction(settings: AppSettings, state: PrivacyState, action: PrivacyAction, requestId: string, signal: AbortSignal,
    deletion?: { confirmation: string; currentPassword: string }, options: PrivacyRequestOptions = {}): Promise<PrivacyReceipt> {
    if (!canUsePrivacyAction(settings, state, action)) throw new PrivacyError('Refresh and verify privacy permissions in your own account.', 403)
    if (!['export', 'run_retention', 'delete'].includes(action) || !/^[A-Za-z0-9_.:@-]{1,200}$/.test(requestId)) throw new PrivacyError('The privacy request is invalid.')
    if (action === 'delete' && (!deletion?.currentPassword || deletion.confirmation !== state.organization.name)) throw new PrivacyError('Enter the current organization name and your password.')
    const { response, value } = await request(settings, signal, { action, requestId, ...(action === 'delete' ? deletion : {}) }, 0, options)
    const body = row(value)
    if (action === 'export' && [200, 502].includes(response.status)) {
        const receipt = row(body.request), expected = response.status === 200 ? 'completed' : 'failed'
        if (!text(receipt.id) || receipt.status !== expected) throw new PrivacyError('The export outcome could not be confirmed. Refresh request history.', response.status, true)
        const exported = expected === 'completed' ? parsePrivacyExport(body.export, state.organization.id) : undefined
        if (exported) await verifyExportChecksum(exported)
        return { action, requestId, httpStatus: response.status, status: expected, request: { id: text(receipt.id), status: expected }, ...(exported ? { exported } : {}) }
    }
    if (action !== 'export' && [200, 202, 502].includes(response.status)) {
        let updated: PrivacyState
        try { updated = parsePrivacyState(value, settings, false) } catch { throw new PrivacyError('The privacy outcome could not be confirmed. Refresh history.', response.status, true) }
        if (!matchedPrivacyOutcome(updated, { action, requestId })) throw new PrivacyError('The response did not confirm this privacy request. Refresh history.', response.status, true)
        const deletionRequest = updated.requests.find(item => item.request_type === 'deletion' && item.request_id === requestId)
        const run = updated.runs.find(item => item.request_id === requestId && item.trigger_type === (action === 'delete' ? 'privacy_deletion' : 'manual')
            && (action !== 'delete' || item.privacy_request_id === deletionRequest?.id))
        if (!run || !text(run.id)) throw new PrivacyError('The saved run is missing from this receipt. Refresh history.', response.status, true)
        const worker = row(body.worker)
        const failed = worker.failed === true || worker.deadLetter === true || ['failed', 'dead_letter'].includes(text(run.status))
        const continuing = !failed && (worker.hasMore === true || ['queued', 'running'].includes(text(run.status)))
        if (typeof worker.claimed !== 'boolean' || worker.claimed && worker.runId !== run.id
            || response.status === 502 && !failed || response.status === 202 && !continuing
            || response.status === 200 && (failed || continuing || run.status !== 'completed')) throw new PrivacyError('The worker receipt did not match the saved run. Refresh history.', response.status, true)
        return { action, requestId, httpStatus: response.status, state: updated, status: response.status === 502 ? 'failed' : response.status === 202 ? 'running' : 'completed' }
    }
    throw failure(response.status, true)
}
export async function verifyExportChecksum(exported: import('./model').PrivacyExport) {
    const Crypto = await import('expo-crypto')
    const checksum = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify(exported.data))
    if (checksum !== exported.checksum) throw new PrivacyError('The export checksum did not match. Do not share this archive; refresh request history.', 0, true)
}
