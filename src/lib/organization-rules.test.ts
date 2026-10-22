import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { AppSettings } from '../types'

// Run alone: apiFetch is mocked for this entire Bun process.
const calls: Array<{ settings: AppSettings, url: string, init: RequestInit }> = []
let orgRole = 'owner'
let retention = true
let response: ((url: URL, init: RequestInit) => Response) | undefined
const settings = { userId: 'synthetic-owner', authToken: 'synthetic-token', apiBaseUrl: 'https://api.hanasand.com/api', siteBaseUrl: 'https://hanasand.com', selectedOrganizationId: 'org /?', impersonationToken: '', impersonatingUserId: '' } as AppSettings
const custom = { id: 'custom.example.v1', recordId: 'row /?', version: '9', name: 'Example rule', explanation: 'A synthetic rule description.', severity: 'medium', enabled: true, source: 'owned', definition: { stage: 'match', action: 'keep', match: 'all', conditions: [{ path: 'event_type', operator: 'equals' as const, value: 'login', caseSensitive: false }], extraPreservedByServer: { value: true } } }
const builtin = { ...custom, id: 'auth.brute_force_success.v1', source: 'hanasand', definition: { stage: 'detect', conditions: [], parameters: { windowMinutes: 15, minimumCount: 3 }, failureConditions: [{ path: 'outcome', operator: 'equals', value: 'failure', caseSensitive: true }], protection: { requiredEvidence: ['unknown-key'] }, unknownFutureField: { nested: [1, 2] } } }
mock.module('./api', () => ({ apiFetch: async (scope: AppSettings, input: string, init: RequestInit = {}) => {
    calls.push({ settings: scope, url: input, init })
    const url = new URL(input)
    if (response) return response(url, init)
    if (url.pathname.endsWith('/organizations')) return Response.json({ organizations: [{ id: settings.selectedOrganizationId, name: 'Synthetic organization', role: orgRole, lifecycleStatus: 'active' }] })
    if (url.pathname.endsWith('/rules')) return Response.json({ organizationId: settings.selectedOrganizationId, rules: [custom], canManageRetention: retention })
    return Response.json({ organizationId: settings.selectedOrganizationId, canEdit: true, isHistorical: false, rule: custom, audit: [], nextOffset: null })
} }))
const api = await import('./organization-rules')
const signal = () => new AbortController().signal
beforeEach(() => { calls.length = 0; orgRole = 'owner'; retention = true; response = undefined })
const context = () => api.loadOrganizationRules(settings, 'match', signal())
async function detail() { const scope = await context(); return { scope, current: await api.loadOrganizationRule(settings, scope, custom.id, signal()) } }
const draft = () => ({ name: custom.name, explanation: custom.explanation, severity: custom.severity, enabled: custom.enabled, definition: structuredClone(custom.definition) })
const payload = () => JSON.parse(String(calls[calls.length - 1].init.body))

describe('organization rule transport and permissions', () => {
    it('uses actual categorized list/full detail routes, query organization plus selected-account managed transport, without cookies', async () => {
        const { scope, current } = await detail()
        expect(scope.organization.role).toBe('owner')
        expect(scope.canManage).toBe(true)
        expect(current.rule.version).toBe('9')
        const list = calls.find(call => new URL(call.url).pathname.endsWith('/rules'))!
        const url = new URL(list.url)
        expect(url.searchParams.get('organizationId')).toBe(settings.selectedOrganizationId!)
        expect(url.searchParams.get('view')).toBe('list')
        expect(url.searchParams.get('category')).toBe('match')
        expect(new URL(calls[2].url).pathname).toBe('/api/rules/custom.example')
        expect(calls.every(call => call.settings === settings)).toBe(true)
        expect(list.init.credentials).toBe('omit')
        expect(list.init.cache).toBe('no-store')
        expect(new Headers(list.init.headers).get('Cookie')).toBeNull()
    })
    it('blocks personal, absent session, wrong account, changed token/org, impersonation and reader writes before mutation', async () => {
        for (const bad of [{ ...settings, selectedOrganizationId: 'personal' }, { ...settings, selectedOrganizationId: '' }, { ...settings, authToken: '' }]) await expect(api.loadOrganizationRules(bad, 'match', signal())).rejects.toThrow()
        expect(calls).toHaveLength(0)
        const scope = await context(); calls.length = 0
        for (const changed of [{ ...settings, selectedOrganizationId: 'other-org' }, { ...settings, userId: 'other-user' }, { ...settings, authToken: 'other-token' }, { ...settings, impersonationToken: 'partial-impersonation' }, { ...settings, impersonatingUserId: 'other-user' }]) await expect(api.createOrganizationRule(changed, scope, draft())).rejects.toThrow()
        await expect(api.createOrganizationRule(settings, { ...scope, canManage: false }, draft())).rejects.toThrow('owner, admin, or editor')
        expect(calls).toHaveLength(0)
    })
    it('only grants organization owner/admin/editor controls, never infers them from retention flags', async () => {
        for (const role of ['owner', 'admin', 'editor', 'reader', 'viewer', 'member']) {
            orgRole = role
            expect((await context()).canManage).toBe(['owner', 'admin', 'editor'].includes(role))
        }
    })
    it('requires matching response organization and complete full definition/current version before editing', async () => {
        const scope = await context()
        response = () => Response.json({ organizationId: 'other-org', rule: custom, canEdit: true, isHistorical: false })
        await expect(api.loadOrganizationRule(settings, scope, custom.id, signal())).rejects.toThrow('access could not be verified')
        for (const incomplete of [{ ...custom, version: undefined }, { ...custom, definition: undefined }]) {
            response = () => Response.json({ organizationId: settings.selectedOrganizationId, rule: incomplete, canEdit: true, isHistorical: false })
            await expect(api.loadOrganizationRule(settings, scope, custom.id, signal())).rejects.toThrow('incomplete rule')
        }
    })
    it('fails closed for server canEdit false, historical details, and retention access', async () => {
        const { scope, current } = await detail(); calls.length = 0
        for (const blocked of [{ ...current, canEdit: false }, { ...current, isHistorical: true }, { ...current, scope: 'other-scope' }]) await expect(api.updateOrganizationRule(settings, scope, blocked, draft())).rejects.toThrow()
        const retentionDraft = { ...draft(), definition: { ...custom.definition, stage: 'analyze', action: 'drop' } }
        await expect(api.createOrganizationRule(settings, { ...scope, canManageRetention: false }, retentionDraft)).rejects.toThrow('log retention')
        expect(calls).toHaveLength(0)
    })
})

