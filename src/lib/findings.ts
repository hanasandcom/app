import type { AppSettings } from '../types'
import { apiFetch } from './api'

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const string = (value: unknown) => typeof value === 'string' ? value : ''
const hasControl = (value: string) => Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
const validId = (value: string) => /^[A-Za-z0-9_.:@-]{1,200}$/.test(value) && value !== '.' && value !== '..'
export type FindingCaseRef = { caseId: string; organizationId?: string; alertId: string }
export type FindingEvidence = { id: string; sourceName: string; captureMode: string; observedAt: string; collectedAt: string; publishedAt: string; excerpt: string; captureId: string; contentHash: string; redactionState: string; safeToShow: boolean }
export type Finding = {
    id: string; organizationId?: string; title: string; actor: string; matchedTerm: string; severity: string; reviewState: string; deliveryState: string
    summary: string; recommendedAction: string; observation: string; observedAt: string; evidence: FindingEvidence[]; caseId: string
}
export type FindingsPage = { scope: string; tenantId: string; organizationId?: string; items: Finding[]; total: number; cursor: string | null; nextCursor: string | null }
export class FindingsError extends Error { constructor(message: string, readonly status = 0) { super(message) } }
export const findingsScope = (settings: AppSettings) => JSON.stringify([settings.siteBaseUrl, settings.apiBaseUrl, settings.userId, settings.authToken, settings.selectedOrganizationId, settings.impersonationToken, settings.impersonatingUserId])
export function findingsWorkspace(settings: AppSettings) {
    if (!settings.userId || !settings.authToken) throw new FindingsError('Sign in to view Findings.', 401)
    if (settings.impersonationToken || settings.impersonatingUserId) throw new FindingsError('Return to your own account to view Findings.', 403)
    const organizationId = settings.selectedOrganizationId && settings.selectedOrganizationId !== 'personal' && settings.selectedOrganizationId !== settings.userId ? settings.selectedOrganizationId : undefined
    const tenantId = organizationId || settings.userId
    if (!validId(tenantId)) throw new FindingsError('Choose a valid workspace.')
    return { tenantId, organizationId }
}
export function findingText(value: unknown, limit = 1000) {
    return string(value).replace(/https:\/\/(?:canary\.)?discord(?:app)?\.com\/api\/webhooks\/[^\s"'<>]+/gi, '[webhook redacted]')
        .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}\b/g, '[token redacted]')
        .replace(/\b(token|secret|webhookUrl|authorization|apiKey)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,}\]]+)/gi, '$1: [redacted]')
        .replace(/\s+/g, ' ').trim().slice(0, limit)
}
const metadataFallback = 'Evidence metadata is available.'
const structuredText = (value: string) => /[{[]/.test(value) || /["'][a-zA-Z0-9_ -]+["']\s*:/.test(value.replace(/\\"/g, '"'))
function metadataSummary(value: unknown) {
    const allowed = new Set(['actorname', 'actor', 'sourcename', 'source', 'victimname', 'company', 'domain', 'category', 'status', 'artifacttype', 'observedat'])
    const pending = [{ value, depth: 0 }], summary: string[] = []
    let visited = 0
    while (pending.length && visited++ < 512) {
        const next = pending.pop()!
        if (next.depth > 6) continue
        if (Array.isArray(next.value)) {
            pending.push(...next.value.slice(0, 3).map(value => ({ value, depth: next.depth + 1 })))
        } else for (const [key, value] of Object.entries(object(next.value))) {
            if (allowed.has(key.toLowerCase()) && typeof value === 'string' && !structuredText(value)) {
                const safe = findingText(value, 160)
                if (safe) summary.push(safe)
            } else if (value && typeof value === 'object') pending.push({ value, depth: next.depth + 1 })
        }
    }
    return summary.join(' · ') || metadataFallback
}
export function findingExcerpt(value: unknown) {
    let raw = string(value).trim()
    // Decode bounded JSON string wrappers before classifying; escaped punctuation must not hide structured fields.
    for (let depth = 0; depth < 3 && raw.startsWith('"'); depth++) {
        if (raw.length > 8000) return metadataFallback
        try {
            const decoded: unknown = JSON.parse(raw)
            if (typeof decoded !== 'string') return metadataFallback
            raw = decoded.trim()
        } catch { return metadataFallback }
    }
    if (raw.startsWith('"')) return metadataFallback
    // Structured capture metadata is never displayed wholesale, even when prefixed or JSON-encoded twice.
    if (structuredText(raw)) {
        if (raw.length > 8000) return metadataFallback
        const unescaped = raw.replace(/\\"/g, '"')
        const candidates = [raw, unescaped]
        for (const candidate of [raw, unescaped]) {
            const start = candidate.search(/[{[]/), end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'))
            if (start >= 0 && end > start) candidates.push(candidate.slice(start, end + 1))
        }
        for (let candidate of candidates) {
            for (let depth = 0; depth < 3; depth++) {
                try {
                    const parsed: unknown = JSON.parse(candidate)
                    if (parsed && typeof parsed === 'object') return metadataSummary(parsed)
                    if (typeof parsed !== 'string') break
                    candidate = parsed
                } catch { break }
            }
        }
        return metadataFallback
    }
    const text = findingText(raw, 8000)
    if (!text) return metadataFallback
    if (/not extracted/i.test(text)) return 'No actor entity identified in this capture.'
    if (/parser|dynamic application data/i.test(text)) return 'The page contained dynamic application data that could not be interpreted into structured fields.'
    return text
}

function identifier(value: unknown) {
    const id = string(value)
    if (!validId(id)) throw new FindingsError('Findings returned an invalid identifier. Refresh to try again.')
    return id
}
function timestamp(value: unknown) {
    const text = string(value)
    return Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : ''
}
function finding(value: unknown, workspace: { tenantId: string; organizationId?: string }): Finding {
    const row = object(value), workflow = object(row.workflowContext), webhook = object(row.webhookContext)
    if (row.tenantId !== workspace.tenantId || [workflow.tenantId, webhook.tenantId].some(value => value !== undefined && value !== null && value !== '' && value !== workspace.tenantId)) throw new FindingsError('The findings response does not match this workspace.')
    const organizations = [row.organizationId, row.orgId, workflow.organizationId, webhook.organizationId].filter(value => value !== undefined && value !== null && value !== '')
    if (organizations.some(value => value !== workspace.organizationId) || workspace.organizationId && !organizations.length) throw new FindingsError('The finding does not match this organization.')
    if (!Array.isArray(row.evidence) || row.evidence.length > 2000 || typeof object(row.matchedTerm).value !== 'string') throw new FindingsError('Findings returned incomplete evidence. Refresh to try again.')
    const term = findingText(object(row.matchedTerm).value), title = findingText(row.company) || term
    const observed = findingText(row.observedMatchSummary)
    const summary = observed && !/\b(reviewed|corroborated|parser|candidate|queue|worker|governance|evidence boundary)\b/i.test(observed)
        ? observed : `${title} was mentioned in ${findingText(row.sourceFamily).replaceAll('_', ' ')} intelligence. Investigate the retained evidence for its source and timing.`
    const rawActor = string(row.actor).trim()
    const actor = rawActor.length <= 200 && !hasControl(rawActor) && findingText(rawActor, 200) === rawActor ? rawActor : ''
    const caseId = string(row.caseId) || string(workflow.caseId) || string(webhook.caseId)
    const evidence = row.evidence.map(value => {
        const item = object(value), provenance = object(item.provenance)
        const safeToShow = item.redactionState !== 'raw_sensitive' && item.safeToShow !== false
        return {
            id: identifier(item.id), sourceName: findingText(item.sourceName) || 'Source not recorded', captureMode: findingText(item.captureMode), redactionState: findingText(item.redactionState),
            observedAt: timestamp(item.observedAt || item.firstSeenAt || provenance.publishedAt), collectedAt: timestamp(provenance.collectedAt), publishedAt: timestamp(provenance.publishedAt),
            excerpt: safeToShow ? findingExcerpt(item.excerpt) : '', safeToShow, captureId: findingText(provenance.captureId, 200), contentHash: findingText(item.contentHash, 256),
        }
    })
    if (new Set(evidence.map(item => item.id)).size !== evidence.length) throw new FindingsError('Findings returned duplicate evidence identifiers.')
    const timing = object(row.matchTiming)
    return { id: identifier(row.id), organizationId: workspace.organizationId, title, actor, matchedTerm: term, severity: findingText(row.severity), reviewState: findingText(row.reviewState), deliveryState: findingText(row.deliveryState), summary,
        recommendedAction: findingText(row.recommendedAction, 4000), observation: timing.kind === 'new_evidence' ? 'New observation' : timing.kind === 'historical_backfill' ? 'Historical match' : 'Observation',
        observedAt: timestamp(object(row.evidenceSummary).lastObservedAt || row.lastSeenAt || row.firstSeenAt), evidence, caseId: validId(caseId) ? caseId : '' }
}
export async function loadFindings(settings: AppSettings, cursor: string | null = null, signal?: AbortSignal): Promise<FindingsPage> {
    const workspace = findingsWorkspace(settings)
    if (cursor !== null && (!cursor || cursor.length > 4096 || hasControl(cursor))) throw new FindingsError('The findings page cursor is invalid. Refresh to start again.')
    const site = new URL(settings.siteBaseUrl)
    if (site.protocol !== 'https:' || site.username || site.password || site.search || site.hash) throw new FindingsError('Findings requires a secure website address.')
    const url = new URL('/api/findings/alerts', site)
    url.searchParams.set('tenantId', workspace.tenantId)
    if (workspace.organizationId) url.searchParams.set('organizationId', workspace.organizationId)
    url.searchParams.set('limit', '50')
    if (cursor !== null) url.searchParams.set('cursor', cursor)
    const controller = new AbortController(), abort = () => controller.abort()
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(abort, 20000)
    try {
        if (controller.signal.aborted) throw new FindingsError('Findings request cancelled.')
        // The maintained GET performs its existing read-side projection repair. Never auto-poll or prefetch it.
        const response = await apiFetch(settings, url.toString(), {
            method: 'GET', signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store',
            headers: { Accept: 'application/json', Authorization: `Bearer ${settings.authToken}`, id: settings.userId },
        })
        const body = object(await response.json().catch(() => null))
        if (controller.signal.aborted) throw new FindingsError('Findings request cancelled.')
        if (!response.ok) throw new FindingsError(response.status === 401 ? 'Your session could not be verified. Sign in again.' : response.status === 403 || response.status === 404 ? 'Findings is not visible for this workspace membership.' : 'Findings is unavailable. Refresh to try again.', response.status)
        if (object(body.visibilityDecision).allowed !== true) throw new FindingsError('Findings visibility could not be verified.', 403)
        if (!Array.isArray(body.alerts) || body.alerts.length > 50 || !Number.isSafeInteger(body.total) || Number(body.total) < 0) throw new FindingsError('Findings returned an invalid page.')
        if (workspace.organizationId && object(body.organization).id !== workspace.organizationId) throw new FindingsError('The organization response does not match this workspace.')
        const next = body.nextCursor ?? object(body.pagination).nextCursor ?? null
        if (next !== null && (typeof next !== 'string' || !next || next.length > 4096 || next === cursor || hasControl(next))) throw new FindingsError('Findings returned an invalid next page.')
        const items = body.alerts.map(value => finding(value, workspace))
        if (new Set(items.map(row => row.id)).size !== items.length) throw new FindingsError('Findings returned duplicate identifiers.')
        return { scope: findingsScope(settings), ...workspace, items, total: Number(body.total), cursor, nextCursor: next }
    } catch (cause) {
        if (cause instanceof FindingsError) throw cause
        throw new FindingsError('Findings is unavailable. Refresh to try again.')
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort) }
}
export function filterFindings(items: Finding[], query: string, reviewOnly: boolean) {
    const search = query.toLowerCase()
    return [...items].filter(row => (!reviewOnly || !['resolved', 'closed', 'false_positive', 'suppressed'].includes(row.reviewState) && row.deliveryState !== 'muted')
        && [row.title, row.actor, row.matchedTerm].some(value => value.toLowerCase().includes(search)))
        .sort((a, b) => (Date.parse(b.observedAt) || 0) - (Date.parse(a.observedAt) || 0))
}
export function findingCaseRef(finding: Finding): FindingCaseRef | undefined {
    return finding.caseId ? { caseId: finding.caseId, alertId: finding.id, organizationId: finding.organizationId } : undefined
}
