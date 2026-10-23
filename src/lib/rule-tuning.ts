import type { AppSettings } from '../types'
import { apiFetch } from './api'
import { organizationListBase } from './organization-endpoint'
import { validateRuleConditions, type RuleCondition, type RuleDraft, type OrganizationRule } from './organization-rules'

export const tuningOrganizationId = '3e735e7b-4d7f-444d-9806-231fa26cfcec'
export type TuningAccess = { scope: string; canRead: boolean; canWrite: boolean }
export type LogPattern = { message: string; ip: string; ip_path: string | null; user_agent: string; user_agent_path: string | null; last_triggered: string | null; last_24h_count: string; event_count: string; storage_bytes: string }
export type TuningSnapshot = { organizationId: string; generatedAt: string | null; logs: LogPattern[]; pending: boolean; refreshing: boolean }
export type TuningSort = 'message' | 'ip' | 'user_agent' | 'event_count' | 'storage_bytes'
export type TuningRange = '1' | '24' | '168' | 'all'
export type TuningWindow = { from: string | null; until: string }
export type TuningCursor = { time: string; id: string }
export type TuningEvent = { id: string; timestamp: string; normalized: Record<string, unknown>; rank: number }
export type TuningPreview = { key: string; savedVersion?: string; count: number; scanned: number; bytes: number; events: TuningEvent[]; cursor: TuningCursor | null }
export type ReprocessJob = { id: string; rule_id: string; rule_version: string; status: string; scanned: string; matched: string; protected: string; removed_events: string; removed_sources: string; error: string | null; created_at: string; updated_at: string }
export type ReprocessState = { jobs: ReprocessJob[]; existing: { count: number; bytes: number } | null }
export class TuningError extends Error {
    constructor(message: string, readonly status = 0, readonly uncertain = false) { super(message) }
}
export type TuningInputState = { generation: number; active: boolean; pending: boolean; disabled: boolean }
export function canEditTuningInput(current: TuningInputState, capturedGeneration: number) {
    return current.active && !current.pending && !current.disabled && current.generation === capturedGeneration
}
export type ReprocessReviewState = {
    epoch: number; active: boolean; disabled: boolean; pending: boolean; locked: boolean
    range: TuningRange; version: string; acknowledged: boolean; previewKey: string | null; jobId: string | null
}
export function canConfirmReprocessing(current: ReprocessReviewState, reviewed: ReprocessReviewState, cancel: boolean) {
    if (!current.active || current.disabled || current.pending || current.locked || current.epoch !== reviewed.epoch
        || current.range !== reviewed.range || current.version !== reviewed.version) return false
    return cancel ? !!current.jobId && current.jobId === reviewed.jobId
        : !current.jobId && current.acknowledged && reviewed.acknowledged && !!current.previewKey && current.previewKey === reviewed.previewKey
}
export function lockReprocessReview(current: ReprocessReviewState): ReprocessReviewState {
    return { ...current, epoch: current.epoch + 1, locked: true, acknowledged: false, previewKey: null }
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown) => typeof value === 'string' ? value : ''
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:@-]{1,200}$/.test(value) && !['.', '..'].includes(value)
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const decimal = (value: unknown): value is string => typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) && Number.isFinite(Number(value))
const timestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))
const slug = (id: string) => {
    if (!validId(id)) throw new TuningError('Choose a valid saved rule.')
    return id.replace(/\.v\d+$/, '')
}
export function tuningScope(settings: AppSettings) {
    return JSON.stringify([settings.apiBaseUrl, settings.userId, settings.authToken, settings.selectedOrganizationId, settings.impersonationToken, settings.impersonatingUserId])
}
function access(settings: AppSettings, verified: TuningAccess, write = false) {
    if (!settings.authToken || !settings.userId || verified.scope !== tuningScope(settings) || !verified.canRead
        || write && (!verified.canWrite || settings.impersonationToken || settings.impersonatingUserId)) throw new TuningError('Refresh and verify Hanasand access before continuing.')
}
async function request(settings: AppSettings, path: string, signal: AbortSignal, body?: unknown, mutation = false, base = settings.apiBaseUrl) {
    let origin: URL
    try { origin = new URL(base) } catch { throw new TuningError('Rule tuning requires a secure API address.') }
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash) throw new TuningError('Rule tuning requires a secure API address.')
    if (!settings.userId || !settings.authToken) throw new TuningError('Sign in to review log tuning.', 401)
    const controller = new AbortController(), abort = () => controller.abort()
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, body === undefined ? 25000 : 130000)
    try {
        if (controller.signal.aborted) throw new TuningError('Request cancelled.')
        const response = await apiFetch({ ...settings, selectedOrganizationId: tuningOrganizationId }, `${base.replace(/\/+$/, '')}/${path}`, {
            method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal,
            cache: 'no-store', credentials: 'omit', redirect: 'error', headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${settings.authToken}`, id: settings.userId,
                ...(settings.impersonationToken ? { 'x-impersonation-token': settings.impersonationToken } : {}) },
        })
        const payload = object(await response.json().catch(() => null))
        if (controller.signal.aborted) throw new TuningError('Request cancelled. Refresh and review before continuing.', 0, mutation)
        if (!response.ok) throw new TuningError(response.status === 401 ? 'Your session could not be verified. Refresh manually.'
            : response.status === 403 ? 'Hanasand access is required; changes require an active owner, administrator or editor.'
                : response.status === 409 ? 'The saved rule or job changed. Refresh before continuing.'
                    : 'Rule tuning is unavailable. Refresh and review before trying again.', response.status, mutation && response.status >= 500)
        return { payload, status: response.status }
    } catch (cause) {
        if (cause instanceof TuningError) throw cause
        throw new TuningError(mutation ? 'The operation outcome is unknown. Refresh and review before any further action.' : 'Rule tuning could not be loaded. Refresh manually.', 0, mutation)
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
}
export async function loadTuningAccess(settings: AppSettings, signal: AbortSignal): Promise<TuningAccess> {
    const { payload } = await request(settings, 'management/organizations?internalPages=1', signal, undefined, false, organizationListBase(settings))
    if (typeof payload.allowed !== 'boolean' || typeof payload.canEdit !== 'boolean') throw new TuningError('Hanasand access could not be verified.')
    return { scope: tuningScope(settings), canRead: payload.allowed, canWrite: payload.allowed && payload.canEdit && !settings.impersonationToken && !settings.impersonatingUserId }
}
export function parseTuningSnapshot(value: unknown): TuningSnapshot {
    const body = object(value)
    if (body.organizationId !== tuningOrganizationId || !Array.isArray(body.logs) || body.logs.length > 100 || typeof body.pending !== 'boolean'
        || typeof body.refreshing !== 'boolean' || body.generatedAt !== null && !timestamp(body.generatedAt)) throw new TuningError('The tuning snapshot is invalid. Refresh before continuing.')
    const logs = body.logs.map(value => {
        const row = object(value)
        if (['message', 'ip', 'user_agent'].some(key => typeof row[key] !== 'string')
            || ['event_count', 'last_24h_count', 'storage_bytes'].some(key => !decimal(row[key]))
            || row.last_triggered !== null && !timestamp(row.last_triggered)
            || ![null, 'ip', 'source.ip'].includes(row.ip_path as string | null)
            || ![null, 'user_agent', 'metadata.user_agent'].includes(row.user_agent_path as string | null)) throw new TuningError('A log pattern is invalid. Refresh before continuing.')
        return row as LogPattern
    })
    return { organizationId: tuningOrganizationId, generatedAt: body.generatedAt as string | null, logs, pending: body.pending, refreshing: body.refreshing }
}
export async function loadTuningSnapshot(settings: AppSettings, verified: TuningAccess, signal: AbortSignal) {
    access(settings, verified)
    return parseTuningSnapshot((await request(settings, 'logs/tuning', signal)).payload)
}
export async function refreshTuningSummary(settings: AppSettings, verified: TuningAccess, signal: AbortSignal) {
    access(settings, verified, true)
    const { payload, status } = await request(settings, 'logs/tuning/refresh', signal, {}, true)
    if (status !== 202 || payload.refreshing !== true) throw new TuningError('The summary refresh was not confirmed. Review its status before retrying.', status, true)
}
export function sortTuningLogs(logs: LogPattern[], field: TuningSort, descending: boolean) {
    if (!['message', 'ip', 'user_agent', 'event_count', 'storage_bytes'].includes(field)) throw new TuningError('Choose a valid sort field.')
    return [...logs].sort((a, b) => (['message', 'ip', 'user_agent'].includes(field) ? a[field].localeCompare(b[field], undefined, { numeric: true, sensitivity: 'base' }) : Number(a[field]) - Number(b[field])) * (descending ? -1 : 1))
}
export function tuningPreset(log: LogPattern): RuleDraft {
    const conditions: RuleCondition[] = [{ path: 'message', operator: 'equals', value: log.message, caseSensitive: true }]
    const executable = /^failed exec: (\/\S+)$/.exec(log.message)?.[1]
    if (executable) conditions.push(...['metadata.collector=auditd', 'event_type=process', 'action=exec', 'outcome=failure', `process.executable=${executable}`].map(pair => {
        const split = pair.indexOf('=')
        return { path: pair.slice(0, split), operator: 'equals' as const, value: pair.slice(split + 1), caseSensitive: true }
    }))
    if (log.ip_path && log.ip) conditions.push({ path: log.ip_path, operator: 'equals', value: log.ip, caseSensitive: true })
    if (log.user_agent_path && log.user_agent) conditions.push({ path: log.user_agent_path, operator: 'equals', value: log.user_agent, caseSensitive: true })
    validateRuleConditions(conditions)
    return { name: `Suppress: ${log.message}`.slice(0, 120), explanation: executable
        ? 'Suppress this auditd failed-exec pattern for the attempted executable and retain only matching process-exec failures.'
        : 'Suppress this repeated stored log pattern using the message and available IP and user agent fields.', severity: 'low', enabled: true,
    definition: { stage: 'analyze', action: 'drop', match: 'all', conditions } }
}
export function tuningSignature(draft: RuleDraft) {
    const name = draft.name.trim(), explanation = draft.explanation.trim(), stage = draft.definition.stage, action = draft.definition.action
    if (name.length < 2 || name.length > 120 || explanation.length < 10 || explanation.length > 500 || !['low', 'medium', 'high', 'critical'].includes(draft.severity)
        || !['match', 'analyze', 'detect'].includes(stage || '') || !['keep', 'drop'].includes(action || '') || stage !== 'analyze' && action !== 'keep') throw new TuningError('Check the rule name, description, severity, stage and action.')
    return { name, explanation, severity: action === 'drop' ? 'low' : draft.severity, stage, action, match: 'all', conditions: validateRuleConditions(draft.definition.conditions).map(({ path, operator, value, caseSensitive }) => ({ path, operator, value, ...(caseSensitive !== undefined ? { caseSensitive } : {}) })) }
}
export function tuningWindow(range: TuningRange, now = Date.now()): TuningWindow {
    if (!['1', '24', '168', 'all'].includes(range)) throw new TuningError('Choose a valid preview range.')
    return { from: range === 'all' ? null : new Date(now - Number(range) * 3600000).toISOString(), until: new Date(now).toISOString() }
}
export function tuningPreviewKey(settings: AppSettings, draft: RuleDraft, window: TuningWindow) {
    return JSON.stringify([tuningScope(settings), tuningSignature(draft), window])
}
export async function previewTuningRule(settings: AppSettings, verified: TuningAccess, draft: RuleDraft, window: TuningWindow, cursor: TuningCursor | null, signal: AbortSignal, savedVersion?: string): Promise<TuningPreview> {
    access(settings, verified)
    const signature = tuningSignature(draft)
    if (!timestamp(window.until) || window.from !== null && (!timestamp(window.from) || Date.parse(window.from) >= Date.parse(window.until))
        || cursor && (!validId(cursor.id) || !timestamp(cursor.time))) throw new TuningError('Choose a valid fixed preview window and cursor.')
    const { payload } = await request(settings, `rules/preview?organizationId=${tuningOrganizationId}`, signal,
        { ...window, conditions: signature.conditions, action: signature.action, cursor, sample: cursor === null, limit: cursor === null ? 2000 : 1000, storedLogsOnly: true })
    const next = payload.cursor === null ? null : object(payload.cursor)
    if (!number(payload.count) || !number(payload.scanned) || !number(payload.bytes) || !Array.isArray(payload.events) || payload.events.length > 2000
        || next !== null && (!validId(next.id) || !timestamp(next.time) || cursor?.id === next.id && cursor?.time === next.time)) throw new TuningError('The preview is invalid. Check the rule again.')
    const events = payload.events.map(value => {
        const row = object(value)
        if (!validId(row.id) || !timestamp(row.timestamp) || !row.normalized || Array.isArray(row.normalized) || typeof row.normalized !== 'object' || !number(row.rank)) throw new TuningError('A preview event is invalid.')
        return { id: row.id, timestamp: row.timestamp, normalized: object(row.normalized), rank: row.rank } as TuningEvent
    })
    return { key: tuningPreviewKey(settings, draft, window), savedVersion, count: payload.count, scanned: payload.scanned, bytes: payload.bytes, events, cursor: next ? next as TuningCursor : null }
}
export async function createTuningRule(settings: AppSettings, verified: TuningAccess, draft: RuleDraft, signal: AbortSignal): Promise<OrganizationRule> {
    access(settings, verified, true)
    const signature = tuningSignature(draft), { payload, status } = await request(settings, `rules?organizationId=${tuningOrganizationId}`, signal, signature, true)
    const rule = object(payload.rule), definition = object(rule.definition)
    if (status !== 201 || !validId(rule.id) || typeof rule.version !== 'string' || !rule.version || rule.enabled !== true || rule.source !== 'owned'
        || rule.name !== signature.name || rule.explanation !== signature.explanation || rule.severity !== signature.severity
        || definition.stage !== signature.stage || definition.action !== signature.action || JSON.stringify(validateRuleConditions(definition.conditions).map(({ path, operator, value, caseSensitive }) => [path, operator, value, caseSensitive])) !== JSON.stringify(signature.conditions.map(({ path, operator, value, caseSensitive }) => [path, operator, value, caseSensitive]))) throw new TuningError('Saving could not be confirmed. Refresh the rule list before creating another.', status, true)
    return rule as OrganizationRule
}
export async function listTuningRules(settings: AppSettings, verified: TuningAccess, signal: AbortSignal) {
    access(settings, verified)
    const { payload } = await request(settings, `rules?organizationId=${tuningOrganizationId}&view=list`, signal)
    if (payload.organizationId !== tuningOrganizationId || !Array.isArray(payload.rules)) throw new TuningError('The saved rule list is invalid.')
    return payload.rules.flatMap(value => {
        const row = object(value)
        if (!validId(row.id) || typeof row.name !== 'string' || typeof row.enabled !== 'boolean') throw new TuningError('A saved rule is invalid.')
        return row.source === 'owned' ? [{ id: row.id, name: row.name, enabled: row.enabled }] : []
    })
}
export async function loadSavedTuningRule(settings: AppSettings, verified: TuningAccess, id: string, signal: AbortSignal): Promise<OrganizationRule> {
    access(settings, verified)
    const { payload } = await request(settings, `rules/${encodeURIComponent(slug(id))}?organizationId=${tuningOrganizationId}`, signal)
    const rule = object(payload.rule), definition = object(rule.definition)
    if (payload.organizationId !== tuningOrganizationId || payload.isHistorical !== false || !validId(rule.id) || slug(rule.id) !== slug(id)
        || typeof rule.version !== 'string' || !rule.version || typeof rule.enabled !== 'boolean') throw new TuningError('The saved rule could not be verified.')
    tuningSignature({ name: text(rule.name), explanation: text(rule.explanation), severity: text(rule.severity), enabled: rule.enabled, definition })
    return { ...rule, definition } as OrganizationRule
}
function requireRule(rule: OrganizationRule) {
    if (!validId(rule.id) || !rule.version || rule.source !== 'owned' || rule.enabled !== true || rule.definition.stage !== 'analyze' || rule.definition.action !== 'drop') throw new TuningError('Save and enable an Analyze drop rule before reprocessing.')
}
function parseJob(value: unknown, rule: OrganizationRule): ReprocessJob {
    const row = object(value)
    if (!validId(row.id) || !validId(row.rule_id) || slug(row.rule_id) !== slug(rule.id) || typeof row.rule_version !== 'string'
        || !['queued', 'running', 'completed', 'failed', 'cancelled'].includes(text(row.status))
        || ['scanned', 'matched', 'protected', 'removed_events', 'removed_sources'].some(key => !decimal(row[key]))
        || !timestamp(row.created_at) || !timestamp(row.updated_at) || row.error !== null && typeof row.error !== 'string') throw new TuningError('Reprocessing status is invalid. Refresh manually.')
    return row as ReprocessJob
}
export async function loadRuleReprocessing(settings: AppSettings, verified: TuningAccess, rule: OrganizationRule, signal: AbortSignal): Promise<ReprocessState> {
    access(settings, verified); requireRule(rule)
    const { payload } = await request(settings, `rules/${encodeURIComponent(slug(rule.id))}/reprocess?organizationId=${tuningOrganizationId}`, signal)
    const existing = payload.existing === null ? null : object(payload.existing)
    if (!Array.isArray(payload.jobs) || payload.jobs.length > 10 || existing && (!number(existing.count) || !number(existing.bytes))) throw new TuningError('Reprocessing status is invalid.')
    return { jobs: payload.jobs.map(value => parseJob(value, rule)), existing: existing as ReprocessState['existing'] }
}
export async function startRuleReprocessing(settings: AppSettings, verified: TuningAccess, rule: OrganizationRule, window: TuningWindow, preview: TuningPreview, signal: AbortSignal) {
    access(settings, verified, true); requireRule(rule)
    const draft: RuleDraft = { name: rule.name, explanation: rule.explanation, severity: rule.severity, enabled: rule.enabled, definition: rule.definition }
    if (preview.savedVersion !== rule.version || preview.key !== tuningPreviewKey(settings, draft, window)) throw new TuningError('Check matches again for this saved version and range.')
    const { payload, status } = await request(settings, `rules/${encodeURIComponent(slug(rule.id))}/reprocess?organizationId=${tuningOrganizationId}`, signal, { confirm: true, version: rule.version, from: window.from }, true)
    try {
        const job = parseJob(payload.job, rule)
        if (![200, 202].includes(status) || job.rule_version !== rule.version || !['queued', 'running'].includes(job.status)) throw new Error()
        return job
    } catch { throw new TuningError('Reprocessing may have started. Refresh its job status before retrying.', status, true) }
}
export async function cancelRuleReprocessing(settings: AppSettings, verified: TuningAccess, rule: OrganizationRule, job: ReprocessJob, signal: AbortSignal) {
    access(settings, verified, true); requireRule(rule)
    if (!['queued', 'running'].includes(job.status) || slug(job.rule_id) !== slug(rule.id) || !validId(job.id)) throw new TuningError('Refresh the active job before stopping it.')
    const { payload } = await request(settings, `rules/${encodeURIComponent(slug(rule.id))}/reprocess?organizationId=${tuningOrganizationId}`, signal, { action: 'cancel', jobId: job.id }, true)
    try {
        const result = parseJob(payload.job, rule)
        if (result.id !== job.id || result.status !== 'cancelled') throw new Error()
        return result
    } catch { throw new TuningError('Stopping was not confirmed. Refresh the job before trying again.', 0, true) }
}
