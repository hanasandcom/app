import type { AppSettings } from '../types'
import { apiFetch } from './api'

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown) => typeof value === 'string' ? value : ''
const rows = (value: unknown) => Array.isArray(value) ? value.map(object) : []
const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null
const counts = (value: unknown) => Object.fromEntries(Object.entries(object(value)).flatMap(([key, value]) => number(value) === null ? [] : [[key, value as number]]))
export function intelligenceAccountKey(settings: AppSettings) { return JSON.stringify([settings.siteBaseUrl, settings.userId, settings.impersonationToken, settings.selectedOrganizationId]) }
export function intelligenceSourceUrl(value: unknown) {
    try { const url = new URL(text(value)); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : null } catch { return null }
}
function endpoint(settings: AppSettings, path: string, origin: 'api' | 'site' = 'api') {
    if (!settings.userId || !settings.authToken) throw new Error('Sign in to view intelligence.')
    // The existing TI session proxy reads impersonation from cookies only. Native uses headers.
    if (settings.impersonationToken) throw new Error('Return to your own account to view intelligence.')
    const website = new URL(settings.siteBaseUrl)
    const api = new URL(settings.apiBaseUrl)
    const base = origin === 'site'
        ? website.origin
        : process.env.EXPO_PUBLIC_TI_SITE_URL || (website.hostname === 'hanasand.com' ? api.origin : website.origin)
    const url = new URL(path, base)
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Intelligence requires a secure website address.')
    return url
}
async function request(settings: AppSettings, url: URL, signal: AbortSignal, init: RequestInit = {}) {
    const response = await apiFetch(settings, url.toString(), { ...init, signal, credentials: 'omit' })
    const payload: unknown = await response.json().catch(() => null)
    if (!response.ok) {
        if (response.status === 404) throw new Error('Intelligence is temporarily unavailable. Try again later.')
        const body = object(payload)
        throw new Error(text(object(body.error).message) || text(body.message) || text(body.error) || `Intelligence is unavailable (${response.status}).`)
    }
    return object(payload)
}
export type ActorProfile = ReturnType<typeof actorProfile>
function actorProfile(value: unknown) {
    const row = object(value)
    if (!text(row.id)) throw new Error('The profile response is invalid. Try again.')
    return { id: text(row.id), name: text(row.canonicalName), normalizedName: text(row.normalizedName), actorType: text(row.actorType), aliases: strings(row.aliases), confidence: number(row.confidence), evidenceCount: number(row.evidenceCount), sourceIds: strings(row.sourceIds), captureIds: strings(row.captureIds), reviewState: text(row.reviewState), firstSeenAt: text(row.firstSeenAt), lastSeenAt: text(row.lastSeenAt), updatedAt: text(row.updatedAt) }
}
export async function loadActorProfiles(settings: AppSettings, input: { query: string; page: number }, signal: AbortSignal) {
    const url = endpoint(settings, '/api/v1/actors')
    if (!Number.isSafeInteger(input.page) || input.page < 1) throw new Error('Choose a valid profile page.')
    const query = input.query.trim()
    if (query.length > 200) throw new Error('Search with 200 characters or fewer.')
    url.searchParams.set('limit', '50'); url.searchParams.set('page', String(input.page))
    if (query) url.searchParams.set('q', query)
    const payload = await request(settings, url, signal)
    const pagination = object(payload.pagination)
    if (!Array.isArray(payload.data) || pagination.page !== input.page || (number(pagination.total) === null || Number(pagination.total) < 0) || (pagination.nextPage !== null && (!Number.isSafeInteger(pagination.nextPage) || Number(pagination.nextPage) <= input.page))) throw new Error('The profile response is invalid. Try again.')
    // The public proxy accepts numeric cursors; upstream nextCursor may be opaque. Follow nextPage.
    return { items: payload.data.map(actorProfile), total: Number(pagination.total), page: input.page, nextPage: pagination.nextPage as number | null }
}
export const deliveryStatuses = [
    { value: '', label: 'All records' }, { value: 'unresolved_reference', label: 'Needs first report' },
    { value: 'anomaly', label: 'Timestamp anomalies' }, { value: 'awaiting_alert', label: 'Awaiting alert' },
    { value: 'awaiting_delivery', label: 'Awaiting delivery' }, { value: 'complete', label: 'Complete' }, { value: 'excluded', label: 'Rejected incidents' },
] as const
export type DeliveryStatus = typeof deliveryStatuses[number]['value']
export type DeliveryFilter = { scope: 'global' | 'tenant'; tenantId: string; status: DeliveryStatus; query: string }
export const deliveryStages = ['observed', 'first_report', 'publication', 'collection', 'processing', 'first_visible', 'reviewed', 'alert_created', 'delivery_attempt', 'delivered'] as const
function deliveryUrl(settings: AppSettings, filter: DeliveryFilter) {
    // Timeliness workbench is a website proxy route. Calling it on api.hanasand.com
    // resolves to a retired path and returns 404; apiFetch forwards native auth and proof.
    const url = endpoint(settings, '/api/ti/timeliness', 'site')
    if (filter.scope !== 'global' && filter.scope !== 'tenant') throw new Error('Choose a global or tenant scope.')
    url.searchParams.set('scope', filter.scope)
    if (filter.scope === 'tenant') {
        if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(filter.tenantId.trim())) throw new Error('Enter a valid tenant or organization ID.')
        url.searchParams.set('tenantId', filter.tenantId.trim())
    }
    return url
}
function metric(value: unknown) {
    const row = object(value)
    return { sampleSize: number(row.sampleSize), medianSeconds: number(row.medianSeconds), p95Seconds: number(row.p95Seconds), p99Seconds: number(row.p99Seconds) }
}
function reference(value: unknown) {
    const row = object(value)
    return { role: text(row.role), timestamp: text(row.timestamp), evidencePath: text(row.evidencePath), referenceUrl: intelligenceSourceUrl(row.referenceUrl), referenceTitle: text(row.referenceTitle), recordedBy: text(row.recordedBy), recordedAt: text(row.recordedAt) }
}
export type DeliveryRecord = ReturnType<typeof deliveryRecord>
function deliveryRecord(value: unknown) {
    const row = object(value)
    if (!text(row.id) || !deliveryStatuses.some(status => status.value && status.value === row.status)) throw new Error('The delivery record response is invalid. Try again.')
    const recovery = object(row.reportRecovery), exclusion = object(row.exclusion)
    return {
        id: text(row.id), incidentId: text(row.incidentId), captureId: text(row.captureId), sourceId: text(row.sourceId), actorName: text(row.actorName), sourceName: text(row.sourceName), sourceFamily: text(row.sourceFamily), title: text(row.title), summary: text(row.summary), status: row.status as Exclude<DeliveryStatus, ''>, updatedAt: text(row.updatedAt),
        sources: rows(row.sources).map(source => ({ title: text(source.title), url: intelligenceSourceUrl(source.url) })),
        stages: Object.fromEntries(deliveryStages.map(stage => [stage, text(object(row.stages)[stage])])),
        provenance: Object.fromEntries(deliveryStages.map(stage => { const entry = object(object(row.provenance)[stage]); return [stage, { event: text(entry.event), evidencePath: text(entry.evidencePath), referenceUrl: intelligenceSourceUrl(entry.referenceUrl) }] })),
        missingStages: strings(row.missingStages), anomalies: strings(row.timestampAnomalies), latencies: counts(row.latencies), references: rows(row.reportReferences).map(reference),
        recovery: { status: text(recovery.status), attempts: number(recovery.attempts), reason: text(recovery.reason), nextAttemptAt: text(recovery.nextAttemptAt) },
        exclusion: text(exclusion.reason) ? { reason: text(exclusion.reason), reviewedBy: text(exclusion.reviewedBy), reviewedAt: text(exclusion.reviewedAt) } : null,
    }
}
export type DeliverySnapshot = Awaited<ReturnType<typeof loadDeliveryHealth>>
export async function loadDeliveryHealth(settings: AppSettings, filter: DeliveryFilter, cursor: string | null, signal: AbortSignal) {
    const url = deliveryUrl(settings, filter)
    if (!deliveryStatuses.some(status => status.value === filter.status)) throw new Error('Choose a valid delivery queue.')
    if (filter.query.trim().length > 200) throw new Error('Search with 200 characters or fewer.')
    url.searchParams.set('limit', '50')
    if (filter.query.trim()) url.searchParams.set('q', filter.query.trim())
    if (filter.status) url.searchParams.set('status', filter.status)
    if (cursor !== null) url.searchParams.set('cursor', cursor)
    const body = await request(settings, url, signal)
    const page = object(body.page), metrics = object(body.metrics), quality = object(body.quality)
    if (!Array.isArray(body.items) || (number(page.total) === null || Number(page.total) < 0) || number(object(body.summary).recordCount) === null || !Array.isArray(metrics.byStage) || !Array.isArray(quality.fields) || !text(body.generatedAt) || (page.nextCursor !== null && (typeof page.nextCursor !== 'string' || !page.nextCursor || page.nextCursor === cursor))) throw new Error('Delivery health returned an invalid response. Try again.')
    const groupMetrics = (value: unknown) => rows(value).map(row => ({ name: text(row.name), recordCount: number(row.recordCount), delivered: metric(object(row.metrics).reportToDeliveredSeconds) }))
    return {
        generatedAt: text(body.generatedAt), summary: counts(body.summary), items: body.items.map(deliveryRecord), total: Number(page.total), nextCursor: page.nextCursor as string | null,
        metrics: { stages: rows(metrics.byStage).map(row => ({ name: text(row.name), ...metric(row) })), sources: groupMetrics(metrics.bySourceFamily), actors: groupMetrics(metrics.byActor) },
        quality: { fields: rows(quality.fields).map(row => ({ name: text(row.name), presentCount: number(row.presentCount), missingCount: number(row.missingCount), coverage: number(row.coverage) })), issues: rows(quality.issues).map(row => ({ name: text(row.name), count: number(row.count) })), sourceClasses: rows(quality.bySourceClass).map(row => ({ name: text(row.name), recordCount: number(row.recordCount), missing: counts(row.missing), issues: counts(row.issues) })) },
    }
}
export type ReportEvidence = { role: 'actor' | 'victim' | 'publisher'; timestamp: string; referenceUrl: string; evidencePath: string; referenceTitle: string }
export function validateReportEvidence(recordId: string, form: ReportEvidence) {
    if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(recordId)) throw new Error('Select a retained record.')
    const timestamp = form.timestamp.trim()
    if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) throw new Error('Enter the published timestamp with its timezone.')
    if (!['actor', 'victim', 'publisher'].includes(form.role)) throw new Error('Choose the reporting party.')
    if (!/^[A-Za-z0-9_.$:[\]-]{3,200}$/.test(form.evidencePath.trim())) throw new Error('Enter the source-field path, such as article.time[datetime].')
    const url = intelligenceSourceUrl(form.referenceUrl.trim())
    if (!url || url.length > 2048) throw new Error('Enter a public HTTP or HTTPS reference URL.')
    const parsed = new URL(url), host = parsed.hostname.toLowerCase()
    const octets = host.split('.').map(Number)
    const privateV4 = octets.length === 4 && octets.every(value => Number.isInteger(value) && value >= 0 && value <= 255) && (octets[0] === 0 || octets[0] === 10 || octets[0] === 127 || octets[0] >= 224 || octets[0] === 169 && octets[1] === 254 || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31 || octets[0] === 192 && octets[1] === 168)
    if (privateV4 || host.includes(':') || host === 'localhost' || /\.(localhost|local|internal|onion|i2p)$/.test(host) || [...parsed.searchParams.keys()].some(key => /token|secret|password|authorization|cookie|api[_-]?key|signature/i.test(key))) throw new Error('Use a public reference without credentials or private addresses.')
    return { recordId, role: form.role, timestamp, referenceUrl: url, evidencePath: form.evidencePath.trim(), referenceTitle: form.referenceTitle.replace(/\0/g, '').replace(/\s+/g, ' ').trim().slice(0, 240) || undefined }
}
export async function recordDeliveryEvidence(settings: AppSettings, filter: DeliveryFilter, recordId: string, form: ReportEvidence, signal: AbortSignal) {
    const body = validateReportEvidence(recordId, form)
    const payload = await request(settings, deliveryUrl(settings, filter), signal, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const item = deliveryRecord(payload.item)
    if (item.id !== recordId) throw new Error('Evidence returned a different record. Refresh before retrying.')
    return { item, created: payload.created === true }
}
export function mergeIntelligencePage<T extends { id: string }>(current: T[], incoming: T[]) {
    const merged = new Map(current.map(item => [item.id, item]))
    for (const item of incoming) merged.set(item.id, item)
    return [...merged.values()]
}
export function sortActorActivity<T extends { lastSeenAt: string }>(items: T[]) {
    return items
        .map((item, index) => ({ item, index, timestamp: Date.parse(item.lastSeenAt) }))
        .sort((left, right) => {
            const leftTime = Number.isFinite(left.timestamp) ? left.timestamp : Number.NEGATIVE_INFINITY
            const rightTime = Number.isFinite(right.timestamp) ? right.timestamp : Number.NEGATIVE_INFINITY
            return rightTime - leftTime || left.index - right.index
        })
        .map(({ item }) => item)
}
