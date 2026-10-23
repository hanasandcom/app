import { beforeEach, expect, mock, test } from 'bun:test'
import type { AppSettings } from '../types'
const calls: { url: URL; init: RequestInit; settings: AppSettings }[] = []
let handle: (url: URL, init: RequestInit) => Response | Promise<Response>
mock.module('./api', () => ({ apiFetch: async (settings: AppSettings, input: string, init: RequestInit) => {
    const url = new URL(input); calls.push({ url, init, settings }); return handle(url, init)
} }))
const { loadDeliveryHistory, performDeliveryAction, deliveryCaseRef, deliveryHistorySelection, deliveryRetryTarget, deliveryHistoryScope, filterDeliveryAlerts, selectedDeliveryAttempts, DeliveryHistoryError } = await import('./delivery-history')
const settings = { apiBaseUrl: 'https://api.synthetic.invalid/api', userId: 'user', authToken: 'synthetic-token', selectedOrganizationId: 'org', impersonationToken: '', impersonatingUserId: '' } as AppSettings
const sourceAlert = (change = {}) => ({ id: 'alert', organizationId: 'org', tenantId: 'org', company: 'Example', actor: 'Actor', matchedTerm: { value: 'example.test' }, reviewState: 'new', deliveryState: 'pending', evidence: [{ id: 'capture', provenance: { retained: true } }], workflowContext: { caseId: 'case', organizationId: 'org' }, ...change })
const receipt = (change = {}) => ({ id: 'attempt', alertId: 'alert', orgId: 'org', status: 'failed', attemptedAt: '2026-10-23T02:00:00Z', dryRun: false, responseStatus: 503, auditEventId: 'audit', idempotencyKey: 'dedup', error: 'Service unavailable', ...change })
const history = (change = {}) => ({ deliveries: [receipt()], visibility: { allowed: true }, deliveryReadinessConsumer: { access: { canRetry: true }, liveDeliveryEnabled: true }, deliveryRetryRequest: { access: { canRetry: true }, entries: [{ orgId: 'org', alertId: 'alert', deliveryId: 'attempt', liveRequest: { canSend: true, externalSendEnabled: true, blockers: [] } }] }, ...change })
const destinations = (manage = true) => ({ destinations: [{ id: 'dest', orgId: 'org', name: 'Alerts', kind: 'webhook', status: 'active' }], destinationAdminProof: { access: { canManage: manage } }, destinationLifecycle: [], destinationTests: [] })
function defaults(url: URL) {
    if (url.pathname.includes('/organizations/')) return Response.json({ organization: { id: 'org', lifecycleStatus: 'active', privacyDeletionInProgress: false } })
    if (url.pathname.endsWith('/webhook-destinations')) return Response.json(destinations())
    if (url.pathname.endsWith('/findings/alerts')) return Response.json({ alerts: [sourceAlert()] })
    return Response.json(history())
}
beforeEach(() => { calls.length = 0; handle = url => defaults(url) })
test('reads actual canonical history and finite alert route with selected organization and authenticated transport', async () => {
    const page = await loadDeliveryHistory(settings)
    expect(page).toMatchObject({ organizationId: 'org', canTest: true, canSend: true })
    expect(page.attempts[0]).toMatchObject({ canRetry: true, httpStatus: 503, dedupeKey: 'dedup' })
    expect(deliveryCaseRef(page, 'alert')).toEqual({ caseId: 'case', alertId: 'alert', organizationId: 'org' })
    expect(calls.find(call => call.url.pathname.endsWith('/findings/alerts'))?.url.searchParams.toString()).toBe('tenantId=org&organizationId=org')
    for (const call of calls) { expect(call.init.credentials).toBe('omit'); expect(call.init.redirect).toBe('error'); expect(call.settings).toBe(settings) }
    expect(new Headers(calls[0].init.headers).get('authorization')).toBe('Bearer synthetic-token')
})
test('managed Core routes keep browser alert origin canonical', async () => {
    await loadDeliveryHistory({ ...settings, apiBaseUrl: 'https://api.hanasand.com/api' })
    expect(calls.find(call => call.url.pathname.endsWith('/findings/alerts'))?.url.origin).toBe('https://hanasand.com')
    expect(calls.find(call => call.url.pathname.endsWith('/webhook-deliveries'))?.url.origin).toBe('https://api.hanasand.com')
})
test('Test and Send retain complete authoritative alert and use actual dry-run/live flags once', async () => {
    const page = await loadDeliveryHistory(settings)
    handle = (_, init) => Response.json({ deliveries: [receipt({ status: 'dry_run', dryRun: JSON.parse(String(init.body)).dryRun, error: null })] }, { status: 202 })
    for (const action of ['test', 'send'] as const) {
        calls.length = 0
        const result = await performDeliveryAction(settings, page, action, 'alert')
        expect(result.uncertain).toBe(false); expect(calls).toHaveLength(1)
        const payload = JSON.parse(String(calls[0].init.body))
        expect(payload).toEqual({ orgId: 'org', organizationId: 'org', tenantId: 'org', alertId: 'alert', alert: sourceAlert(), dryRun: action === 'test', live: action === 'send' })
    }
})
test('failed502 preserves durable receipts instead of losing result or claiming delivery', async () => {
    const page = await loadDeliveryHistory(settings)
    handle = () => Response.json({ deliveries: [receipt()] }, { status: 502 })
    const result = await performDeliveryAction(settings, page, 'send', 'alert')
    expect(result).toMatchObject({ failed: true, uncertain: false }); expect(result.attempts).toHaveLength(1)
    expect(result.message).toContain('failed')
})
test('skipped and dry-run receipts stay distinct; empty202 outcome is unknown', async () => {
    const page = await loadDeliveryHistory(settings)
    handle = () => Response.json({ deliveries: [receipt({ status: 'skipped', error: null })] }, { status: 202 })
    expect((await performDeliveryAction(settings, page, 'send', 'alert')).message).toContain('skipped')
    handle = () => Response.json({ deliveries: [] }, { status: 202 })
    expect((await performDeliveryAction(settings, page, 'test', 'alert')).uncertain).toBe(true)
})
test('uncertain transport or503 never automatically retries a write', async () => {
    const page = await loadDeliveryHistory(settings)
    for (const failed of [async () => { throw new Error('transport') }, async () => Response.json({}, { status: 503 })]) {
        calls.length = 0; handle = failed
        try { await performDeliveryAction(settings, page, 'send', 'alert'); throw new Error('expected rejection') }
        catch (cause) { expect(cause).toBeInstanceOf(DeliveryHistoryError); expect((cause as InstanceType<typeof DeliveryHistoryError>).uncertain).toBe(true) }
        expect(calls).toHaveLength(1)
    }
})
test('Retry uses persisted deliveryId only and requires exact live retry eligibility', async () => {
    const page = await loadDeliveryHistory(settings)
    calls.length = 0; handle = () => Response.json({ deliveries: [receipt({ id: 'retry-attempt', status: 'delivered', error: null })] }, { status: 202 })
    await performDeliveryAction(settings, page, 'retry', 'alert', 'attempt')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ orgId: 'org', organizationId: 'org', tenantId: 'org', deliveryId: 'attempt' })
    calls.length = 0
    await expect(performDeliveryAction(settings, { ...page, attempts: page.attempts.map(row => ({ ...row, canRetry: false })) }, 'retry', 'alert', 'attempt')).rejects.toThrow('not eligible')
    expect(calls).toHaveLength(0)
})
test('scope, session, both impersonation states, and denied permission cannot write', async () => {
    const page = await loadDeliveryHistory(settings)
    for (const change of [{ selectedOrganizationId: 'other' }, { authToken: 'changed' }, { userId: 'other' }, { apiBaseUrl: 'https://other.invalid/api' }, { impersonationToken: 'imp' }, { impersonatingUserId: 'other' }]) {
        calls.length = 0
        await expect(performDeliveryAction({ ...settings, ...change }, page, 'send', 'alert')).rejects.toThrow()
        expect(calls).toHaveLength(0)
    }
    for (const flags of [{ canTest: false }, { canSend: false }]) {
        await expect(performDeliveryAction(settings, { ...page, ...flags }, flags.canTest === false ? 'test' : 'send', 'alert')).rejects.toThrow()
    }
    expect(deliveryHistoryScope({ ...settings, impersonatingUserId: 'other' })).not.toBe(deliveryHistoryScope(settings))
})
test('Personal, unsafe IDs, mixed source scope and mismatched receipts are rejected', async () => {
    for (const id of ['personal', 'user', '../org', 'org%2Fother', '']) await expect(loadDeliveryHistory({ ...settings, selectedOrganizationId: id })).rejects.toThrow()
    handle = url => url.pathname.endsWith('/findings/alerts') ? Response.json({ alerts: [sourceAlert({ tenantId: 'foreign' })] }) : defaults(url)
    await expect(loadDeliveryHistory(settings)).rejects.toThrow('does not match')
    handle = url => url.pathname.endsWith('/webhook-deliveries') ? Response.json(history({ deliveries: [receipt({ orgId: 'foreign' })] })) : defaults(url)
    await expect(loadDeliveryHistory(settings)).rejects.toThrow('does not match')
})
test('failed findings or lifecycle preserves history but never grants action permissions', async () => {
    for (const suffix of ['/findings/alerts', '/organizations/org', '/webhook-destinations']) {
        handle = url => url.pathname.endsWith(suffix) ? Response.json({}, { status: 503 }) : defaults(url)
        const page = await loadDeliveryHistory(settings)
        expect(page.attempts).toHaveLength(1); expect(page.canTest).toBe(false); expect(page.canSend).toBe(false); expect(page.notice).not.toBe('')
    }
})
test('read visibility and explicit readiness permission are authoritative; live-disabled still permits dry-run', async () => {
    handle = url => url.pathname.endsWith('/webhook-deliveries') ? Response.json(history({ visibility: { allowed: false } })) : defaults(url)
    await expect(loadDeliveryHistory(settings)).rejects.toThrow('not visible')
    handle = url => url.pathname.endsWith('/webhook-deliveries') ? Response.json(history({ deliveryReadinessConsumer: { access: { canRetry: false }, liveDeliveryEnabled: true } })) : defaults(url)
    expect((await loadDeliveryHistory(settings)).canSend).toBe(false)
    handle = url => url.pathname.endsWith('/webhook-deliveries') ? Response.json(history({ deliveryReadinessConsumer: { access: { canRetry: true }, liveDeliveryEnabled: false } })) : defaults(url)
    expect(await loadDeliveryHistory(settings)).toMatchObject({ canTest: true, canSend: false })
})
test('aborted read ignores even successful late transport; native AbortSignal.any not required', async () => {
    const controller = new AbortController()
    handle = async url => { controller.abort(); return defaults(url) }
    await expect(loadDeliveryHistory(settings, controller.signal)).rejects.toThrow()
    expect(calls[0].init.signal?.aborted).toBe(true)
})
test('local filters, selected attempts and exact case linkage preserve website semantics', async () => {
    const page = await loadDeliveryHistory(settings)
    expect(filterDeliveryAlerts(page.alerts, 'ACTOR', true)).toHaveLength(1)
    expect(filterDeliveryAlerts(page.alerts.map(row => ({ ...row, reviewState: 'closed' })), '', true)).toHaveLength(0)
    expect(selectedDeliveryAttempts(page, 'other')).toHaveLength(0)
    expect(deliveryCaseRef(page, 'missing')).toBeUndefined()
})
test('screen contains guarded confirmation, focus/background cancellation and explicit manual reconciliation', async () => {
    const source = await Bun.file(new URL('../screens/DeliveryHistoryScreen.tsx', import.meta.url)).text()
    expect(source).toContain('current === epoch.current && selection.current === selectedAtConfirmation && active.current')
    expect(source).toContain('controller.abort(); write.current?.abort()')
    expect(source).toContain('key={deliveryHistoryScope(props.settings)}')
    expect(source).toContain('review.current = true; setMustRefresh(true)')
    expect(source).toContain('onOpenCase(caseRef)')
    expect(source).toContain('label=\'Open case\'')
    expect(source).not.toContain('setInterval')
})

