import type { AppSettings } from '../types'
import { apiFetch } from './api'
import { integrationsScope, loadIntegrations } from './integrations'

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown) => typeof value === 'string' ? value : ''
const rows = (value: unknown) => Array.isArray(value) ? value.map(object) : []
const validId = (value: string) => /^[A-Za-z0-9_.:@-]{1,200}$/.test(value) && value !== '.' && value !== '..'
export type DeliveryAction = 'test' | 'send' | 'retry'
export type DeliveryCaseRef = { caseId: string; organizationId: string; alertId: string }
export type DeliveryAlert = { id: string; title: string; organizationId: string; actor: string; matchedTerm: string; reviewState: string; deliveryState: string; caseId: string; full: Record<string, unknown> }
export type DeliveryAttempt = {
    id: string; alertId: string; organizationId: string; status: string; attemptedAt: string; dryRun: boolean
    httpStatus?: number; attemptCount?: number; nextRetryAt: string; error: string; errorClass: string
    destinationId: string; requestId: string; auditEventId: string; dedupeKey: string; payloadHash: string; canRetry: boolean
}
export type DeliveryHistoryPage = {
    accountKey: string; organizationId: string; alerts: DeliveryAlert[]; attempts: DeliveryAttempt[]
    canTest: boolean; canSend: boolean; canRetry: boolean; notice: string; liveDeliveryEnabled: boolean
}
export type DeliveryOutcome = { attempts: DeliveryAttempt[]; failed: boolean; uncertain: boolean; message: string }
export class DeliveryHistoryError extends Error {
    constructor(message: string, readonly status = 0, readonly uncertain = false) { super(message) }
}
export const deliveryHistoryScope = integrationsScope
export function deliveryOrganization(settings: AppSettings) {
    if (!settings.authToken || !settings.userId) throw new DeliveryHistoryError('Sign in to view delivery history.')
    const id = settings.selectedOrganizationId || ''
    if (!validId(id) || id === 'personal' || id === settings.userId) throw new DeliveryHistoryError('Select an organization to view customer delivery.')
    return id
}
const safe = (value: unknown, fallback = '') => (text(value) || fallback).replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted URL]').slice(0, 500)
async function request(settings: AppSettings, path: string, init: RequestInit = {}, signal?: AbortSignal, website = false) {
    const configured = new URL(settings.apiBaseUrl)
    if (configured.protocol !== 'https:' || configured.username || configured.password || configured.search || configured.hash) throw new DeliveryHistoryError('Delivery requires a secure API address.')
    const base = website && ['api.hanasand.com', 'hanasand.com', 'www.hanasand.com'].includes(configured.hostname)
        ? 'https://hanasand.com/api' : settings.apiBaseUrl.replace(/\/+$/, '')
    const controller = new AbortController()
    const abort = () => controller.abort()
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(abort, 20000)
    const writing = init.method === 'POST'
    try {
        if (controller.signal.aborted) throw new DeliveryHistoryError('Request cancelled.')
        const response = await apiFetch(settings, `${base}/${path}`, {
            ...init, signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${settings.authToken}`, id: settings.userId,
                ...(settings.impersonationToken ? { 'x-impersonation-token': settings.impersonationToken } : {}) },
        })
        const body = object(await response.json().catch(() => null))
        if (controller.signal.aborted) throw new DeliveryHistoryError('Request cancelled.', 0, writing)
        return { response, body }
    } catch (cause) {
        if (cause instanceof DeliveryHistoryError) throw cause
        throw new DeliveryHistoryError(writing ? 'The delivery result is unknown. Refresh and review its history before any further action.' : 'Delivery history could not be loaded. Refresh to try again.', 0, writing)
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort) }
}
function requireRead(result: { response: Response; body: Record<string, unknown> }) {
    if (!result.response.ok) throw new DeliveryHistoryError(result.response.status === 401 ? 'Your session could not be verified. Sign in again.' : result.response.status === 403 || result.response.status === 404 ? 'Delivery is not available for this organization membership.' : 'Delivery history is unavailable. Refresh to try again.', result.response.status)
}
function alert(value: unknown, scope: string): DeliveryAlert {
    const full = object(value), workflow = object(full.workflowContext), webhook = object(full.webhookContext)
    const scopes = [full.organizationId, full.orgId, full.tenantId, workflow.organizationId, workflow.tenantId, webhook.organizationId, webhook.tenantId].filter(value => typeof value === 'string' && value !== '')
    if (!validId(text(full.id)) || !scopes.length || scopes.some(value => value !== scope)) throw new DeliveryHistoryError('The findings response does not match this organization. Refresh before continuing.')
    const caseId = text(full.caseId) || text(workflow.caseId) || text(webhook.caseId)
    return { id: text(full.id), title: safe(full.company) || safe(object(full.matchedTerm).value) || 'Finding', organizationId: scope, actor: safe(full.actor), matchedTerm: safe(object(full.matchedTerm).value), reviewState: text(full.reviewState), deliveryState: text(full.deliveryState), caseId: validId(caseId) ? caseId : '', full }
}
function attempt(value: unknown, scope: string): DeliveryAttempt {
    const row = object(value)
    const org = text(row.orgId) || text(row.organizationId)
    if (!validId(text(row.id)) || org !== scope || !validId(text(row.alertId))) throw new DeliveryHistoryError('The delivery receipt does not match this organization.')
    return {
        id: text(row.id), alertId: text(row.alertId), organizationId: scope, status: text(row.status), attemptedAt: text(row.attemptedAt), dryRun: row.dryRun === true,
        httpStatus: typeof row.responseStatus === 'number' ? row.responseStatus : typeof row.httpStatus === 'number' ? row.httpStatus : undefined, attemptCount: typeof row.attemptCount === 'number' ? row.attemptCount : undefined,
        nextRetryAt: text(row.nextRetryAt), error: safe(row.error), errorClass: safe(row.errorClass), destinationId: text(row.webhookDestinationId) || text(row.destinationId),
        requestId: text(row.requestId), auditEventId: text(row.auditEventId), dedupeKey: text(row.idempotencyKey) || text(row.dedupeKey), payloadHash: text(row.payloadHash), canRetry: false,
    }
}
export function orderDeliveryAttempts(attempts: DeliveryAttempt[]) {
    return [...attempts].sort((a, b) => (Date.parse(b.attemptedAt) || 0) - (Date.parse(a.attemptedAt) || 0))
}
export async function loadDeliveryHistory(settings: AppSettings, signal?: AbortSignal): Promise<DeliveryHistoryPage> {
    const organizationId = deliveryOrganization(settings)
    const params = new URLSearchParams({ tenantId: organizationId, organizationId })
    const [history, findings, integrations] = await Promise.all([
        request(settings, `dwm/webhook-deliveries?orgId=${encodeURIComponent(organizationId)}`, {}, signal),
        request(settings, `findings/alerts?${params}`, {}, signal, true).catch(() => null),
        loadIntegrations(settings, signal).catch(() => null),
    ])
    requireRead(history)
    if (!Array.isArray(history.body.deliveries) || history.body.deliveries.length > 100) throw new DeliveryHistoryError('The delivery history response is invalid.')
    if (object(history.body.visibility).allowed !== true) throw new DeliveryHistoryError('Delivery history is not visible for this membership.', 403)
    const attempts = history.body.deliveries.map(row => attempt(row, organizationId))
    const readiness = object(history.body.deliveryReadinessConsumer)
    const retry = object(history.body.deliveryRetryRequest)
    const canManage = !!integrations?.canManage && object(readiness.access).canRetry === true && !settings.impersonationToken && !settings.impersonatingUserId
    const liveDeliveryEnabled = readiness.liveDeliveryEnabled === true
    for (const entry of rows(retry.entries)) {
        if (entry.orgId !== organizationId || object(entry.liveRequest).canSend !== true || object(entry.liveRequest).externalSendEnabled !== true || rows(object(entry.liveRequest).blockers).some(row => row.blocking === true)) continue
        const row = attempts.find(row => row.id === entry.deliveryId && row.alertId === entry.alertId)
        if (row && row.status === 'failed' && !row.dryRun) row.canRetry = canManage && object(retry.access).canRetry === true && liveDeliveryEnabled
    }
    const findingsValid = !!findings?.response.ok && Array.isArray(findings.body.alerts) && findings.body.alerts.length <= 1000
    const alerts = findingsValid ? (findings!.body.alerts as unknown[]).map(row => alert(row, organizationId)) : []
    const notice = !findingsValid ? 'Findings could not be loaded. History remains available; refresh before sending.'
        : !integrations ? 'Workspace permissions could not be verified. History is read-only.'
            : integrations.lifecycleUnavailable ? 'Workspace lifecycle could not be verified. History is read-only.'
                : integrations.lifecycleBlocked ? 'Workspace lifecycle blocks delivery actions.'
                    : !canManage ? 'Delivery actions are unavailable for this account or membership.' : !liveDeliveryEnabled ? 'Live delivery is disabled. Dry-run tests remain available.' : ''
    return { accountKey: deliveryHistoryScope(settings), organizationId, alerts, attempts: orderDeliveryAttempts(attempts), canTest: canManage && findingsValid, canSend: canManage && findingsValid && liveDeliveryEnabled, canRetry: canManage && object(retry.access).canRetry === true && liveDeliveryEnabled, notice, liveDeliveryEnabled }
}
export function filterDeliveryAlerts(alerts: DeliveryAlert[], query: string, reviewOnly: boolean) {
    const q = query.trim().toLowerCase()
    return alerts.filter(row => (!reviewOnly || !['resolved', 'closed', 'false_positive', 'suppressed'].includes(row.reviewState) && row.deliveryState !== 'muted') && [row.title, row.actor, row.matchedTerm].some(value => value.toLowerCase().includes(q)))
}
export function selectedDeliveryAttempts(page: DeliveryHistoryPage, alertId: string) {
    return !alertId ? page.attempts : page.attempts.filter(row => row.alertId === alertId || row.alertId === 'webhook_test')
}
export function deliveryCaseRef(page: DeliveryHistoryPage, alertId: string): DeliveryCaseRef | undefined {
    const alert = page.alerts.find(row => row.id === alertId)
    return alert?.caseId ? { caseId: alert.caseId, organizationId: page.organizationId, alertId: alert.id } : undefined
}
export function deliveryRetryTarget(page: DeliveryHistoryPage, deliveryId?: string) {
    const receipt = page.attempts.find(row => row.id === deliveryId)
    if (!page.canRetry || !receipt?.canRetry || receipt.organizationId !== page.organizationId
        || receipt.status !== 'failed' || receipt.dryRun || !validId(receipt.id) || !validId(receipt.alertId)) return undefined
    return { deliveryId: receipt.id, alertId: receipt.alertId }
}
export async function performDeliveryAction(settings: AppSettings, page: DeliveryHistoryPage, action: DeliveryAction, alertId: string, deliveryId?: string, signal?: AbortSignal): Promise<DeliveryOutcome> {
    const scope = deliveryOrganization(settings)
    if (page.accountKey !== deliveryHistoryScope(settings) || page.organizationId !== scope || settings.impersonationToken || settings.impersonatingUserId) throw new DeliveryHistoryError('The account or workspace changed. Refresh before continuing.')
    let payload: Record<string, unknown>
    if (action === 'retry') {
        if (deliveryRetryTarget(page, deliveryId)?.alertId !== alertId) throw new DeliveryHistoryError('This attempt is not eligible for retry.')
        payload = { orgId: scope, organizationId: scope, tenantId: scope, deliveryId }
    } else {
        const selected = page.alerts.find(row => row.id === alertId)
        if (!selected || selected.organizationId !== scope || (action === 'test' ? !page.canTest : !page.canSend)) throw new DeliveryHistoryError('This delivery action is unavailable. Refresh to review its permissions.')
        // Keep the complete authoritative finding; do not reconstruct an alert from display fields.
        if (alert(selected.full, scope).id !== alertId) throw new DeliveryHistoryError('The selected finding changed. Refresh before continuing.')
        payload = { orgId: scope, organizationId: scope, tenantId: scope, alertId, alert: selected.full, dryRun: action === 'test', live: action === 'send' }
    }
    const result = await request(settings, 'dwm/webhook-deliveries', { method: 'POST', body: JSON.stringify(payload) }, signal)
    let receipts: DeliveryAttempt[]
    try {
        if (Array.isArray(result.body.deliveries) && result.body.deliveries.length > 100) throw new Error('Too many receipts')
        receipts = Array.isArray(result.body.deliveries) ? result.body.deliveries.map(row => attempt(row, scope)) : []
    } catch { throw new DeliveryHistoryError('The delivery result could not be matched. Refresh its history.', result.response.status, true) }
    if (receipts.some(row => row.alertId !== alertId || action === 'test' && !row.dryRun)) throw new DeliveryHistoryError('The delivery result could not be matched. Refresh its history.', result.response.status, true)
    if (!result.response.ok && !receipts.length) throw new DeliveryHistoryError(result.response.status === 409 ? 'The delivery changed or is blocked. Refresh before trying again.' : 'Delivery could not be confirmed. Refresh and review its history.', result.response.status, result.response.status >= 500)
    const failed = !result.response.ok || receipts.some(row => row.status === 'failed' || !!row.error)
    const uncertain = !receipts.length
    const message = uncertain ? 'No durable delivery result was returned. Refresh and review before any further action.' : receipts.map(row => `${action === 'test' ? 'Dry-run test' : action === 'retry' ? 'Retry' : 'Delivery'}: ${row.status || 'unknown'}${row.dryRun ? ' (dry run)' : ''}${row.error ? ` — ${row.error}` : ''}.`).join('\n')
    return { attempts: orderDeliveryAttempts(receipts), failed, uncertain, message }
}
