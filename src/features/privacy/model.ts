import type { AppSettings } from '../../types'

export type PrivacyAction = 'export' | 'run_retention' | 'delete'
export type PrivacyRow = Record<string, unknown>
export type PrivacyPermissions = { canExport: boolean; canRunRetention: boolean; canRequestDeletion: boolean }
export type PrivacyState = {
    scope: string
    organization: { id: string; name: string; status: string; retentionDays: number }
    permissions: PrivacyPermissions
    runs: PrivacyRow[]
    requests: PrivacyRow[]
    items: PrivacyRow[]
    page: { offset: number; limit: number; nextOffset: number | null }
    protection: PrivacyRow
}
export type PrivacyExport = {
    schemaVersion: 'organization.privacy_export.v1'
    organizationId: string
    tenantId: string
    exportedAt: string
    data: { public: PrivacyRow; threatIntelligence: unknown }
    checksum: string
}
export type PrivacyReceipt = {
    action: PrivacyAction
    requestId: string
    httpStatus: number
    status: 'completed' | 'running' | 'failed'
    state?: PrivacyState
    exported?: PrivacyExport
    request?: { id: string; status: 'completed' | 'failed' }
}
export class PrivacyError extends Error {
    constructor(message: string, readonly status = 0, readonly uncertain = false) { super(message) }
}
export const row = (value: unknown): PrivacyRow => value && typeof value === 'object' && !Array.isArray(value) ? value as PrivacyRow : {}
export const text = (value: unknown) => typeof value === 'string' ? value : ''
export function utf8Size(value: string) {
    let bytes = 0
    for (const character of value) { const code = character.codePointAt(0)!; bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4 }
    return bytes
}
export function privacyId(value: unknown): string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_.:@-]{1,200}$/.test(value) || ['.', '..', 'personal'].includes(value)) throw new PrivacyError('Select a valid organization.')
    return value
}
export const privacyScope = (settings: AppSettings) => JSON.stringify([settings.apiBaseUrl, settings.siteBaseUrl, settings.userId, settings.authToken, settings.selectedOrganizationId, settings.impersonationToken, settings.impersonatingUserId])
// Stable intent identity excludes rotating credentials; this metadata lives only in the current JS runtime.
export function privacyIntentScope(settings: AppSettings) {
    let service = 'invalid-service'
    try {
        const url = new URL(settings.apiBaseUrl)
        if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash) service = url.href.replace(/\/+$/, '')
    } catch { /* Invalid configuration never reaches transport. Do not retain its raw contents. */ }
    return JSON.stringify([service, settings.userId, settings.selectedOrganizationId, settings.impersonationToken || settings.impersonatingUserId ? 'impersonated' : 'own'])
}
export function metric(value: unknown): number | null {
    if (typeof value !== 'number' && typeof value !== 'string' || typeof value === 'string' && !/^\d+$/.test(value)) return null
    const number = Number(value)
    return Number.isSafeInteger(number) && number >= 0 ? number : null
}
function records(value: unknown, maximum: number): PrivacyRow[] {
    if (!Array.isArray(value) || value.length > maximum || value.some(item => !item || typeof item !== 'object' || Array.isArray(item))) throw new PrivacyError('Privacy history is incomplete. Refresh to retry.')
    return value as PrivacyRow[]
}
export function parsePrivacyState(value: unknown, settings: AppSettings, requirePermissions = true): PrivacyState {
    const body = row(value), org = row(body.organization), page = row(body.itemPage), permission = row(body.permissions)
    const organizationId = privacyId(settings.selectedOrganizationId)
    if (body.schemaVersion !== 'organization.privacy_state.v1' || org.id !== organizationId || !text(org.name) || !text(org.status)
        || metric(org.retention_days) === null || metric(page.offset) === null || metric(page.limit) === null
        || Number(page.limit) < 1 || Number(page.limit) > 100 || (page.nextOffset !== null && metric(page.nextOffset) === null)
        || requirePermissions && ['canExport', 'canRunRetention', 'canRequestDeletion'].some(key => typeof permission[key] !== 'boolean')) {
        throw new PrivacyError('Privacy data did not match the selected organization.')
    }
    const runs = records(body.runs, 20), requests = records(body.requests, 20), items = records(body.items, 100)
    if ([...runs, ...requests, ...items].some(item => item.organization_id !== organizationId)
        || [...runs, ...requests].some(item => !text(item.id) || !text(item.status))
        || new Set(runs.map(item => item.id)).size !== runs.length || new Set(requests.map(item => item.id)).size !== requests.length
        || items.length > Number(page.limit) || page.nextOffset !== null && Number(page.nextOffset) <= Number(page.offset)) throw new PrivacyError('Privacy history did not match its organization or page.')
    return {
        scope: privacyScope(settings), organization: { id: organizationId, name: text(org.name), status: text(org.status), retentionDays: Number(org.retention_days) },
        permissions: { canExport: permission.canExport === true, canRunRetention: permission.canRunRetention === true, canRequestDeletion: permission.canRequestDeletion === true },
        runs, requests, items, page: { offset: Number(page.offset), limit: Number(page.limit), nextOffset: page.nextOffset === null ? null : Number(page.nextOffset) }, protection: row(body.protection),
    }
}
export function canUsePrivacyAction(settings: AppSettings, state: PrivacyState | null, action: PrivacyAction) {
    if (!state || state.scope !== privacyScope(settings) || settings.impersonationToken || settings.impersonatingUserId) return false
    return action === 'export' ? state.permissions.canExport : action === 'run_retention' ? state.permissions.canRunRetention : state.permissions.canRequestDeletion
}
export function matchedPrivacyOutcome(state: PrivacyState, intent: { action: PrivacyAction; requestId: string }): boolean {
    const collection = intent.action === 'run_retention' ? state.runs : state.requests
    const match = collection.find(item => item.organization_id === state.organization.id && item.request_id === intent.requestId
        && (intent.action === 'run_retention' ? item.trigger_type === 'manual' : item.request_type === (intent.action === 'delete' ? 'deletion' : 'export')))
    if (!match || !['queued', 'running', 'completed', 'failed', 'dead_letter'].includes(text(match.status))) return false
    return intent.action !== 'delete' || state.runs.some(run => run.organization_id === state.organization.id && run.request_id === intent.requestId
        && run.trigger_type === 'privacy_deletion' && run.privacy_request_id === match.id)
}
export function parsePrivacyExport(value: unknown, organizationId: string): PrivacyExport {
    const body = row(value), data = row(body.data), publicData = row(data.public), intelligence = row(data.threatIntelligence)
    if (body.schemaVersion !== 'organization.privacy_export.v1' || body.organizationId !== organizationId || body.tenantId !== organizationId
        || !text(body.exportedAt) || !Number.isFinite(Date.parse(text(body.exportedAt))) || !/^[a-f0-9]{64}$/.test(text(body.checksum))
        || row(publicData.organization).id !== organizationId || intelligence.schemaVersion !== 'organization.privacy_export.ti.v1'
        || intelligence.organizationId !== organizationId || intelligence.tenantId !== organizationId) throw new PrivacyError('The export could not be verified. Review request history.', 0, true)
    return body as PrivacyExport
}