test('read-only lifecycle states, retry blockers and scope mismatch never enable retries', async () => {
    for (const change of [{ privacyDeletionInProgress: true }, { lifecycleStatus: 'archived' }, { privacyDeletionInProgress: 'false' }]) {
        handle = url => url.pathname.includes('/organizations/') ? Response.json({ organization: { id: 'org', lifecycleStatus: 'active', privacyDeletionInProgress: false, ...change } }) : defaults(url)
        const page = await loadDeliveryHistory(settings)
        expect(page.canTest).toBe(false); expect(page.canSend).toBe(false); expect(page.attempts[0].canRetry).toBe(false)
    }
    for (const entry of [
        { orgId: 'foreign', alertId: 'alert', deliveryId: 'attempt', liveRequest: { canSend: true, externalSendEnabled: true } },
        { orgId: 'org', alertId: 'alert', deliveryId: 'attempt', liveRequest: { canSend: true, externalSendEnabled: true, blockers: [{ blocking: true }] } },
        { orgId: 'org', alertId: 'alert', deliveryId: 'attempt', liveRequest: { canSend: false, externalSendEnabled: false } },
    ]) {
        handle = url => url.pathname.endsWith('/webhook-deliveries') ? Response.json(history({ deliveryRetryRequest: { access: { canRetry: true }, entries: [entry] } })) : defaults(url)
        expect((await loadDeliveryHistory(settings)).attempts[0].canRetry).toBe(false)
    }
})
test('invalid POST receipt scope remains uncertain, and error URLs are redacted', async () => {
    const page = await loadDeliveryHistory(settings)
    handle = () => Response.json({ deliveries: [receipt({ orgId: 'foreign' })] }, { status: 202 })
    try { await performDeliveryAction(settings, page, 'send', 'alert'); throw new Error('expected rejection') }
    catch (cause) { expect((cause as InstanceType<typeof DeliveryHistoryError>).uncertain).toBe(true) }
    handle = () => Response.json({ deliveries: [receipt({ error: 'Failed https://hooks.example/private-secret' })] }, { status: 502 })
    expect((await performDeliveryAction(settings, page, 'send', 'alert')).message).not.toContain('private-secret')
})
test('failed findings still exposes all retained history and manual reconciliation is required after interruption', async () => {
    handle = url => url.pathname.endsWith('/findings/alerts') ? Response.json({}, { status: 503 }) : defaults(url)
    const page = await loadDeliveryHistory(settings)
    expect(selectedDeliveryAttempts(page, '')).toHaveLength(1)
    const source = await Bun.file(new URL('../screens/DeliveryHistoryScreen.tsx', import.meta.url)).text()
    expect(source).toContain('if (allowReconcile.current) { review.current = false; setMustRefresh(false) }')
    expect(source).toContain('saving.current = true; allowReconcile.current = false')
    expect(source).toContain('allowReconcile.current = true')
})

