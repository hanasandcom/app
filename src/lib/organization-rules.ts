import type { AppSettings } from '../types'
import { apiFetch } from './api'
import { loadToolOrganizations, type ToolOrganization } from './organization-tools'

export type RuleCategory = 'match' | 'analysis' | 'detection'
export type RuleCondition = { path: string, operator: 'equals' | 'contains' | 'regex', value: string, caseSensitive?: boolean }
export type RuleDefinition = Record<string, unknown> & { stage?: string, action?: string, storeScope?: string, conditions?: RuleCondition[] }
export type OrganizationRule = { id: string, recordId?: string, name: string, explanation: string, severity: string, family?: string, enabled: boolean, source?: string, version?: string, definition: RuleDefinition, hitCount?: number | null }
export type RulesContext = { scope: string, organization: ToolOrganization, canManage: boolean, canManageRetention: boolean, rules: OrganizationRule[] }
export type RuleDetail = { scope: string, organizationId: string, canEdit: boolean, isHistorical: boolean, rule: OrganizationRule & { version: string }, triggerCount?: number | null, audit: Array<{ id: string, event_type: string, created_at: string }>, nextOffset: number | null }
export type RuleDraft = { name: string, explanation: string, severity: string, enabled: boolean, definition: RuleDefinition }
export type RulePreviewWindow = { from: string, until: string }
export type RulePreviewCursor = { time: string, id: string }
export type RulePreview = { count: number, scanned: number, events: Array<{ id: string, timestamp: string, normalized: Record<string, unknown> }>, cursor: RulePreviewCursor | null }
export class RuleRequestError extends Error {
    constructor(message: string, readonly status: number) { super(message) }
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown) => typeof value === 'string' ? value : ''
export function rulesAccountScope(settings: AppSettings) {
    // Memory-only comparison; never render, persist or log this credential scope.
    return JSON.stringify([settings.apiBaseUrl, settings.userId, settings.authToken, settings.selectedOrganizationId, settings.impersonatingUserId, settings.impersonationToken])
}
export function rulesImpersonationActive(settings: AppSettings) {
    return Boolean(settings.impersonationToken || settings.impersonatingUserId)
}
export function createRuleDraft(category: RuleCategory): RuleDraft {
    return { name: '', explanation: '', severity: 'medium', enabled: true, definition: { stage: category === 'analysis' ? 'analyze' : category === 'detection' ? 'detect' : 'match', action: 'keep', match: 'all', conditions: [{ path: 'event_type', operator: 'equals', value: '' }] } }
}
export function ruleDraftChanged(draft: RuleDraft, initial: RuleDraft) {
    return JSON.stringify(draft) !== JSON.stringify(initial)
}
function organizationId(settings: AppSettings) {
    if (!settings.userId || !settings.authToken) throw new Error('Sign in to load organization rules.')
    if (!settings.selectedOrganizationId || settings.selectedOrganizationId === 'personal') throw new Error('Select an organization to work with rules.')
    return settings.selectedOrganizationId
}
function assertScope(settings: AppSettings, context: RulesContext, mutation = false) {
    const id = organizationId(settings)
    if (context.scope !== rulesAccountScope(settings) || context.organization.id !== id || context.organization.status !== 'active') throw new Error('Your account or organization changed. Reload rules before continuing.')
    if (mutation && rulesImpersonationActive(settings)) throw new Error('Return to your own account before changing rules.')
    if (mutation && !context.canManage) throw new Error('An organization owner, admin, or editor is required to change rules.')
}
async function request(settings: AppSettings, path: string, init: RequestInit = {}) {
    const id = organizationId(settings)
    const url = new URL(`${settings.apiBaseUrl.replace(/\/+$/, '')}/${path}`)
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Rules require a secure HTTPS connection.')
    url.searchParams.set('organizationId', id)
    const controller = new AbortController()
    const abort = () => controller.abort()
    if (init.signal?.aborted) controller.abort()
    else init.signal?.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(abort, 20000)
    try {
        const response = await apiFetch(settings, url.toString(), { ...init, signal: controller.signal, credentials: 'omit', cache: 'no-store', headers: { Accept: 'application/json', 'Content-Type': 'application/json' } })
        const body = object(await response.json().catch(() => null))
        if (!response.ok) throw new RuleRequestError(response.status === 409 ? 'This rule changed. Your draft is kept. Reload the current rule before saving again.'
            : response.status === 401 ? 'Your session could not be verified. Sign in again.'
                : response.status === 403 ? 'You do not have permission for this rule operation.'
                    : response.status >= 500 ? 'The rule service is temporarily unavailable. Refresh before retrying a change.'
                        : text(body.error) || `Rule request failed (${response.status}).`, response.status)
        if (controller.signal.aborted) throw new Error('Rule request cancelled.')
        return body
    } finally { clearTimeout(timeout); init.signal?.removeEventListener('abort', abort) }
}
function rule(value: unknown, full = false): OrganizationRule {
    const row = object(value)
    if (!text(row.id) || !text(row.name) || typeof row.explanation !== 'string' || typeof row.enabled !== 'boolean' || !text(row.severity) || (full && (!text(row.version) || !row.definition || typeof row.definition !== 'object' || Array.isArray(row.definition)))) throw new Error('The rule service returned an incomplete rule. Refresh before editing.')
    return { ...row, definition: object(row.definition) } as OrganizationRule
}
const slug = (id: string) => {
    const value = id.replace(/\.v\d+$/, '')
    if (!value || value === '.' || value === '..' || value.length > 200) throw new Error('Choose a valid rule.')
    return encodeURIComponent(value)
}
export async function loadOrganizationRules(settings: AppSettings, category: RuleCategory, signal: AbortSignal): Promise<RulesContext> {
    const id = organizationId(settings)
    if (!['match', 'analysis', 'detection'].includes(category)) throw new Error('Choose a rule category.')
    const [organizations, body] = await Promise.all([
        loadToolOrganizations(settings, signal), request(settings, `rules?view=list&category=${category}`, { signal }),
    ])
    const organization = organizations.find(item => item.id === id && item.status === 'active')
    if (!organization || body.organizationId !== id || !Array.isArray(body.rules)) throw new Error('The selected organization could not be verified. Reload your workspace.')
    return { scope: rulesAccountScope(settings), organization, canManage: ['owner', 'admin', 'editor'].includes(organization.role), canManageRetention: body.canManageRetention === true, rules: body.rules.map(value => rule(value)) }
}
export async function loadOrganizationRule(settings: AppSettings, context: RulesContext, id: string, signal: AbortSignal): Promise<RuleDetail> {
    assertScope(settings, context)
    const body = await request(settings, `rules/${slug(id)}`, { signal })
    if (body.organizationId !== context.organization.id || typeof body.canEdit !== 'boolean' || typeof body.isHistorical !== 'boolean') throw new Error('Rule access could not be verified. Reload this rule.')
    const current = rule(body.rule, true) as RuleDetail['rule']
    if (current.id.replace(/\.v\d+$/, '') !== id.replace(/\.v\d+$/, '')) throw new Error('The server returned a different rule.')
    return { scope: context.scope, organizationId: context.organization.id, canEdit: body.canEdit, isHistorical: body.isHistorical, rule: current, triggerCount: typeof body.triggerCount === 'number' || body.triggerCount === null ? body.triggerCount : undefined,
        audit: Array.isArray(body.audit) ? body.audit.flatMap(item => { const entry = object(item); return text(entry.id) && text(entry.event_type) && text(entry.created_at) ? [{ id: text(entry.id), event_type: text(entry.event_type), created_at: text(entry.created_at) }] : [] }) : [], nextOffset: typeof body.nextOffset === 'number' ? body.nextOffset : null }
}
export function validateRuleConditions(value: unknown): RuleCondition[] {
    if (!Array.isArray(value) || value.length < 1 || value.length > 8) throw new Error('Add 1–8 conditions.')
    return value.map(entry => {
        const condition = object(entry)
        const path = text(condition.path).trim(), operator = text(condition.operator), match = text(condition.value)
        if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(path) || !['equals', 'contains', 'regex'].includes(operator) || !match || match.length > 200) throw new Error('Each condition needs a valid field, operator, and value of 1–200 characters.')
        if (condition.caseSensitive !== undefined && typeof condition.caseSensitive !== 'boolean') throw new Error('Case sensitivity must be true or false.')
        if (operator === 'regex') { try { new RegExp(match) } catch { throw new Error('The regular expression is invalid.') } }
        return { ...condition, path, operator, value: match } as RuleCondition
    })
}
export function canPreviewOrganizationRule(definition: unknown) {
    try { validateRuleConditions(object(definition).conditions); return true } catch { return false }
}
function metadata(draft: RuleDraft) {
    const name = draft.name.trim(), explanation = draft.explanation.trim()
    if (name.length < 2 || name.length > 120 || explanation.length < 10 || explanation.length > 500) throw new Error('Use a name of 2–120 characters and description of 10–500 characters.')
    if (!['low', 'medium', 'high', 'critical'].includes(draft.severity) || typeof draft.enabled !== 'boolean') throw new Error('Choose a valid severity and enabled state.')
    return { name, explanation, severity: draft.definition.action === 'drop' ? 'low' : draft.severity }
}
function retention(context: RulesContext, definition: RuleDefinition) {
    if (definition.stage === 'analyze' && !context.canManageRetention) throw new Error('Active Hanasand owner or editor access is required to change log retention.')
}
function editable(settings: AppSettings, context: RulesContext, detail: RuleDetail) {
    assertScope(settings, context, true)
    if (detail.scope !== context.scope || detail.organizationId !== context.organization.id || !detail.canEdit || detail.isHistorical || !detail.rule.version) throw new Error('This rule cannot be edited. Reload its current version and permissions.')
    retention(context, detail.rule.definition)
}
export function organizationRuleUpdatePayload(settings: AppSettings, context: RulesContext, detail: RuleDetail, draft: RuleDraft) {
    editable(settings, context, detail)
    retention(context, draft.definition)
    const base = { ...metadata(draft), enabled: draft.enabled, version: detail.rule.version }
    if (detail.rule.source === 'hanasand') return { ...base, definition: draft.definition }
    if (draft.definition.stage !== detail.rule.definition.stage) throw new Error('An existing rule’s stage cannot be changed.')
    const conditions = validateRuleConditions(draft.definition.conditions)
    const action = draft.definition.action ?? 'keep'
    if (!['keep', 'drop'].includes(action) || (draft.definition.stage !== 'analyze' && action !== 'keep')) throw new Error('Only Analyze rules can drop events.')
    if (draft.definition.storeScope !== undefined && !['all', 'custom_drop'].includes(draft.definition.storeScope)) throw new Error('Choose a valid Store scope.')
    return { ...base, conditions, action, ...(draft.definition.storeScope !== undefined ? { storeScope: draft.definition.storeScope } : {}) }
}
export async function createOrganizationRule(settings: AppSettings, context: RulesContext, draft: RuleDraft): Promise<OrganizationRule> {
    assertScope(settings, context, true); retention(context, draft.definition)
    const stage = draft.definition.stage, action = draft.definition.action
    if (!['match', 'analyze', 'detect'].includes(stage || '') || !['keep', 'drop'].includes(action || '') || (stage !== 'analyze' && action !== 'keep')) throw new Error('Choose a valid stage and action. Only Analyze rules can drop events.')
    const body = await request(settings, 'rules', { method: 'POST', body: JSON.stringify({ ...metadata(draft), stage, action, match: 'all', conditions: validateRuleConditions(draft.definition.conditions) }) })
    return rule(body.rule, true)
}
export async function updateOrganizationRule(settings: AppSettings, context: RulesContext, detail: RuleDetail, draft: RuleDraft): Promise<OrganizationRule> {
    const payload = organizationRuleUpdatePayload(settings, context, detail, draft)
    const body = await request(settings, `rules/${slug(detail.rule.id)}`, { method: 'PUT', body: JSON.stringify(payload) })
    const saved = rule(body.rule, true)
    if (saved.id !== detail.rule.id) throw new Error('Saving could not be confirmed. Reload this rule before retrying.')
    return saved
}
export async function setOrganizationRuleEnabled(settings: AppSettings, context: RulesContext, detail: RuleDetail, enabled: boolean): Promise<OrganizationRule> {
    editable(settings, context, detail)
    if (typeof enabled !== 'boolean') throw new Error('Choose enable or disable.')
    const id = detail.rule.recordId ? encodeURIComponent(detail.rule.recordId) : slug(detail.rule.id)
    const body = await request(settings, `rules/${id}/actions`, { method: 'POST', body: JSON.stringify({ action: enabled ? 'enable' : 'disable' }) })
    const saved = rule(body.rule, true)
    if (saved.id !== detail.rule.id || saved.enabled !== enabled) throw new Error('The enabled state could not be confirmed. Reload this rule before retrying.')
    return saved
}
export function rulePreviewWindow(hours: 1 | 24 | 168, now = Date.now()): RulePreviewWindow {
    return { from: new Date(now - hours * 3600000).toISOString(), until: new Date(now).toISOString() }
}
export async function previewOrganizationRule(settings: AppSettings, context: RulesContext, definition: RuleDefinition, window: RulePreviewWindow, cursor: RulePreviewCursor | null, signal: AbortSignal): Promise<RulePreview> {
    assertScope(settings, context)
    const conditions = validateRuleConditions(definition.conditions)
    if (!['keep', 'drop'].includes(definition.action || 'keep') || !Number.isFinite(Date.parse(window.from)) || !Number.isFinite(Date.parse(window.until)) || Date.parse(window.from) >= Date.parse(window.until)) throw new Error('Choose a valid preview range and action.')
    const body = await request(settings, 'rules/preview', { method: 'POST', signal, body: JSON.stringify({ ...window, conditions, action: definition.action || 'keep', cursor, sample: true, limit: 1000, storedLogsOnly: false }) })
    const next = body.cursor === null ? null : object(body.cursor)
    if (!Number.isInteger(body.count) || !Number.isInteger(body.scanned) || !Array.isArray(body.events) || (next !== null && (!text(next.id) || !text(next.time)))) throw new Error('The preview returned an unexpected response.')
    return { count: Number(body.count), scanned: Number(body.scanned), events: body.events.slice(0, 100).map(item => { const row = object(item); return { id: text(row.id), timestamp: text(row.timestamp), normalized: object(row.normalized) } }), cursor: next ? { time: text(next.time), id: text(next.id) } : null }
}
