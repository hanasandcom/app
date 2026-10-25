import type { AgentAutomation, AgentAutomationPayload, AutomationJsonRule } from '../types'

const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const stringValue = (value: unknown) => typeof value === 'string' ? value : ''

export function normalizeAutomation(value: unknown): AgentAutomation | null {
    const entry = asRecord(value)
    const id = stringValue(entry.id)
    if (!id) return null

    return {
        id,
        name: stringValue(entry.name) || 'Automation',
        prompt: stringValue(entry.prompt),
        targetUrl: typeof entry.targetUrl === 'string' ? entry.targetUrl : null,
        monitoringType: (stringValue(entry.monitoringType) || 'fetch') as AgentAutomation['monitoringType'],
        jsonRule: entry.jsonRule && typeof entry.jsonRule === 'object' && !Array.isArray(entry.jsonRule) ? { ...entry.jsonRule } as AgentAutomation['jsonRule'] : null,
        followRedirects: entry.followRedirects !== false,
        userAgent: typeof entry.userAgent === 'string' ? entry.userAgent : null,
        expectedDown: entry.expectedDown === true,
        upsideDown: entry.upsideDown === true,
        timeoutSeconds: typeof entry.timeoutSeconds === 'number' ? entry.timeoutSeconds : 5,
        retryCount: typeof entry.retryCount === 'number' ? entry.retryCount : 4,
        organizationId: typeof entry.organizationId === 'string' ? entry.organizationId : null,
        notificationDestinations: Array.isArray(entry.notificationDestinations) ? entry.notificationDestinations.filter((item): item is string => typeof item === 'string') : typeof entry.modelName === 'string' && entry.modelName ? [entry.modelName] : [],
        notifyWarnings: entry.notifyWarnings === true,
        scheduleKind: stringValue(entry.scheduleKind) === 'once' ? 'once' : 'interval',
        intervalMinutes: typeof entry.intervalMinutes === 'number' ? entry.intervalMinutes : null,
        runAt: stringValue(entry.runAt) || null,
        status: stringValue(entry.status) === 'paused' ? 'paused' : stringValue(entry.status) === 'archived' ? 'archived' : 'active',
        // Preserve the server action; unsupported actions stay read-only in the editor.
        actionType: stringValue(entry.actionType) as AgentAutomation['actionType'],
        timezone: stringValue(entry.timezone) || 'UTC',
        modelName: stringValue(entry.modelName) || null,
        notifyOn: stringValue(entry.notifyOn) === 'always' ? 'always' : stringValue(entry.notifyOn) === 'never' ? 'never' : 'failure',
        nextRunAt: stringValue(entry.nextRunAt) || null,
        lastRunAt: stringValue(entry.lastRunAt) || null,
        lastCompletedAt: stringValue(entry.lastCompletedAt) || null,
        lastStatus: stringValue(entry.lastStatus) || null,
        lastResult: stringValue(entry.lastResult) || null,
        lastError: stringValue(entry.lastError) || null,
        consecutiveFailures: Number(entry.consecutiveFailures) || 0,
        pausedReason: stringValue(entry.pausedReason) || null,
        runCount: Number(entry.runCount) || 0,
        createdAt: stringValue(entry.createdAt),
        updatedAt: stringValue(entry.updatedAt),
    }
}