test('pre-cancelled writes never reach transport; altered full-alert identity cannot be submitted', async () => {
    const page = await loadDeliveryHistory(settings)
    const controller = new AbortController(); controller.abort(); calls.length = 0
    await expect(performDeliveryAction(settings, page, 'send', 'alert', undefined, controller.signal)).rejects.toThrow('cancelled')
    expect(calls).toHaveLength(0)
    await expect(performDeliveryAction(settings, { ...page, alerts: page.alerts.map(row => ({ ...row, full: { ...row.full, id: 'other' } })) }, 'send', 'alert')).rejects.toThrow('changed')
    expect(calls).toHaveLength(0)
})

test('persisted receipt retry remains available when Findings is unavailable or no longer lists the alert', async () => {
    for (const unavailable of [true, false]) {
        handle = url => url.pathname.endsWith('/findings/alerts')
            ? Response.json(unavailable ? {} : { alerts: [] }, { status: unavailable ? 503 : 200 }) : defaults(url)
        const page = await loadDeliveryHistory(settings)
        expect(page.alerts).toEqual([])
        expect(page.canRetry).toBe(true)
        expect(deliveryRetryTarget(page, 'attempt')).toEqual({ deliveryId: 'attempt', alertId: 'alert' })
        if (unavailable) expect(page.canSend).toBe(false)
        calls.length = 0
        handle = () => Response.json({ deliveries: [receipt({ id: 'retry-result', status: 'delivered', error: null })] }, { status: 202 })
        const result = await performDeliveryAction(settings, page, 'retry', 'alert', 'attempt')
        expect(result.uncertain).toBe(false)
        expect(calls).toHaveLength(1)
        expect(JSON.parse(String(calls[0].init.body))).toEqual({ orgId: 'org', organizationId: 'org', tenantId: 'org', deliveryId: 'attempt' })
        calls.length = 0
        await expect(performDeliveryAction(settings, page, 'send', 'alert')).rejects.toThrow()
        await expect(performDeliveryAction(settings, page, 'test', 'alert')).rejects.toThrow()
        expect(calls).toHaveLength(0)
    }
})
test('receipt retry still requires global authority and exact org/alert/delivery proof', async () => {
    const loaded = await loadDeliveryHistory(settings)
    const page = { ...loaded, alerts: [], canSend: false, canTest: false }
    for (const changed of [
        { ...page, canRetry: false },
        { ...page, attempts: page.attempts.map(row => ({ ...row, organizationId: 'other' })) },
        { ...page, attempts: page.attempts.map(row => ({ ...row, alertId: 'other' })) },
        { ...page, attempts: page.attempts.map(row => ({ ...row, dryRun: true })) },
        { ...page, attempts: page.attempts.map(row => ({ ...row, status: 'delivered' })) },
        { ...page, attempts: page.attempts.map(row => ({ ...row, canRetry: false })) },
    ]) {
        calls.length = 0
        await expect(performDeliveryAction(settings, changed, 'retry', 'alert', 'attempt')).rejects.toThrow('not eligible')
        expect(calls).toHaveLength(0)
    }
    for (const change of [{ impersonationToken: 'imp' }, { impersonatingUserId: 'other' }, { authToken: 'changed' }, { selectedOrganizationId: 'other' }]) {
        calls.length = 0
        await expect(performDeliveryAction({ ...settings, ...change }, page, 'retry', 'alert', 'attempt')).rejects.toThrow()
        expect(calls).toHaveLength(0)
    }
})
test('retry UI resolves target from the receipt, and does not use new-send availability', async () => {
    const source = await Bun.file(new URL('../screens/DeliveryHistoryScreen.tsx', import.meta.url)).text()
    expect(source).toContain('action === \'retry\' ? deliveryRetryTarget(page, deliveryId)?.alertId : selected?.id')
    expect(source).toContain('attempt={attempt} disabled={disabled || !page.canRetry}')
    expect(source).not.toContain('attempt={attempt} disabled={disabled || !page.canSend}')
})