describe('rule editing preserves server semantics', () => {
    it('creates only on explicit call with actual conditions/stage/action payload and defaults enabled on server', async () => {
        const scope = await context(); calls.length = 0
        response = () => Response.json({ rule: custom }, { status: 201 })
        expect(calls).toHaveLength(0)
        await api.createOrganizationRule(settings, scope, draft())
        expect(calls).toHaveLength(1)
        expect(calls[0].init.method).toBe('POST')
        expect(payload()).toEqual({ name: custom.name, explanation: custom.explanation, severity: 'medium', stage: 'match', action: 'keep', match: 'all', conditions: custom.definition.conditions })
        expect(payload().definition).toBeUndefined()
        expect(payload().organizationId).toBeUndefined()
    })
    it('sends exact current version with full custom conditions/case/action/storeScope and keeps stage immutable', async () => {
        const { scope, current } = await detail()
        const retentionRule = { ...current, rule: { ...custom, definition: { ...custom.definition, stage: 'analyze', action: 'keep', storeScope: 'custom_drop' } } }
        const value = { ...draft(), name: 'Renamed rule', definition: structuredClone(retentionRule.rule.definition) }
        response = () => Response.json({ rule: { ...retentionRule.rule, name: value.name, version: '10' } })
        await api.updateOrganizationRule(settings, scope, retentionRule, value)
        expect(calls[calls.length - 1].init.method).toBe('PUT')
        expect(payload()).toEqual({ name: 'Renamed rule', explanation: custom.explanation, severity: 'medium', enabled: true, version: '9', conditions: custom.definition.conditions, action: 'keep', storeScope: 'custom_drop' })
        expect(value.definition.extraPreservedByServer).toEqual({ value: true })
        await expect(api.updateOrganizationRule(settings, scope, current, { ...draft(), definition: { ...custom.definition, stage: 'detect' } })).rejects.toThrow('stage cannot be changed')
    })
    it('preserves every built-in definition key on metadata edits, including unknown future keys/protection/failure selectors', async () => {
        const { scope, current } = await detail()
        const full = { ...current, rule: builtin }
        const value = { ...draft(), name: 'Updated metadata', definition: structuredClone(builtin.definition) }
        const result = api.organizationRuleUpdatePayload(settings, scope, full, value)
        expect(result).toMatchObject({ version: '9', enabled: true, definition: builtin.definition })
        expect(JSON.stringify(result)).toContain('unknownFutureField')
        expect('conditions' in result).toBe(false)
        expect(value.definition).toEqual(builtin.definition)
    })
    it('uses only existing enable/disable action endpoint with record ID; never sends DELETE or rule execution', async () => {
        const { scope, current } = await detail(); calls.length = 0
        response = () => Response.json({ rule: { ...custom, enabled: false, version: '10' } })
        await api.setOrganizationRuleEnabled(settings, scope, current, false)
        expect(new URL(calls[0].url).pathname).toBe('/api/rules/row%20%2F%3F/actions')
        expect(calls[0].init.method).toBe('POST')
        expect(payload()).toEqual({ action: 'disable' })
        expect(calls.some(call => call.init.method === 'DELETE' || call.url.includes('reprocess'))).toBe(false)
    })
    it('validates bounded condition syntax and rejects destructive action outside Analyze before network', async () => {
        const scope = await context(); calls.length = 0
        for (const conditions of [[], Array(9).fill(custom.definition.conditions[0]), [{ path: 'bad path', operator: 'equals', value: 'x' }], [{ path: 'event_type', operator: 'regex', value: '[' }], [{ path: 'event_type', operator: 'equals', value: 'x', caseSensitive: 'yes' }]]) expect(() => api.validateRuleConditions(conditions)).toThrow()
        await expect(api.createOrganizationRule(settings, scope, { ...draft(), definition: { ...custom.definition, action: 'drop' } })).rejects.toThrow('Only Analyze')
        expect(calls).toHaveLength(0)
    })
    it('reports409 without mutating the draft/version and never retries a failed write', async () => {
        const { scope, current } = await detail(); calls.length = 0
        response = () => Response.json({ error: 'Version mismatch' }, { status: 409 })
        const value = draft(), before = JSON.stringify(value)
        await expect(api.updateOrganizationRule(settings, scope, current, value)).rejects.toThrow('Your draft is kept')
        expect(calls).toHaveLength(1)
        expect(JSON.stringify(value)).toBe(before)
        expect(current.rule.version).toBe('9')
    })
    it('does not acknowledge a wrong rule or wrong enabled state and reports auth/busy errors', async () => {
        const { scope, current } = await detail()
        response = () => Response.json({ rule: { ...custom, id: 'other-rule.v1' } })
        await expect(api.updateOrganizationRule(settings, scope, current, draft())).rejects.toThrow('could not be confirmed')
        response = () => Response.json({ rule: custom })
        await expect(api.setOrganizationRuleEnabled(settings, scope, current, false)).rejects.toThrow('could not be confirmed')
        for (const status of [401, 403, 503]) {
            response = () => Response.json({ error: 'synthetic error' }, { status })
            try { await api.updateOrganizationRule(settings, scope, current, draft()); throw new Error('Unexpected success') }
            catch (cause) { expect(cause).toBeInstanceOf(api.RuleRequestError); expect((cause as InstanceType<typeof api.RuleRequestError>).status).toBe(status) }
        }
    })
})

