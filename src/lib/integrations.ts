import type { AppSettings } from '../types'
import { apiFetch } from './api'

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown) => typeof value === 'string' ? value : ''
const rows = (value: unknown) => Array.isArray(value) ? value.map(object) : []
const validId = (value: string) => /^[A-Za-z0-9_.:@-]{1,200}$/.test(value) && value !== '.' && value !== '..'
export type IntegrationKind = 'discord' | 'webhook'
export type IntegrationDraft = { id?: string; name: string; kind: IntegrationKind; url: string }
export type Integration = { id: string; orgId: string; name: string; kind: IntegrationKind; status: string; endpointHint: string; lastTestedAt: string; lastTestStatus: string; canEdit: boolean; canRemove: boolean; canTest: boolean; testBlockers: string[] }
export type IntegrationsPage = { accountKey: string; scope: string; canManage: boolean; lifecycleBlocked: boolean; lifecycleUnavailable: boolean; items: Integration[] }
export class IntegrationError extends Error {
    constructor(message: string, readonly status = 0, readonly uncertain = false) { super(message) }
}
// In-memory account/workspace key only. Never persist or log it.
export function integrationsScope(settings: AppSettings) {
    return JSON.stringify([settings.apiBaseUrl, settings.userId, settings.authToken, settings.selectedOrganizationId, settings.impersonationToken, settings.impersonatingUserId])
}
export function integrationOrganization(settings: AppSettings) {
    if (!settings.userId || !settings.authToken) throw new IntegrationError('Sign in to view integrations.')
    const scope = !settings.selectedOrganizationId || settings.selectedOrganizationId === 'personal' ? settings.userId : settings.selectedOrganizationId
    if (!validId(scope)) throw new IntegrationError('Choose a valid workspace.')
    return scope
}
function safeMessage(value: unknown, fallback: string) {
    return (text(value) || fallback).replace(/https?:\/\/[^\s"'<>]+/gi, '[destination URL]').slice(0, 400)
}
async function request(settings: AppSettings, path: string, init: RequestInit = {}, signal?: AbortSignal) {
    const base = new URL(settings.apiBaseUrl)
    const url = new URL(`${settings.apiBaseUrl.replace(/\/+$/, '')}/${path}`)
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new IntegrationError('Integrations require a secure API address.')
    const controller = new AbortController(), cancel = () => controller.abort()
    const timer = setTimeout(cancel, 15000)
    if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel)
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json'); headers.set('Content-Type', 'application/json')
    headers.set('Authorization', `Bearer ${settings.authToken}`); headers.set('id', settings.userId)
    if (settings.impersonationToken) headers.set('x-impersonation-token', settings.impersonationToken)
    try {
        const response = await apiFetch(settings, url.toString(), { ...init, headers, credentials: 'omit', redirect: 'error', signal: controller.signal })
        const payload: unknown = await response.json().catch(() => null)
        return { response, body: object(payload) }
    } catch { throw new IntegrationError('The result could not be confirmed. Refresh and review before trying again.', 0, init.method !== undefined && init.method !== 'GET') }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel) }
}
function requireSuccess(response: Response, body: Record<string, unknown>, writing = false) {
    if (!response.ok) throw new IntegrationError(safeMessage(body.error, `Integrations are unavailable (${response.status}).`), response.status, writing && response.status >= 500)
}
function destination(value: unknown, scope: string) {
    const row = object(value)
    if (!validId(text(row.id)) || row.orgId !== scope || !['discord', 'webhook'].includes(text(row.kind)) || !['active', 'paused', 'archived'].includes(text(row.status))) throw new IntegrationError('The destination response is invalid. Refresh to review it.')
    return { id: text(row.id), orgId: scope, name: text(row.name), kind: row.kind as IntegrationKind, status: text(row.status), endpointHint: text(row.endpointHint), lastTestedAt: text(row.lastTestedAt), lastTestStatus: text(row.lastTestStatus) }
}
export async function loadIntegrations(settings: AppSettings, signal?: AbortSignal): Promise<IntegrationsPage> {
    const scope = integrationOrganization(settings)
    const [result, organization] = await Promise.all([
        request(settings, `dwm/webhook-destinations?orgId=${encodeURIComponent(scope)}`, {}, signal),
        scope === settings.userId ? undefined : request(settings, `organizations/${encodeURIComponent(scope)}`, {}, signal).catch(() => null),
    ])
    requireSuccess(result.response, result.body)
    let lifecycleBlocked = false, lifecycleUnavailable = false
    if (scope !== settings.userId) {
        if (!organization?.response.ok) lifecycleUnavailable = true
        else {
            const org = object(organization.body.organization), config = object(org.settings)
            const legacyMetadata = config.auditSafeMetadata && typeof config.auditSafeMetadata === 'object' && !Array.isArray(config.auditSafeMetadata)
            const privacy = Object.hasOwn(org, 'privacyDeletionInProgress') ? typeof org.privacyDeletionInProgress === 'boolean' ? org.privacyDeletionInProgress : null : legacyMetadata ? Boolean(object(config.auditSafeMetadata).privacyDeletionRunId) : null
            if (org.id !== scope || !['active', 'archived', 'deleted'].includes(text(org.lifecycleStatus)) || privacy === null) lifecycleUnavailable = true
            else lifecycleBlocked = org.lifecycleStatus !== 'active' || privacy
        }
    }
    if (!Array.isArray(result.body.destinations) || typeof object(object(result.body.destinationAdminProof).access).canManage !== 'boolean') throw new IntegrationError('Destination permissions are unavailable. Refresh to try again.')
    const canManage = object(object(result.body.destinationAdminProof).access).canManage === true && !lifecycleBlocked && !lifecycleUnavailable && !settings.impersonationToken && !settings.impersonatingUserId
    const lifecycle = rows(result.body.destinationLifecycle), tests = rows(result.body.destinationTests)
    const items = result.body.destinations.map(value => {
        const row = destination(value, scope), access = object(lifecycle.find(item => item.destinationId === row.id)?.access)
        const test = tests.find(item => item.destinationId === row.id), blockers = rows(test?.blockers)
        const rowManage = canManage && access.canManage === true
        return { ...row, canEdit: rowManage && access.canUpdate === true && row.status !== 'archived', canRemove: rowManage && access.canDisable === true && row.status === 'active', canTest: rowManage && access.canTest === true && object(test?.access).canTest === true && !blockers.some(item => item.blocking === true) && row.status === 'active', testBlockers: blockers.filter(item => item.blocking === true).map(item => safeMessage(item.message, 'Test unavailable.')) }
    })
    return { accountKey: integrationsScope(settings), scope, canManage, lifecycleBlocked, lifecycleUnavailable, items }
}
export function filterIntegrations(items: Integration[], query: string, kind = '', status = '') {
    const search = query.trim().toLocaleLowerCase()
    return items.filter(item => item.status !== 'archived' && (!kind || item.kind === kind) && (!status || item.status === status) && `${item.name} ${item.endpointHint}`.toLocaleLowerCase().includes(search))
}
export function validateIntegrationDraft(draft: IntegrationDraft) {
    if (!draft.name.trim() || draft.name.trim().length > 120 || !['discord', 'webhook'].includes(draft.kind)) throw new IntegrationError('Enter a name of 120 characters or fewer and a destination type.')
    const raw = draft.url.trim()
    if (draft.id && !raw) return
    try {
        const url = new URL(raw)
        if (raw.length > 2048 || url.protocol !== 'https:' || url.username || url.password || url.hash || draft.kind === 'discord' && (!/(^|\.)discord(?:app)?\.com$/i.test(url.hostname) || !/^\/api\/webhooks\/[^/]+\/[^/]+/.test(url.pathname))) throw new Error()
    } catch { throw new IntegrationError(draft.kind === 'discord' ? 'Enter a valid HTTPS Discord webhook URL.' : 'Enter a valid HTTPS webhook URL.') }
}
function authorize(settings: AppSettings, page: IntegrationsPage, id?: string, action?: 'edit' | 'remove' | 'test') {
    if (page.accountKey !== integrationsScope(settings) || page.scope !== integrationOrganization(settings) || !page.canManage || page.lifecycleBlocked || settings.impersonationToken || settings.impersonatingUserId) throw new IntegrationError('This workspace is read-only. Refresh to review its permissions.')
    if (id) {
        const row = page.items.find(item => item.id === id)
        if (!row || action === 'edit' && !row.canEdit || action === 'remove' && !row.canRemove || action === 'test' && !row.canTest) throw new IntegrationError('This destination action is unavailable. Refresh to review it.')
    }
}
export async function saveIntegration(settings: AppSettings, page: IntegrationsPage, draft: IntegrationDraft) {
    authorize(settings, page, draft.id, 'edit'); validateIntegrationDraft(draft)
    const payload = { orgId: page.scope, name: draft.name.trim(), kind: draft.kind, ...(draft.url.trim() ? { endpointUrl: draft.url.trim() } : {}), ...(!draft.id ? { status: 'active' } : {}) }
    const { response, body } = await request(settings, `dwm/webhook-destinations${draft.id ? `/${encodeURIComponent(draft.id)}` : ''}`, { method: draft.id ? 'PUT' : 'POST', body: JSON.stringify(payload) })
    requireSuccess(response, body, true)
    try { const result = destination(body.destination, page.scope); if (draft.id && result.id !== draft.id) throw new Error(); return result } catch { throw new IntegrationError('Save was not confirmed. Refresh and review before trying again.', response.status, true) }
}
export async function removeIntegration(settings: AppSettings, page: IntegrationsPage, id: string) {
    authorize(settings, page, id, 'remove')
    const { response, body } = await request(settings, `dwm/webhook-destinations/${encodeURIComponent(id)}`, { method: 'DELETE' })
    requireSuccess(response, body, true)
    if (object(body.destination).id !== id || object(body.destination).orgId !== page.scope || object(body.destination).status !== 'archived') throw new IntegrationError('Archiving was not confirmed. Refresh to review it.', response.status, true)
}
export async function testIntegration(settings: AppSettings, page: IntegrationsPage, id: string) {
    authorize(settings, page, id, 'test')
    const { response, body } = await request(settings, `dwm/webhook-destinations/${encodeURIComponent(id)}/test`, { method: 'POST', body: JSON.stringify({ dryRun: false, live: true }) })
    const delivery = object(body.delivery)
    if (delivery.destinationId !== id || delivery.orgId !== page.scope || !['delivered', 'dry_run', 'failed', 'skipped'].includes(text(delivery.status)) || typeof delivery.dryRun !== 'boolean') {
        requireSuccess(response, body, true)
        throw new IntegrationError('The test result was not confirmed. Refresh before trying again.', response.status, true)
    }
    if (response.status !== 202 && response.status !== 502) {
        requireSuccess(response, body, true)
        throw new IntegrationError('The test result was not confirmed. Refresh before trying again.', response.status, true)
    }
    const delivered = response.status === 202 && delivery.status === 'delivered' && delivery.dryRun === false && !delivery.error
    return { delivered, message: delivered ? 'Example message sent.' : delivery.status === 'dry_run' || delivery.dryRun ? 'Dry run recorded. No example message was sent.' : delivery.status === 'skipped' ? 'Test skipped. No example message was sent.' : 'Test failed. Review the destination before trying again.' }
}
