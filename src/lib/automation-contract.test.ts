import { describe, expect, it } from 'bun:test'
import { automationEditError, automationInitialTab, automationReadCurrent, automationSelection, automationSavePayload, newAutomationDraft, normalizeAutomation, toAutomationDraft, validateAutomationDraft } from './automation-contract'
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


describe('exact health-check deep links', () => {
    it('keeps a missing requested target unavailable and retains ordinary no-ID selection', () => {
        const items = [{ id: 'check-A' }, { id: 'check-B' }]
        expect(automationSelection(items, 'check-B', true)).toEqual({ id: 'check-B', missing: false })
        expect(automationSelection(items, 'missing-check', true)).toEqual({ id: 'missing-check', missing: true })
        expect(automationSelection([], 'missing-check', true)).toEqual({ id: 'missing-check', missing: true })
        expect(automationSelection(items, '', false)).toEqual({ id: 'check-A', missing: false })
        expect(automationSelection(items, '', false, false)).toEqual({ id: '', missing: false })
        expect(automationSelection(items, 'old-selection', false)).toEqual({ id: 'check-A', missing: false })
        expect(automationSelection(items, 'check-B', false)).toEqual({ id: 'check-B', missing: false })
    })
    it('one shared read ticket rejects old overview/detail/finally after a newer selection', async () => {
        for (const boundary of ['overview', 'detail']) {
            let sequence = 0, fetchedDetails = 0
            const state = { selected: '', busy: '' }
            const active = true
            let releaseOverview: () => void = () => {}, releaseOldDetail: () => void = () => {}, releaseNewDetail: () => void = () => {}
            const overview = boundary === 'overview' ? new Promise<void>(resolve => { releaseOverview = resolve }) : Promise.resolve()
            const oldDetail = new Promise<void>(resolve => { releaseOldDetail = resolve })
            const newDetail = new Promise<void>(resolve => { releaseNewDetail = resolve })
            const loadRequest = ++sequence; state.busy = 'load'
            const loading = (async () => {
                try {
                    await overview
                    if (!automationReadCurrent(active, loadRequest, sequence)) return
                    state.selected = automationSelection([{ id: 'check-A' }], 'check-A', true).id
                    fetchedDetails++
                    await oldDetail
                    if (!automationReadCurrent(active, loadRequest, sequence)) return
                    state.selected = 'check-A-detail'
                } finally { if (automationReadCurrent(active, loadRequest, sequence)) state.busy = '' }
            })()
            await Promise.resolve()
            const selectRequest = ++sequence; state.selected = 'check-B'; state.busy = 'select-B'
            const selecting = (async () => {
                try { await newDetail; if (automationReadCurrent(active, selectRequest, sequence)) state.selected = 'check-B-detail' }
                finally { if (automationReadCurrent(active, selectRequest, sequence)) state.busy = '' }
            })()
            releaseOverview(); releaseOldDetail(); await loading
            expect(state.selected).toBe('check-B')
            expect(state.busy).toBe('select-B')
            expect(fetchedDetails).toBe(boundary === 'overview' ? 0 : 1)
            releaseNewDetail(); await selecting
            expect(state.selected).toBe('check-B-detail'); expect(state.busy).toBe('')
            expect(automationReadCurrent(false, selectRequest, sequence)).toBe(false)
            expect(automationReadCurrent(true, selectRequest, ++sequence)).toBe(false)
        }
    })
    it('the actual screen binds exact selection, JSON remount identity and both shared-ticket finally guards', async () => {
        const source = await Bun.file(new URL('../screens/AutomationsScreen.tsx', import.meta.url)).text()
        expect(source).toContain('key={JSON.stringify([workspaceAccountKey(settings), settings.authToken, settings.impersonationToken, section, initialAutomationId || \'\'])}')
        expect(source).toContain('[selectedId, setSelectedId] = useState(initialAutomationId || \'\')')
        expect(source.indexOf('{showEditor && <GlassCard')).toBeLessThan(source.indexOf('<View style={styles.automationList}>'))
        expect(source).toContain('automationSelection(next, selectId, !!initialAutomationId, !!selectId || !!initialAutomationId)')
        expect(source).toContain('initialAutomationId && (!details.automation || details.automation.id !== nextSelected)')
        expect(source).toContain('if (initialAutomationId) setShowEditor(true)')
        const selectedEditor = source.slice(source.indexOf('{showEditor && <GlassCard'), source.indexOf('<View style={styles.automationList}>'))
        expect(selectedEditor.indexOf('<Text style={styles.sectionTitle}>{selected ? \'Edit automation\' : \'New automation\'}</Text>')).toBeLessThan(selectedEditor.indexOf('{runHistoryCard}'))
        expect(selectedEditor.indexOf('{runHistoryCard}')).toBeLessThan(selectedEditor.indexOf('label=\'Name\''))
        expect(source).not.toContain('automation.id === selectedId && runHistoryCard')
        expect(source).toContain('runHistoryLoading ? \'Loading run history…\' : \'No runs recorded yet.\'')
        expect(source).not.toContain('!runs.length && !runsError && (!initialAutomationId || showEditor)')
        const load = source.slice(source.indexOf('async function load('), source.indexOf('async function selectAutomation('))
        expect(load).toContain('const request = ++detailsSequence.current')
        expect(load.split('automationReadCurrent(active.current, request, detailsSequence.current)').length - 1).toBe(4)
        const select = source.slice(source.indexOf('async function selectAutomation('), source.indexOf('async function save('))
        expect(select).toContain('if (automationReadCurrent(active.current, request, detailsSequence.current)) setBusy(\'\')')
    })
})
