import type { AppSettings } from '../types'
import { apiFetch } from './api'

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown) => typeof value === 'string' ? value : ''
const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
const records = (value: unknown) => Array.isArray(value) ? value.map(object).filter(row => Object.keys(row).length) : []
export function normalizeThreatQuery(query: string) {
    const clean = query.trim()
    if (clean.length < 2 || clean.length > 200) throw new Error('Enter between 2 and 200 characters.')
    return clean
}
export function threatAccountKey(settings: AppSettings) { return JSON.stringify([settings.siteBaseUrl, settings.apiBaseUrl, settings.userId, settings.authToken, settings.impersonationToken, settings.impersonatingUserId, settings.selectedOrganizationId]) }
export function savedSearchMutationOutcome(state: { visible: boolean; generation: number; currentGeneration: number; currentRequest: boolean; aborted: boolean }) {
    return !state.visible || state.generation !== state.currentGeneration || !state.currentRequest ? 'ignore'
        : state.aborted ? 'unconfirmed' : 'apply'
}
export function safeEvidenceUrl(value: unknown) {
    try { const url = new URL(text(value)); return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null } catch { return null }
}
function siteApiUrl(settings: AppSettings, path: string) {
    let base: URL
    try { base = new URL(settings.siteBaseUrl) } catch { throw new Error('Threat search requires a valid website address.') }
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('Threat search requires an HTTPS website address.')
    return new URL(`api/${path.replace(/^\/+/, '')}`, `${base.href.replace(/\/+$/, '')}/`)
}
/** A fresh budget belongs to one explicit user search or refresh. */
export class ThreatRefreshBudget {
    private query = ''
    private remaining = 0
    start(query: string) { this.query = query.trim().toLowerCase(); this.remaining = 5 }
    cancel() { this.remaining = 0 }
    take(query: string) {
        if (query.trim().toLowerCase() !== this.query || this.remaining === 0) return false
        this.remaining -= 1
        return true
    }
}
export type ThreatSearchResult = ReturnType<typeof normalizeThreatResult>
export function normalizeThreatResult(value: unknown, query: string) {
    const body = object(value)
    if (typeof body.query !== 'string' || body.query.trim().toLowerCase() !== query.trim().toLowerCase() || typeof body.summary !== 'string' || !Array.isArray(body.sources) || !Array.isArray(body.recentActivity)) throw new Error('Threat search returned an invalid response. Try again.')
    const identity = object(body.actorIdentity)
    return {
        query: body.query, summary: body.summary, status: text(body.status) || (body.mode === 'unavailable' ? 'unavailable' : 'ready'), mode: text(body.mode), generatedAt: text(body.generatedAt),
        refreshAfterSeconds: typeof body.refreshAfterSeconds === 'number' ? Math.max(3, Math.min(60, body.refreshAfterSeconds)) : 0,
        confidence: typeof body.confidence === 'number' && Number.isFinite(body.confidence) ? body.confidence : null,
        aliases: strings(body.aliases), notes: strings(body.notes), catalogOnly: identity.catalogMatched === true && identity.activityEvidenceAvailable !== true,
        candidates: records(identity.candidates).map(row => ({ name: text(row.canonicalName), description: text(row.description), url: safeEvidenceUrl(row.sourceUrl), aliases: strings(row.associatedNames) })),
        sources: records(body.sources).map(row => ({ id: text(row.id), name: text(row.name), type: text(row.type), provenance: text(row.provenance), url: safeEvidenceUrl(row.url), collectedAt: text(row.lastCollectedAt) })),
        activity: records(body.recentActivity).map(row => ({ title: text(row.title), detail: text(row.detail), date: text(row.date), sourceIds: strings(row.sourceIds), url: safeEvidenceUrl(row.url), reviewState: text(row.reviewState), corroboration: text(row.corroborationState) })),
        techniques: records(body.ttps).map(row => ({ name: text(row.name), tactic: text(row.tactic), detail: text(row.detail), attackId: text(row.attackId), sourceIds: strings(row.sourceIds) })),
        targets: records(body.targets).map(row => ({ sector: text(row.sector), regions: strings(row.regions), rationale: text(row.rationale) })),
    }
}
async function request(settings: AppSettings, url: URL, signal: AbortSignal, init: RequestInit = {}) {
    if (url.protocol !== 'https:') throw new Error('Threat search requires HTTPS.')
    const response = await apiFetch(settings, url.toString(), { ...init, signal })
    const payload: unknown = await response.json().catch(() => null)
    if (!response.ok) {
        if (response.status === 404) throw new Error('Threat search is temporarily unavailable. Try again later.')
        const body = object(payload)
        const error = text(object(body.error).message) || text(body.message) || text(body.error)
        throw new Error(error || `Threat search is unavailable (${response.status}).`)
    }
    return payload
}
export async function searchThreatIntel(settings: AppSettings, query: string, signal: AbortSignal) {
    const clean = normalizeThreatQuery(query)
    const url = siteApiUrl(settings, 'ti/search')
    url.searchParams.set('q', clean)
    url.searchParams.set('cached', 'true')
    return normalizeThreatResult(await request(settings, url, signal), clean)
}
export type SavedThreatSearch = { query: string; savedAt: string }
function savedSearchUrl(settings: AppSettings) {
    if (!settings.authToken || !settings.userId) throw new Error('Sign in to manage saved searches.')
    if (settings.impersonationToken || settings.impersonatingUserId) throw new Error('Return to your own account to manage saved searches.')
    return siteApiUrl(settings, 'backend/ti/saved-searches')
}
export async function loadSavedThreatSearches(settings: AppSettings, signal: AbortSignal): Promise<SavedThreatSearch[]> {
    const payload = object(await request(settings, savedSearchUrl(settings), signal))
    if (!Array.isArray(payload.savedSearches)) throw new Error('Account-saved searches are unavailable. Try again.')
    return records(payload.savedSearches).flatMap(row => typeof row.query === 'string' ? [{ query: row.query, savedAt: text(row.savedAt) || text(row.saved_at) }] : [])
}
export async function changeSavedThreatSearch(settings: AppSettings, query: string, save: boolean, signal: AbortSignal) {
    const clean = normalizeThreatQuery(query)
    const url = savedSearchUrl(settings)
    if (!save) url.searchParams.set('query', clean)
    await request(settings, url, signal, { method: save ? 'POST' : 'DELETE', ...(save ? { body: JSON.stringify({ query: clean }) } : {}) })
}