export const defaultJsonRule: AutomationJsonRule = { path: '', operator: 'gt', value: 80, aggregate: 'max' }
export const automationActions = ['agent_prompt', 'echo', 'mail_health_check', 'system_alert', 'organization_report'] as const
export const monitoringTypes = ['fetch', 'post', 'tcp', 'ssh', 'json', 'push'] as const
export function automationInitialTab(section: 'health' | 'cron') { return section === 'health' ? 'personal' as const : 'cron' as const }
export function automationSelection(items: ReadonlyArray<Pick<AgentAutomation, 'id'>>, selectedId: string, exact = false, selectFirst = true) {
    if (items.some(item => item.id === selectedId)) return { id: selectedId, missing: false }
    if (exact && selectedId) return { id: selectedId, missing: true }
    return { id: selectFirst ? items[0]?.id || '' : '', missing: false }
}
export const automationReadCurrent = (active: boolean, request: number, sequence: number) => active && request === sequence
export function automationEditError(draft: AgentAutomationPayload) {
    if (!(automationActions as readonly string[]).includes(draft.actionType)) return 'This action type is not supported by this editor. Its settings have been preserved.'
    if (draft.monitoringType && !(monitoringTypes as readonly string[]).includes(draft.monitoringType)) return 'This monitoring type is not supported by this editor. Its settings have been preserved.'
    return ''
}
export function newAutomationDraft(section: 'health' | 'cron', timezone = 'UTC'): AgentAutomationPayload {
    return {
        name: section === 'health' ? 'Website health check' : 'Scheduled reminder',
        prompt: section === 'health' ? 'Monitor the service for availability and response errors.' : '',
        targetUrl: '', monitoringType: 'fetch', jsonRule: null, followRedirects: true,
        userAgent: '', expectedDown: false, upsideDown: false, timeoutSeconds: 5, retryCount: 4,
        scheduleKind: 'interval', intervalMinutes: 15, runAt: null, status: 'active',
        actionType: section === 'health' ? 'agent_prompt' : 'system_alert', organizationId: null,
        timezone, modelName: null, notificationDestinations: [], notifyOn: section === 'health' ? 'failure' : 'always', notifyWarnings: false,
    }
}
export function toAutomationDraft(automation: AgentAutomation): AgentAutomationPayload {
    return {
        name: automation.name, prompt: automation.prompt, targetUrl: automation.targetUrl,
        monitoringType: automation.monitoringType, jsonRule: automation.jsonRule ? { ...automation.jsonRule } : null,
        followRedirects: automation.followRedirects, userAgent: automation.userAgent,
        expectedDown: automation.expectedDown, upsideDown: automation.upsideDown,
        timeoutSeconds: automation.timeoutSeconds, retryCount: automation.retryCount,
        scheduleKind: automation.scheduleKind, intervalMinutes: automation.intervalMinutes,
        runAt: automation.runAt, status: automation.status === 'paused' ? 'paused' : 'active',
        actionType: automation.actionType, organizationId: automation.organizationId,
        timezone: automation.timezone, modelName: automation.modelName,
        notificationDestinations: [...automation.notificationDestinations], notifyOn: automation.notifyOn, notifyWarnings: automation.notifyWarnings,
    }
}
function monitoringUrl(value: string) { return value && !/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? `https://${value}` : value }
export function validateAutomationDraft(draft: AgentAutomationPayload, selected?: AgentAutomation | null, canManageSystem = false): string {
    const unsupported = automationEditError(draft)
    if (unsupported) return unsupported
    if (!draft.name.trim()) return 'Name is required.'
    if (!draft.prompt.trim()) return 'Description is required.'
    if (!canManageSystem && (draft.actionType === 'mail_health_check' || draft.targetUrl?.startsWith('system:'))) return 'System monitoring requires Hanasand organization editor access.'
    const type = draft.monitoringType || 'fetch'
    if (selected && (selected.monitoringType === 'push' || type === 'push') && (selected.monitoringType !== type || selected.targetUrl !== draft.targetUrl)) return 'Create a separate check when changing an external source or check type.'
    if (draft.actionType === 'agent_prompt') {
        const target = (draft.targetUrl || '').trim()
        if (!target) return type === 'push' ? 'A source ID is required.' : 'A monitoring target is required.'
        if (type === 'push') {
            if (!/^[\w./:-]{1,128}$/.test(target) || target.startsWith('system:')) return 'Enter a source ID using letters, numbers, dots, slashes, colons, hyphens or underscores.'
            if (draft.scheduleKind !== 'interval' || draft.intervalMinutes !== 1 || draft.expectedDown || draft.upsideDown) return 'External checks require a one-minute schedule without inverted conditions.'
        } else if (type === 'tcp' || type === 'ssh') {
            if (!/^[^:/\s]+(?::\d+)?$/.test(target)) return 'Enter a host with an optional port.'
        } else if (!(type === 'json' && target.startsWith('system:'))) {
            try { if (!['http:', 'https:'].includes(new URL(monitoringUrl(target)).protocol)) throw new Error() } catch { return 'Enter a valid HTTP or HTTPS target.' }
        }
        if (type === 'json') {
            const rule = draft.jsonRule || defaultJsonRule
            if (!/^[\w*-]+(?:\.[\w*-]+)*$/.test(rule.path)) return 'Enter a dot-separated JSON field.'
            if (!['gt', 'gte', 'lt', 'lte', 'eq', 'ne'].includes(rule.operator) || !['max', 'min', 'avg', 'first'].includes(rule.aggregate)) return 'Choose a supported JSON comparison.'
            if (!['eq', 'ne'].includes(rule.operator) && (typeof rule.value !== 'number' || !Number.isFinite(rule.value))) return 'This comparison needs a number.'
        }
        if (!Number.isInteger(draft.timeoutSeconds) || Number(draft.timeoutSeconds) < 1 || Number(draft.timeoutSeconds) > (type === 'push' ? 86400 : 120)) return `Enter a timeout between 1 and ${type === 'push' ? '86400' : '120'} seconds.`
        if (!Number.isInteger(draft.retryCount) || Number(draft.retryCount) < 0 || Number(draft.retryCount) > 5) return 'Enter between 0 and 5 retries.'
    } else if (type === 'push') return 'External events require a monitoring check.'
    if (draft.scheduleKind === 'interval' && (!draft.intervalMinutes || draft.intervalMinutes < 1 || draft.intervalMinutes > 43200)) return 'Choose an interval between 1 and 43200 minutes.'
    if (draft.scheduleKind === 'once' && (!draft.runAt || !Number.isFinite(Date.parse(draft.runAt)) || Date.parse(draft.runAt) <= Date.now())) return 'Choose a future run time.'
    if (draft.actionType === 'organization_report' && !draft.organizationId) return 'Organization reports need an organization scope.'
    if (draft.status === 'active' && !draft.modelName?.trim() && (draft.actionType === 'system_alert' || draft.actionType === 'organization_report' || draft.actionType === 'mail_health_check' && draft.notifyOn !== 'never')) return 'Add a notification destination before activation.'
    try { new Intl.DateTimeFormat(undefined, { timeZone: draft.timezone || 'UTC' }) } catch { return 'Enter a valid timezone.' }
    return ''
}
export function automationSavePayload(draft: AgentAutomationPayload): AgentAutomationPayload {
    const type = draft.monitoringType || 'fetch'
    return { ...draft, targetUrl: draft.targetUrl && !['tcp', 'ssh', 'push'].includes(type) && !draft.targetUrl.startsWith('system:') ? monitoringUrl(draft.targetUrl.trim()) : draft.targetUrl, jsonRule: draft.jsonRule ? { ...draft.jsonRule } : null, notificationDestinations: draft.notificationDestinations ? [...draft.notificationDestinations] : [] }
}
