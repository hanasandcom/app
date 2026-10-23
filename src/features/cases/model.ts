import type { AppSettings } from '../../types'
export class CaseError extends Error {
    constructor(message: string, readonly status = 0, readonly uncertain = false) { super(message) }
}
export type Row = Record<string, unknown>
export const row = (v: unknown): Row => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Row : {}
export const text = (v: unknown) => typeof v === 'string' ? v : ''
export const own = (s: AppSettings) => !s.impersonationToken && !s.impersonatingUserId
export function organization(s: AppSettings) {
    const v = s.selectedOrganizationId
    if (!v || v === 'personal') return undefined
    if (!/^[A-Za-z0-9_.:@-]{1,200}$/.test(v) || ['.', '..'].includes(v)) throw new CaseError('Select a valid workspace.')
    return v
}
export function endpoint(s: AppSettings, path: string) {
    const base = new URL(s.apiBaseUrl)
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new CaseError('Cases requires a secure service URL.')
    return `${base.href.replace(/\/+$/, '')}/${path}`
}
export const caseScope = (s: AppSettings) => JSON.stringify([s.apiBaseUrl, s.siteBaseUrl, s.userId, s.authToken, s.selectedOrganizationId === 'personal' ? '' : s.selectedOrganizationId || '', s.impersonationToken, s.impersonatingUserId])
export const caseWorkspaceKey = (s: AppSettings, initialCaseId?: string) => JSON.stringify([caseScope(s), initialCaseId || ''])
export function intentScope(s: AppSettings) {
    let service = 'invalid-service'
    try { service = endpoint(s, '').replace(/\/+$/, '') } catch { /* Invalid configuration never reaches transport. */ }
    return JSON.stringify([service, s.userId, s.selectedOrganizationId === 'personal' ? '' : s.selectedOrganizationId || '', own(s) ? 'own' : 'impersonated'])
}
export function caseId(v: unknown) {
    if (typeof v !== 'string' || v.length > 23 || !/^(HA|MON)-[1-9]\d*$/.test(v) || BigInt(v.slice(v.indexOf('-') + 1)) > 9223372036854775807n) throw new CaseError('Choose a valid monitoring case.')
    return v.replace(/^MON-/, 'HA-')
}
export function repositoryId(v: unknown) {
    if (typeof v !== 'string' || !/^[a-f0-9-]{36}$/.test(v)) throw new CaseError('Choose a current repository.')
    return v
}
export function rows(v: unknown, limit = 10000): Row[] {
    if (!Array.isArray(v) || v.length > limit || v.some(x => !x || typeof x !== 'object' || Array.isArray(x))) throw new CaseError('Cases returned an incomplete collection.')
    return v as Row[]
}
export type CaseItem = {
    id: string; title: string; summary: string; status: string; severity: string; canManage: boolean
    organizationId?: string; assignedOwner: string; automationId: string; createdAt: string; updatedAt: string; lastSeenAt: string; resolvedAt: string; occurrences: number
    notificationsEnabled: boolean; resolution: Row | null; comments: Row[]; history: Row[]; notifications: Row[]
    events: Row[]; eventTotal?: number; eventPage?: number; eventSnapshot?: string; currentCheck: Row; relatedChecks: Row[]; diskDiagnostics: Row
}
export function parseCase(value: unknown, s: AppSettings, detail = false): CaseItem {
    const r = row(value), id = caseId(r.id)
    if (r.source !== 'monitoring' || !text(r.automationId) || typeof r.canManage !== 'boolean'
        || (text(r.organizationId) || undefined) !== organization(s)
        || !['open', 'in_progress', 'resolved', 'closed'].includes(text(r.status))
        || !['low', 'medium', 'high', 'critical'].includes(text(r.severity))
        || typeof r.notificationsEnabled !== 'boolean' || !Number.isSafeInteger(r.occurrences) || Number(r.occurrences) < 0) throw new CaseError('Monitoring case scope or fields could not be verified.')
    if (detail && ['comments', 'history', 'notifications', 'events', 'relatedChecks'].some(key => !Array.isArray(r[key]))) throw new CaseError('Case detail collections are incomplete.')
    if (detail && (!Number.isSafeInteger(r.eventPage) || Number(r.eventPage) < 0 || !Number.isSafeInteger(r.eventTotal) || Number(r.eventTotal) < 0 || !Number.isFinite(Date.parse(text(r.eventSnapshot))))) throw new CaseError('Case event pagination is incomplete.')
    return { id, title: text(r.title), summary: text(r.summary), status: text(r.status), severity: text(r.severity), canManage: r.canManage, organizationId: organization(s), assignedOwner: text(r.assignedOwner), automationId: text(r.automationId), createdAt: text(r.createdAt), updatedAt: text(r.updatedAt), lastSeenAt: text(r.lastSeenAt), resolvedAt: text(r.resolvedAt), occurrences: Number(r.occurrences), notificationsEnabled: r.notificationsEnabled, resolution: r.resolution ? row(r.resolution) : null, comments: rows(r.comments ?? []), history: rows(r.history ?? []), notifications: rows(r.notifications ?? []), events: rows(r.events ?? [], 50), eventPage: detail ? Number(r.eventPage) : undefined, eventTotal: detail ? Number(r.eventTotal) : undefined, eventSnapshot: detail ? text(r.eventSnapshot) : undefined, currentCheck: row(r.currentCheck), relatedChecks: rows(r.relatedChecks ?? []), diskDiagnostics: row(r.diskDiagnostics) }
}
export type Repository = { id: string; provider: string; url: string; organizationId?: string; canManage: boolean; lastReceivedAt: string; warning: string }
export function parseRepository(v: unknown, s: AppSettings): Repository {
    const r = row(v), org = text(r.organization_id) || undefined
    if (org !== undefined && org !== organization(s) || typeof r.can_manage !== 'boolean' || !['github', 'forgejo', 'gitlab'].includes(text(r.provider))) throw new CaseError('Repository scope or access could not be verified.')
    return { id: repositoryId(r.id), provider: text(r.provider), url: safeUrl(text(r.repository_url)), organizationId: org, canManage: r.can_manage, lastReceivedAt: text(r.last_received_at), warning: text(r.last_warning) }
}
export function safeUrl(v: string) {
    try { const u = new URL(v); if (u.protocol === 'https:' && !u.username && !u.password && !u.hash && !u.search && v.length <= 2000) return u.href.replace(/\/$/, '') } catch { /* Rejected below. */ }
    throw new CaseError('Use the HTTPS repository page URL without credentials or query parameters.')
}
export type CaseChange = { status?: string; severity?: string; notificationsEnabled?: boolean; comment?: string; resolutionMethod?: 'ai'; confirmResolutionId?: string }
export function changeBody(v: CaseChange) {
    const keys = Object.keys(v)
    if (!keys.length || keys.some(k => !['status', 'severity', 'notificationsEnabled', 'comment', 'resolutionMethod', 'confirmResolutionId'].includes(k))
        || v.status !== undefined && !['open', 'in_progress', 'resolved', 'closed'].includes(v.status)
        || v.severity !== undefined && !['low', 'medium', 'high', 'critical'].includes(v.severity)
        || v.notificationsEnabled !== undefined && typeof v.notificationsEnabled !== 'boolean'
        || v.comment !== undefined && (!v.comment.trim() || v.comment.length > 5000)
        || ['resolved', 'closed'].includes(v.status || '') && !v.comment?.trim()
        || v.resolutionMethod !== undefined && (v.resolutionMethod !== 'ai' || !['resolved', 'closed'].includes(v.status || ''))
        || v.confirmResolutionId !== undefined && (!v.confirmResolutionId || keys.length !== 1)) throw new CaseError('Choose a valid change; resolving or closing requires a comment of up to 5,000 characters.')
    return { ...v, ...(v.comment !== undefined ? { comment: v.comment.trim() } : {}) }
}
export function mergeIds(target: string, sources: string[]) {
    target = caseId(target)
    if (!sources.length || sources.length > 49 || new Set(sources).size !== sources.length || sources.some(v => caseId(v) !== v || v === target)) throw new CaseError('Choose one target and 1–49 other monitoring cases.')
    return { targetId: target, sourceIds: sources }
}
export function filterCases(items: CaseItem[], query: string, status: string, severity: string, review: boolean | string, owner = 'all', resolution = 'all') {
    const q = query.trim().toLowerCase()
    return items.filter(c => (!q || [c.id, c.title, c.summary, c.assignedOwner].some(v => v.toLowerCase().includes(q))) && (status === 'all' || status === 'active' ? status === 'all' || ['open', 'in_progress'].includes(c.status) : c.status === status) && (severity === 'all' || c.severity === severity) && (review === true || review === 'pending' ? needsHumanReview(c) : review !== 'confirmed' || !!c.resolution?.confirmedAt) && (owner === 'all' || owner === 'unassigned' ? owner === 'all' || !c.assignedOwner : c.assignedOwner === owner) && (resolution === 'all' || text(c.resolution?.type) === resolution))
}
export const needsHumanReview = (c: CaseItem) => !!c.resolution?.id && ['ai', 'automation'].includes(text(c.resolution.type)) && !c.resolution.confirmedAt && ['resolved', 'closed'].includes(c.status)