describe('explicit read-only preview', () => {
    it('uses a frozen range, server cursor, one manual request per call, and never executes/reprocesses events', async () => {
        const scope = await context(); calls.length = 0
        const cursor = { time: '2026-10-22T11:00:00Z', id: 'opaque-event' }
        response = () => Response.json({ count: 3, scanned: 1000, events: [{ id: 'event', timestamp: '2026-10-22T12:00:00Z', normalized: { event_type: 'login' } }], cursor })
        const window = api.rulePreviewWindow(24, Date.parse('2026-10-23T00:00:00Z'))
        expect(window).toEqual({ from: '2026-10-22T00:00:00.000Z', until: '2026-10-23T00:00:00.000Z' })
        const first = await api.previewOrganizationRule(settings, scope, custom.definition, window, null, signal())
        expect(first.cursor).toEqual(cursor)
        expect(calls).toHaveLength(1)
        expect(payload()).toEqual({ ...window, conditions: custom.definition.conditions, action: 'keep', cursor: null, sample: true, limit: 1000, storedLogsOnly: false })
        await api.previewOrganizationRule(settings, scope, custom.definition, window, first.cursor, signal())
        expect(calls).toHaveLength(2)
        expect(payload().cursor).toEqual(cursor)
        expect(calls.every(call => new URL(call.url).pathname === '/api/rules/preview')).toBe(true)
    })
    it('rejects invalid preview windows, stale account scope, malformed responses and aborted results', async () => {
        const scope = await context(); calls.length = 0
        const window = api.rulePreviewWindow(1)
        await expect(api.previewOrganizationRule(settings, scope, custom.definition, { from: 'invalid', until: 'invalid' }, null, signal())).rejects.toThrow('valid preview')
        await expect(api.previewOrganizationRule({ ...settings, userId: 'other' }, scope, custom.definition, window, null, signal())).rejects.toThrow('changed')
        expect(calls).toHaveLength(0)
        response = () => Response.json({ count: 0, scanned: 0, events: [], cursor: { wrong: 'cursor' } })
        await expect(api.previewOrganizationRule(settings, scope, custom.definition, window, null, signal())).rejects.toThrow('unexpected response')
        response = () => Response.json({ count: 0, scanned: 0, events: [], cursor: null })
        const controller = new AbortController(); controller.abort()
        await expect(api.previewOrganizationRule(settings, scope, custom.definition, window, null, controller.signal)).rejects.toThrow('cancelled')
    })
})