test('all retained history is the initial view and exposes orphan receipt B beside finding A', async () => {
    handle = url => url.pathname.endsWith('/webhook-deliveries') ? Response.json(history({
        deliveries: [receipt(), receipt({ id: 'orphan-attempt', alertId: 'orphan-alert' })],
        deliveryRetryRequest: { access: { canRetry: true }, entries: [{ orgId: 'org', alertId: 'orphan-alert', deliveryId: 'orphan-attempt', liveRequest: { canSend: true, externalSendEnabled: true, blockers: [] } }] },
    })) : defaults(url)
    const page = await loadDeliveryHistory(settings)
    expect(page.alerts.map(row => row.id)).toEqual(['alert'])
    expect(deliveryHistorySelection(page, '')).toBe('')
    expect(selectedDeliveryAttempts(page, deliveryHistorySelection(page, '')).map(row => row.id)).toEqual(['attempt', 'orphan-attempt'])
    expect(selectedDeliveryAttempts(page, deliveryHistorySelection(page, 'alert')).map(row => row.id)).toEqual(['attempt'])
    expect(deliveryHistorySelection(page, 'removed-finding')).toBe('')
    expect(deliveryRetryTarget(page, 'orphan-attempt')).toEqual({ alertId: 'orphan-alert', deliveryId: 'orphan-attempt' })
    calls.length = 0
    handle = () => Response.json({ deliveries: [receipt({ id: 'orphan-retry', alertId: 'orphan-alert', status: 'delivered', error: null })] }, { status: 202 })
    await performDeliveryAction(settings, page, 'retry', 'orphan-alert', 'orphan-attempt')
    expect(JSON.parse(String(calls[0].init.body)).deliveryId).toBe('orphan-attempt')
    const source = await Bun.file(new URL('../screens/DeliveryHistoryScreen.tsx', import.meta.url)).text()
    expect(source).toContain('setSelectedId(id => deliveryHistorySelection(value, id))')
    expect(source).toContain('label=\'All retained attempts\'')
    expect(source).toContain('onPress={() => choose(\'\')}')
    expect(source).toContain('{pickerOpen && <>')
    expect(source).not.toContain('value.alerts[0]')
})
