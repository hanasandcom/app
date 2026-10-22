import { describe, expect, it } from 'bun:test'
import { automationEditError, automationInitialTab, automationSavePayload, newAutomationDraft, normalizeAutomation, toAutomationDraft, validateAutomationDraft } from './automation-contract'
const existing = (actionType = 'agent_prompt', extra: Record<string, unknown> = {}) => ({
    id: 'synthetic-check', name: 'Synthetic health', prompt: 'Read-only synthetic check.', actionType,
    targetUrl: 'https://example.test/health', monitoringType: 'json', jsonRule: { path: 'checks.*.healthy', operator: 'eq' as const, value: true, aggregate: 'first' as const },
    followRedirects: false, userAgent: 'Synthetic monitor', expectedDown: true, upsideDown: true,
    timeoutSeconds: 17, retryCount: 0, organizationId: 'synthetic-org', notificationDestinations: ['https://discord.com/api/webhooks/synthetic/one', 'https://discord.com/api/webhooks/synthetic/two'], modelName: 'https://discord.com/api/webhooks/synthetic/one',
    notifyWarnings: true, scheduleKind: 'interval', intervalMinutes: 37, runAt: null, timezone: 'Europe/Oslo', status: 'paused', notifyOn: 'always', ...extra,
})

describe('health check editing contracts', () => {
    it('preserves every existing action and full monitoring, notification and organization settings', () => {
        for (const action of ['agent_prompt', 'echo', 'mail_health_check', 'system_alert', 'organization_report']) {
            const raw = existing(action)
            const automation = normalizeAutomation(raw)!
            const draft = toAutomationDraft(automation)
            const payload = automationSavePayload({ ...draft, name: 'Renamed only' })
            for (const field of ['actionType', 'targetUrl', 'monitoringType', 'jsonRule', 'followRedirects', 'userAgent', 'expectedDown', 'upsideDown', 'timeoutSeconds', 'retryCount', 'organizationId', 'notificationDestinations', 'notifyWarnings', 'scheduleKind', 'intervalMinutes', 'runAt', 'timezone', 'status', 'modelName', 'notifyOn'] as const) expect(payload[field]).toEqual(raw[field])
            expect(payload.name).toBe('Renamed only')
            expect(payload).not.toHaveProperty('id')
            expect(draft.notificationDestinations).not.toBe(automation.notificationDestinations)
            expect(draft.jsonRule).not.toBe(automation.jsonRule)
        }
    })
    it('preserves unsupported server actions without coercion and blocks editing', () => {
        const automation = normalizeAutomation(existing('future_action'))!
        expect(automation.actionType as string).toBe('future_action')
        expect(automationEditError(toAutomationDraft(automation))).toContain('not supported')
        const futureType = normalizeAutomation(existing('agent_prompt', { monitoringType: 'future_check' }))!
        expect(futureType.monitoringType as string).toBe('future_check')
        expect(validateAutomationDraft(toAutomationDraft(futureType), futureType, true)).toContain('not supported')
    })
    it('preserves empty destinations independently of modelName and never changes zero retries or false options', () => {
        const item = normalizeAutomation(existing('system_alert', { notificationDestinations: [], expectedDown: false, upsideDown: false, notifyWarnings: false, retryCount: 0 }))!
        expect(toAutomationDraft(item)).toMatchObject({ notificationDestinations: [], expectedDown: false, upsideDown: false, notifyWarnings: false, retryCount: 0 })
        const legacy = existing('system_alert'); delete (legacy as Record<string, unknown>).notificationDestinations
        expect(normalizeAutomation(legacy)?.notificationDestinations).toEqual([legacy.modelName])
    })
    it('opens Health Checks directly and uses the website health/reminder creation defaults', () => {
        expect(automationInitialTab('health')).toBe('personal')
        expect(automationInitialTab('cron')).toBe('cron')
        expect(newAutomationDraft('health', 'UTC')).toMatchObject({ actionType: 'agent_prompt', monitoringType: 'fetch', targetUrl: '', retryCount: 4, timeoutSeconds: 5, notifyOn: 'failure' })
        expect(newAutomationDraft('cron', 'UTC')).toMatchObject({ actionType: 'system_alert', notifyOn: 'always' })
    })
    it('validates targets, JSON rules, bounded timeouts/retries, schedules and destinations without requests', () => {
        const draft = toAutomationDraft(normalizeAutomation(existing())!)
        expect(validateAutomationDraft(draft, null, true)).toBe('')
        expect(validateAutomationDraft({ ...draft, targetUrl: '' }, null, true)).toContain('target')
        expect(validateAutomationDraft({ ...draft, targetUrl: 'javascript:bad' }, null, true)).not.toBe('')
        expect(validateAutomationDraft({ ...draft, monitoringType: 'tcp', targetUrl: 'host:22' }, null, true)).toBe('')
        expect(validateAutomationDraft({ ...draft, monitoringType: 'ssh', targetUrl: 'https://host/path' }, null, true)).toContain('host')
        expect(validateAutomationDraft({ ...draft, jsonRule: { ...draft.jsonRule!, path: '' } }, null, true)).toContain('JSON')
        expect(validateAutomationDraft({ ...draft, timeoutSeconds: 121 }, null, true)).toContain('timeout')
        expect(validateAutomationDraft({ ...draft, retryCount: 6 }, null, true)).toContain('retries')
        expect(validateAutomationDraft({ ...draft, retryCount: 0 }, null, true)).toBe('')
        expect(validateAutomationDraft({ ...draft, intervalMinutes: 43201 }, null, true)).toContain('interval')
        expect(validateAutomationDraft({ ...draft, scheduleKind: 'once', runAt: '2020-01-01' }, null, true)).toContain('future')
        expect(validateAutomationDraft({ ...draft, actionType: 'system_alert', status: 'active', modelName: null }, null, true)).toContain('destination')
        expect(validateAutomationDraft({ ...draft, actionType: 'organization_report', organizationId: null }, null, true)).toContain('organization')
        expect(validateAutomationDraft({ ...draft, actionType: 'mail_health_check' }, null, false)).toContain('editor access')
    })
    it('preserves external event configuration and enforces immutable source and check type', () => {
        const item = normalizeAutomation(existing('agent_prompt', { monitoringType: 'push', targetUrl: 'synthetic/source-1', jsonRule: null, expectedDown: false, upsideDown: false, intervalMinutes: 1, retryCount: 0, timeoutSeconds: 180 }))!
        const draft = toAutomationDraft(item)
        expect(validateAutomationDraft(draft, item, true)).toBe('')
        expect(automationSavePayload(draft).targetUrl).toBe('synthetic/source-1')
        expect(validateAutomationDraft({ ...draft, targetUrl: 'other-source' }, item, true)).toContain('separate check')
        expect(validateAutomationDraft({ ...draft, monitoringType: 'fetch' }, item, true)).toContain('separate check')
    })
})
