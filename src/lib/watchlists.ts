import type { AppSettings } from '../types'
import { apiFetch } from './api'

export const watchlistKinds = ['company', 'domain', 'vendor', 'actor', 'keyword'] as const
export type WatchlistKind = typeof watchlistKinds[number]
export type WatchlistStatus = 'active' | 'paused' | 'archived'
export type WatchlistItem = { id: string; organizationId: string; kind: WatchlistKind; value: string; notes: string; status: WatchlistStatus; updatedAt: string }
export type WatchlistDraft = { kind: WatchlistKind; value: string; notes: string }
export type WatchlistPage = { organizationId: string; name: string; lifecycle: string; items: WatchlistItem[]; projectionSupported: boolean; canWrite: boolean; canArchive: boolean; canCleanup: boolean; canReconcile: boolean }
export type WatchlistAction = 'pause' | 'resume' | 'restore' | 'archive'
export type WatchlistChange = { type: 'create'; draft: WatchlistDraft } | { type: 'edit'; itemId: string; draft: WatchlistDraft } | { type: WatchlistAction; itemId: string } | { type: 'cleanup'; itemIds: string[] }
export class WatchlistRequestError extends Error {
    constructor(message: string, readonly outcomeUnknown = false) { super(message) }
}
const schema = 'organization.watchlist_projection_receipt.v1'
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown) => typeof value === 'string' ? value : ''
function identifier(value: string) {
    if (!/^[A-Za-z0-9_.:@-]{1,200}$/.test(value) || ['.', '..', 'personal'].includes(value)) throw new Error('Select a valid organization or watchlist item.')
    return encodeURIComponent(value)
}
export function watchlistScope(settings: AppSettings) { return JSON.stringify([settings.apiBaseUrl, settings.userId, settings.authToken, settings.impersonationToken, settings.selectedOrganizationId]) }
export function normalizeWatchlistItem(value: unknown, organizationId: string): WatchlistItem {
    const row = object(value)
    if (!text(row.id) || row.organizationId !== organizationId || !watchlistKinds.includes(row.kind as WatchlistKind) || !['active', 'paused', 'archived'].includes(text(row.status)) || !text(row.value)) throw new Error('The watchlist response is invalid. Refresh before continuing.')
    return { id: text(row.id), organizationId, kind: row.kind as WatchlistKind, value: text(row.value), notes: text(row.notes), status: row.status as WatchlistStatus, updatedAt: text(row.updatedAt) }
}
export function normalizeWatchlistPage(value: unknown, organizationId: string): WatchlistPage {
    const body = object(value), organization = object(body.organization), contract = object(body.sharedWatchlistContract)
    if (organization.id !== organizationId || contract.organizationId !== organizationId || !Array.isArray(body.watchlistItems)) throw new Error('The organization watchlist response is invalid.')
    const capabilities = object(contract.capabilities), permissions = object(contract.permissions)
    const items = body.watchlistItems.map(item => normalizeWatchlistItem(item, organizationId))
    if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('The watchlist response contains duplicate items.')
    return { organizationId, name: text(organization.name), lifecycle: text(organization.lifecycleStatus), items, projectionSupported: capabilities.authoritativeProjectionSync === true && capabilities.projectionReconcile === true && capabilities.projectionReceiptSchemaVersion === schema, canWrite: permissions.canWrite === true, canArchive: permissions.canArchive === true, canCleanup: permissions.canCleanup === true, canReconcile: permissions.canReconcile === true }
}
export function mayChangeWatchlists(settings: AppSettings, page: WatchlistPage, type: WatchlistChange['type']) {
    if (settings.impersonationToken || !page.projectionSupported || settings.selectedOrganizationId !== page.organizationId || !['active', 'archived'].includes(page.lifecycle)) return false
    if (type === 'cleanup') return page.canCleanup
    if (type === 'archive') return page.canArchive
    return page.lifecycle === 'active' && page.canWrite
}
export function validateWatchlistDraft(draft: WatchlistDraft): WatchlistDraft {
    if (!watchlistKinds.includes(draft.kind)) throw new Error('Choose a supported watchlist type.')
    let value = draft.value.replace(/\0/g, '').trim()
    if (draft.kind === 'domain') value = value.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
    if (draft.kind === 'actor' || draft.kind === 'keyword') value = value.toLowerCase()
    if (!value || value.length > 240) throw new Error('Enter a watchlist term with 1–240 characters.')
    if (draft.notes.length > 2000) throw new Error('Use 2000 characters or fewer for notes.')
    return { kind: draft.kind, value, notes: draft.notes.replace(/\0/g, '').trim() }
}
export function filterWatchlists(items: WatchlistItem[], query: string, status: WatchlistStatus | '') {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
    return items.filter(item => (!status || item.status === status) && terms.every(term => `${item.kind} ${item.value} ${item.notes}`.toLocaleLowerCase().includes(term)))
}
function confirmedMonitoring(receiptValue: unknown, organizationId: string, itemIds: string[]) {
    const receipt = object(receiptValue), projection = object(receipt.projection), rebuild = object(receipt.alertRebuild)
    const ids = Array.isArray(receipt.itemIds) ? receipt.itemIds : []
    return receipt.schemaVersion === schema && receipt.organizationId === organizationId
        && ids.length === itemIds.length && new Set(ids).size === ids.length && itemIds.every(id => ids.includes(id))
        && rebuild.status === 'not_requested' && rebuild.reason === 'projection_only'
        && ['synchronized', 'unchanged'].includes(text(projection.status)) && projection.source === 'identity'
        && Array.isArray(projection.watchlistIds) && projection.watchlistIds.every(id => itemIds.some(item => id === `org_shared_watchlist:${organizationId}:${item}`))
        && Array.isArray(projection.unresolvedItemIds) && projection.unresolvedItemIds.length === 0
        && typeof projection.checkedAt === 'string' && Number.isFinite(Date.parse(projection.checkedAt))
}
export function maySyncWatchlists(settings: AppSettings, page: WatchlistPage) {
    return !settings.impersonationToken && settings.selectedOrganizationId === page.organizationId
        && page.lifecycle === 'active' && page.projectionSupported && page.canReconcile
}
export function watchlistSyncResult(value: unknown, organizationId: string, itemIds: string[]) {
    const body = object(value)
    const ids = Array.isArray(body.itemIds) ? body.itemIds : []
    if (body.organizationId !== organizationId || ids.length !== itemIds.length || new Set(ids).size !== ids.length || !itemIds.every(id => ids.includes(id))) throw new Error('Monitoring sync could not be confirmed. Refresh before trying again.')
    const confirmed = confirmedMonitoring(body.dwmAlertBridge, organizationId, itemIds)
    return { message: confirmed ? 'Monitoring synced.' : 'Monitoring sync did not complete.', warning: confirmed ? '' : 'You can try Sync monitoring again. The saved watch term will not be changed.' }
}
export async function syncWatchlists(settings: AppSettings, page: WatchlistPage, itemIds: string[], requestId: string) {
    if (!maySyncWatchlists(settings, page)) throw new Error('Monitoring sync is unavailable for this workspace or service version.')
    if (!itemIds.length || itemIds.length > 50 || new Set(itemIds).size !== itemIds.length) throw new Error('Select 1–50 different watch terms to sync.')
    itemIds.forEach(id => { identifier(id); if (!page.items.some(item => item.id === id)) throw new Error('Select watch terms from this organization.') })
    const body = await request(settings, page.organizationId, '/reconcile', { method: 'POST', body: JSON.stringify({ itemIds, requestId, reason: 'Monitoring sync requested from the native workspace.' }) })
    return watchlistSyncResult(body, page.organizationId, itemIds)
}
async function request(settings: AppSettings, org: string, suffix: string, init: RequestInit, mutation = false) {
    if (!settings.authToken || !settings.userId) throw new Error('Sign in to view watchlists.')
    const url = new URL(`${settings.apiBaseUrl.replace(/\/+$/, '')}/organizations/${identifier(org)}/watchlists${suffix}`)
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Watchlists require a secure API address.')
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000)
    const abort = () => controller.abort()
    if (init.signal?.aborted) controller.abort()
    else init.signal?.addEventListener('abort', abort, { once: true })
    try {
        let response: Response
        try { response = await apiFetch({ ...settings, selectedOrganizationId: org }, url.toString(), { ...init, signal: controller.signal, credentials: 'omit', headers: { 'Content-Type': 'application/json' } }) }
        catch { throw new WatchlistRequestError(mutation ? 'The save outcome is unknown. Refresh the list before repeating the action.' : 'Watchlists could not be reached. Refresh to try again.', mutation) }
        const body = object(await response.json().catch(() => null))
        if (!response.ok) throw new WatchlistRequestError(text(body.message) || text(object(body.error).message) || text(body.error) || `Watchlists are unavailable (${response.status}).`, mutation && response.status >= 500)
        return body
    } finally { clearTimeout(timer); init.signal?.removeEventListener('abort', abort) }
}
export async function loadWatchlists(settings: AppSettings, signal: AbortSignal) {
    const org = settings.selectedOrganizationId || ''
    return normalizeWatchlistPage(await request(settings, org, '?includeArchived=true', { signal }), org)
}
export function watchlistMutationResult(value: unknown, organizationId: string, cleanup = false, expectedItemIds?: string[]) {
    const body = object(value)
    if (body.saved !== true) throw new WatchlistRequestError('The save could not be confirmed. Refresh before repeating the action.', true)
    let items: WatchlistItem[]
    let requiresRefresh = false
    try {
        if (cleanup) {
            if (!Array.isArray(body.archivedItems)) throw new Error('Missing cleanup result')
            items = body.archivedItems.map(item => normalizeWatchlistItem(item, organizationId))
            if (items.some(item => item.status !== 'archived')) throw new Error('Invalid cleanup state')
        } else items = [normalizeWatchlistItem(body.watchlistItem, organizationId)]
        if (expectedItemIds && items.some(item => !expectedItemIds.includes(item.id))) throw new Error('Unexpected saved item')
    } catch { items = []; requiresRefresh = true }
    const receipt = object(body.dwmAlertBridge), projection = object(receipt.projection), rebuild = object(receipt.alertRebuild)
    const ids = Array.isArray(receipt.itemIds) ? receipt.itemIds : []
    const aligned = !requiresRefresh && receipt.schemaVersion === schema && receipt.organizationId === organizationId && ids.length === items.length && new Set(ids).size === ids.length && items.every(item => ids.includes(item.id)) && rebuild.status === 'not_requested' && rebuild.reason === 'projection_only'
    const completed = aligned && confirmedMonitoring(receipt, organizationId, items.map(item => item.id))
    const noChanges = aligned && cleanup && items.length === 0 && projection.status === 'unchanged' && projection.checkedAt === null && projection.reason === 'no_changed_items'
    return {
        saved: true as const, items, requiresRefresh,
        warning: completed || noChanges ? '' : 'Saved. Monitoring sync is not confirmed. Open the term and choose Sync monitoring to try again.',
        message: completed ? 'Saved and monitoring synced. Alert rebuilding was not requested.'
            : noChanges ? 'No items changed. Alert rebuilding was not requested.'
                : aligned ? 'Saved. Alert rebuilding was not requested.' : 'Saved.',
    }
}
export async function changeWatchlists(settings: AppSettings, page: WatchlistPage, change: WatchlistChange, requestId: string) {
    if (!mayChangeWatchlists(settings, page, change.type)) throw new Error('Watchlist changes are unavailable for this workspace or service version.')
    let suffix = '', method = 'POST', body: Record<string, unknown> = { requestId, reason: 'Watchlist updated from the native workspace.' }
    if (change.type === 'create') body = { ...body, ...validateWatchlistDraft(change.draft) }
    else if (change.type === 'cleanup') {
        if (!change.itemIds.length || change.itemIds.length > 50 || new Set(change.itemIds).size !== change.itemIds.length) throw new Error('Select 1–50 different items for cleanup.')
        change.itemIds.forEach(id => { identifier(id); if (!page.items.some(item => item.id === id)) throw new Error('Select cleanup items from this organization.') })
        suffix = '/cleanup'; body.itemIds = change.itemIds
    } else {
        const item = page.items.find(item => item.id === change.itemId)
        if (!item) throw new Error('Refresh to select an item from this organization.')
        suffix = `/${identifier(change.itemId)}`
        if (change.type === 'edit') { if (item.status === 'archived') throw new Error('Restore the item before editing.'); method = 'PUT'; body = { ...body, ...validateWatchlistDraft(change.draft) } }
        else if (change.type === 'archive') method = 'DELETE'
        else { if (change.type === 'pause' && item.status !== 'active' || change.type === 'resume' && item.status !== 'paused' || change.type === 'restore' && item.status !== 'archived') throw new Error('Refresh before changing this item’s state.'); suffix += '/actions'; body.action = change.type }
    }
    return watchlistMutationResult(await request(settings, page.organizationId, suffix, { method, body: JSON.stringify(body) }, true), page.organizationId, change.type === 'cleanup', change.type === 'create' ? undefined : change.type === 'cleanup' ? change.itemIds : [change.itemId])
}
