import { beforeEach, expect, mock, test } from 'bun:test'
import type { AppSettings } from '../types'
import type { OrganizationRule } from './organization-rules'
const calls: Array<{ url: URL; settings: AppSettings; init: RequestInit }> = []
let handle: (url: URL, init: RequestInit) => Response | Promise<Response>
mock.module('./api', () => ({ apiFetch: async (settings: AppSettings, input: string, init: RequestInit) => {
    const url = new URL(input); calls.push({ url, init, settings }); return handle(url, init)
} }))
const api = await import('./rule-tuning')
const settings = { apiBaseUrl: 'https://synthetic.invalid/api', userId: 'synthetic', authToken: 'synthetic-token', selectedOrganizationId: 'cashflow', impersonationToken: '', impersonatingUserId: '' } as AppSettings
const signal = () => new AbortController().signal
const access = () => ({ scope: api.tuningScope(settings), canRead: true, canWrite: true })
const log = { message: 'failed exec: /bin/synthetic', ip: '192.0.2.1', ip_path: 'source.ip', user_agent: 'synthetic-agent', user_agent_path: 'metadata.user_agent', last_triggered: '2026-10-23T02:00:00Z', event_count: '100', last_24h_count: '20', storage_bytes: '12000' } as const
const snapshot = { organizationId: api.tuningOrganizationId, generatedAt: '2026-10-23T02:00:00Z', logs: [log], pending: false, refreshing: false }
const draft = () => api.tuningPreset(log)
const rule = (): OrganizationRule => ({ id: 'custom.synthetic.v1', version: '1', name: draft().name, explanation: draft().explanation, severity: 'low', enabled: true, source: 'owned', definition: draft().definition })
const job = (change = {}) => ({ id: 'synthetic-job', rule_id: 'custom.synthetic.v1', rule_version: '1', status: 'queued', scanned: '0', matched: '0', protected: '0', removed_events: '0', removed_sources: '0', error: null, created_at: '2026-10-23T02:00:00Z', updated_at: '2026-10-23T02:00:00Z', ...change })
const preview = (change = {}) => ({ count: 2, scanned: 3, bytes: 400, events: [{ id: 'event', timestamp: '2026-10-23T01:00:00Z', rank: 0.5, normalized: { message: log.message, service: 'synthetic' } }], cursor: null, ...change })
beforeEach(() => {
    calls.length = 0
    handle = url => url.pathname.endsWith('/organizations') ? Response.json({ allowed: true, canEdit: true }) : Response.json(snapshot)
})
test('snapshot uses fixed Hanasand with explicit authenticated transport even on custom API', async () => {
    const verified = await api.loadTuningAccess(settings, signal())
    expect(verified).toEqual(access())
    expect(await api.loadTuningSnapshot(settings, verified, signal())).toEqual(snapshot)
    expect(calls.map(call => call.url.pathname)).toEqual(['/api/management/organizations', '/api/logs/tuning'])
    for (const call of calls) {
        expect(call.settings.selectedOrganizationId).toBe(api.tuningOrganizationId)
        expect(new Headers(call.init.headers).get('authorization')).toBe('Bearer synthetic-token')
        expect(new Headers(call.init.headers).get('id')).toBe('synthetic')
        expect(call.init.credentials).toBe('omit'); expect(call.init.redirect).toBe('error')
    }
    expect(calls[1].url.searchParams.has('organizationId')).toBe(false)
})
test('production access goes directly to canonical Identity origin while snapshot stays Core', async () => {
    const configured = { ...settings, apiBaseUrl: 'https://api.hanasand.com/api' }
    const verified = await api.loadTuningAccess(configured, signal())
    await api.loadTuningSnapshot(configured, verified, signal())
    expect(calls.map(row => row.url.origin)).toEqual(['https://identity.hanasand.com', 'https://api.hanasand.com'])
})
test('snapshot rejects wrong organization, missing metrics, unsafe field paths and malformed dates', () => {
    for (const changed of [{ organizationId: 'cashflow' }, { generatedAt: 'invalid' }, { logs: [{ ...log, event_count: undefined }] }, { logs: [{ ...log, ip_path: 'organizationId' }] }, { logs: [{ ...log, last_triggered: 'bad' }] }, { logs: Array.from({ length: 101 }, () => log) }]) expect(() => api.parseTuningSnapshot({ ...snapshot, ...changed })).toThrow()
    expect(api.parseTuningSnapshot({ ...snapshot, generatedAt: null, logs: [], pending: true, refreshing: true }).pending).toBe(true)
})
test('all five sorts and both directions leave the original snapshot untouched', () => {
    const logs = [log, { ...log, message: 'aaa', ip: '192.0.2.0', user_agent: 'aaa', event_count: '2', storage_bytes: '10' }]
    for (const field of ['message', 'ip', 'user_agent', 'event_count', 'storage_bytes'] as const) {
        expect(api.sortTuningLogs(logs, field, false)[0].message).toBe('aaa')
        expect(api.sortTuningLogs(logs, field, true)[0].message).toBe(log.message)
    }
    expect(logs[0]).toBe(log)
})
test('failed-exec preset has all eight exact constraints and generic preset has only available fields', () => {
    expect(draft().definition.conditions?.map(row => [row.path, row.value, row.caseSensitive])).toEqual([
        ['message', log.message, true], ['metadata.collector', 'auditd', true], ['event_type', 'process', true], ['action', 'exec', true], ['outcome', 'failure', true], ['process.executable', '/bin/synthetic', true], ['source.ip', log.ip, true], ['metadata.user_agent', log.user_agent, true],
    ])
    expect(draft().definition).toMatchObject({ stage: 'analyze', action: 'drop', match: 'all' })
    expect(api.tuningPreset({ ...log, message: 'ordinary', ip_path: null, user_agent_path: null }).definition.conditions).toHaveLength(1)
    expect(() => api.tuningPreset({ ...log, message: 'x'.repeat(201) })).toThrow()
})
test('full editor signature validates names, stage/action, severity and one to eight conditions', () => {
    for (const changed of [{ name: 'x' }, { explanation: 'short' }, { severity: 'bad' }, { definition: { ...draft().definition, stage: 'detect', action: 'drop' } }, { definition: { ...draft().definition, conditions: [] } }, { definition: { ...draft().definition, conditions: Array.from({ length: 9 }, () => ({ path: 'a', operator: 'equals' as const, value: 'b' })) } }]) expect(() => api.tuningSignature({ ...draft(), ...changed })).toThrow()
    const generic = api.tuningPreset({ ...log, message: 'ordinary', ip_path: null, user_agent_path: null })
    expect(api.tuningSignature({ ...generic, definition: { ...generic.definition, conditions: [{ path: 'message', operator: 'regex', value: '^ok$', caseSensitive: false, extra: true } as never] } }).conditions).toEqual([{ path: 'message', operator: 'regex', value: '^ok$', caseSensitive: false }])
})
test('fixed preview windows support all range and cursor paging without changing the cutoff', async () => {
    const window = api.tuningWindow('all', Date.parse('2026-10-23T02:00:00Z'))
    expect(window).toEqual({ from: null, until: '2026-10-23T02:00:00.000Z' })
    handle = () => Response.json(preview({ cursor: { time: '2026-10-23T01:00:00Z', id: 'event' } }))
    const first = await api.previewTuningRule(settings, access(), draft(), window, null, signal())
    handle = () => Response.json(preview())
    await api.previewTuningRule(settings, access(), draft(), window, first.cursor, signal())
    const bodies = calls.map(call => JSON.parse(String(call.init.body)))
    expect(bodies[0]).toMatchObject({ ...window, sample: true, limit: 2000, storedLogsOnly: true, action: 'drop', cursor: null })
    expect(bodies[1]).toMatchObject({ ...window, sample: false, limit: 1000, storedLogsOnly: true, cursor: first.cursor })
    expect(calls.every(call => call.url.searchParams.get('organizationId') === api.tuningOrganizationId)).toBe(true)
    expect(first.events[0].id).toBe('event')
    expect(api.tuningWindow('1', 3600000).from).toBe('1970-01-01T00:00:00.000Z')
})
test('malformed preview and cursor cannot become a ready preview', async () => {
    const window = api.tuningWindow('all')
    for (const changed of [{ count: undefined }, { cursor: {} }, { events: [{ id: '../bad' }] }, { bytes: -1 }]) {
        handle = () => Response.json(preview(changed))
        await expect(api.previewTuningRule(settings, access(), draft(), window, null, signal())).rejects.toThrow()
    }
    calls.length = 0
    await expect(api.previewTuningRule(settings, access(), draft(), window, { id: '../bad', time: window.until }, signal())).rejects.toThrow()
    expect(calls).toHaveLength(0)
})
test('create requires authoritative201 matching saved rule and never automatically retries', async () => {
    handle = () => Response.json({ rule: rule() }, { status: 201 })
    expect((await api.createTuningRule(settings, access(), draft(), signal())).version).toBe('1')
    expect(JSON.parse(String(calls[0].init.body))).toEqual(api.tuningSignature(draft()))
    expect(calls).toHaveLength(1)
    for (const changed of [{ status: 200, rule: rule() }, { status: 201, rule: { ...rule(), enabled: false } }, { status: 201, rule: { ...rule(), id: '../bad' } }]) {
        calls.length = 0; handle = () => Response.json({ rule: changed.rule }, { status: changed.status })
        try { await api.createTuningRule(settings, access(), draft(), signal()); throw new Error('expected rejection') }
        catch (cause) { expect((cause as InstanceType<typeof api.TuningError>).uncertain).toBe(true) }
        expect(calls).toHaveLength(1)
    }
})
test('both impersonation states, denied authority and stale account scope stop every mutation', async () => {
    for (const changed of [{ ...settings, impersonationToken: 'imp' }, { ...settings, impersonatingUserId: 'other' }, { ...settings, authToken: 'new' }, { ...settings, selectedOrganizationId: 'other' }]) {
        await expect(api.createTuningRule(changed, access(), draft(), signal())).rejects.toThrow()
        await expect(api.refreshTuningSummary(changed, access(), signal())).rejects.toThrow()
    }
    await expect(api.createTuningRule(settings, { ...access(), canWrite: false }, draft(), signal())).rejects.toThrow()
    expect(calls).toHaveLength(0)
})
test('refresh queues only exact202 and emptyPOST; network failure remains uncertain without retry', async () => {
    handle = () => Response.json({ refreshing: true }, { status: 202 })
    await api.refreshTuningSummary(settings, access(), signal())
    expect(calls[0].url.pathname).toBe('/api/logs/tuning/refresh')
    expect(calls[0].init.method).toBe('POST'); expect(calls[0].init.body).toBe('{}')
    for (const response of [() => Response.json({}, { status: 202 }), () => Response.json({}, { status: 503 }), () => { throw new Error('synthetic-token private-server-detail') }]) {
        calls.length = 0; handle = response
        try { await api.refreshTuningSummary(settings, access(), signal()); throw new Error('expected rejection') }
        catch (cause) { expect((cause as InstanceType<typeof api.TuningError>).uncertain).toBe(true); expect(String(cause)).not.toContain('synthetic-token') }
        expect(calls).toHaveLength(1)
    }
})
test('saved-rule reconciliation reads list and exact current detail without recreating anything', async () => {
    handle = url => url.pathname.endsWith('/rules') ? Response.json({ organizationId: api.tuningOrganizationId, rules: [rule()] }) : Response.json({ organizationId: api.tuningOrganizationId, isHistorical: false, rule: rule() })
    expect(await api.listTuningRules(settings, access(), signal())).toEqual([{ id: rule().id, name: rule().name, enabled: true }])
    expect(await api.loadSavedTuningRule(settings, access(), rule().id, signal())).toMatchObject(rule())
    expect(calls[1].url.pathname).toBe('/api/rules/custom.synthetic')
    expect(calls.every(call => call.init.method === 'GET')).toBe(true)
})
test('reprocess GET returns exact-rule job history and nullable estimate', async () => {
    handle = () => Response.json({ jobs: [job()], existing: { count: 8, bytes: 1000 } })
    expect(await api.loadRuleReprocessing(settings, access(), rule(), signal())).toMatchObject({ jobs: [job()], existing: { count: 8 } })
    handle = () => Response.json({ jobs: [job({ rule_id: 'other.v1' })], existing: null })
    await expect(api.loadRuleReprocessing(settings, access(), rule(), signal())).rejects.toThrow('invalid')
})
test('reprocessing start binds confirmed saved version and fixed range to matching preview', async () => {
    const window = api.tuningWindow('all'); handle = () => Response.json(preview())
    const checked = await api.previewTuningRule(settings, access(), draft(), window, null, signal(), '1')
    calls.length = 0; handle = () => Response.json({ job: job() }, { status: 202 })
    await api.startRuleReprocessing(settings, access(), rule(), window, checked, signal())
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ confirm: true, version: '1', from: null })
    expect(calls[0].url.pathname).toBe('/api/rules/custom.synthetic/reprocess')
    calls.length = 0
    await expect(api.startRuleReprocessing(settings, access(), rule(), api.tuningWindow('24'), checked, signal())).rejects.toThrow('again')
    await expect(api.startRuleReprocessing(settings, access(), { ...rule(), enabled: false }, window, checked, signal())).rejects.toThrow()
    await expect(api.startRuleReprocessing(settings, access(), { ...rule(), version: '2' }, window, checked, signal())).rejects.toThrow('again')
    expect(calls).toHaveLength(0)
})
test('cancel only names an active exact-rule job and verifies returned cancellation', async () => {
    handle = () => Response.json({ job: job({ status: 'cancelled' }) })
    await api.cancelRuleReprocessing(settings, access(), rule(), job(), signal())
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ action: 'cancel', jobId: 'synthetic-job' })
    calls.length = 0
    for (const changed of [{ status: 'completed' }, { rule_id: 'other' }, { id: '../bad' }]) await expect(api.cancelRuleReprocessing(settings, access(), rule(), job(changed), signal())).rejects.toThrow()
    expect(calls).toHaveLength(0)
})
test('pre-abort, insecure API and malformed auth stop before transport; auth rejection is explicit', async () => {
    const abort = new AbortController(); abort.abort()
    await expect(api.loadTuningSnapshot(settings, access(), abort.signal)).rejects.toThrow('cancelled')
    const insecure = { ...settings, apiBaseUrl: 'http://synthetic.invalid/api' }
    await expect(api.loadTuningSnapshot(insecure, { ...access(), scope: api.tuningScope(insecure) }, signal())).rejects.toThrow('secure')
    const empty = { ...settings, authToken: '' }
    await expect(api.createTuningRule(empty, { ...access(), scope: api.tuningScope(empty) }, draft(), signal())).rejects.toThrow()
    expect(calls).toHaveLength(0)
    for (const status of [401, 403]) {
        handle = () => Response.json({ error: 'private synthetic-token' }, { status })
        try { await api.loadTuningSnapshot(settings, access(), signal()); throw new Error('expected rejection') }
        catch (cause) { expect((cause as InstanceType<typeof api.TuningError>).status).toBe(status); expect(String(cause)).not.toContain('synthetic-token') }
    }
})
test('UI source guards lifecycle, confirmation epochs, manual unknown-write recovery and actual destructive disclosure', async () => {
    const screen = await Bun.file(new URL('../screens/RuleTuningScreen.tsx', import.meta.url)).text()
    for (const required of ['key={tuningScope(settings)}', 'state !== \'active\'', 'controller.current?.abort()', 'mutation.current?.abort()', 'if (authBlocked.current && !manual.current) return', 'if (explicit) { setBlocked(false)', 'setInitial(null); setRule(null)', 'onBusy={value => { pending.current = value; setBusy(value) }}']) expect(screen).toContain(required)
    const editor = await Bun.file(new URL('../components/RuleTuningEditor.tsx', import.meta.url)).text()
    expect(editor).toContain('JSON.stringify(current.current.draft) !== snapshot')
    expect(editor).toContain('current.current.json !== null')
    const reprocess = await Bun.file(new URL('../components/RuleReprocessPanel.tsx', import.meta.url)).text()
    for (const required of ['current !== epoch.current', 'canConfirmReprocessing(reviewState(), reviewed, cancel)', 'permanently deleted', 'Store rules and security findings are preserved', 'setPreview(null); setAcknowledged(false)']) expect(reprocess).toContain(required)
    for (const source of [screen, editor, reprocess]) { expect(source).not.toContain('AsyncStorage'); expect(source).not.toContain('localStorage') }
})

test('interrupted create preserves uncertain outcome even if transport returns a late201', async () => {
    const abort = new AbortController()
    handle = () => { abort.abort(); return Response.json({ rule: rule() }, { status: 201 }) }
    try { await api.createTuningRule(settings, access(), draft(), abort.signal); throw new Error('expected rejection') }
    catch (cause) { expect((cause as InstanceType<typeof api.TuningError>).uncertain).toBe(true) }
    expect(calls).toHaveLength(1)
    expect(calls[0].init.signal?.aborted).toBe(true)
})
test('read impersonation is forwarded explicitly while its write access remains false', async () => {
    const impersonated = { ...settings, impersonationToken: 'synthetic-imp', impersonatingUserId: 'other' }
    const verified = await api.loadTuningAccess(impersonated, signal())
    expect(verified.canRead).toBe(true); expect(verified.canWrite).toBe(false)
    await api.loadTuningSnapshot(impersonated, verified, signal())
    expect(new Headers(calls[1].init.headers).get('x-impersonation-token')).toBe('synthetic-imp')
    const count = calls.length
    await expect(api.refreshTuningSummary(impersonated, verified, signal())).rejects.toThrow()
    expect(calls).toHaveLength(count)
})
test('reprocessing503 and malformed job responses remain uncertain and are not retried', async () => {
    const window = api.tuningWindow('all'); handle = () => Response.json(preview())
    const checked = await api.previewTuningRule(settings, access(), draft(), window, null, signal(), '1')
    for (const operation of ['start', 'cancel']) {
        for (const malformed of [false, true]) {
            calls.length = 0
            handle = () => Response.json(malformed ? { job: job({ id: 'wrong', rule_version: '2', status: 'completed' }) } : {}, { status: malformed ? 202 : 503 })
            try {
                if (operation === 'start') await api.startRuleReprocessing(settings, access(), rule(), window, checked, signal())
                else await api.cancelRuleReprocessing(settings, access(), rule(), job(), signal())
                throw new Error('expected rejection')
            } catch (cause) { expect((cause as InstanceType<typeof api.TuningError>).uncertain).toBe(true) }
            expect(calls).toHaveLength(1)
        }
    }
})
test('repeated cursor is rejected instead of double counting the same preview page', async () => {
    const cursor = { time: '2026-10-23T01:00:00Z', id: 'event' }
    handle = () => Response.json(preview({ cursor }))
    await expect(api.previewTuningRule(settings, access(), draft(), api.tuningWindow('all'), cursor, signal())).rejects.toThrow('invalid')
    expect(calls).toHaveLength(1)
})

test('automatic summary re-read never grants manual reconciliation after an uncertain write', async () => {
    const source = await Bun.file(new URL('../screens/RuleTuningScreen.tsx', import.meta.url)).text()
    const refresh = source.slice(source.indexOf('async function refreshSummary()'), source.indexOf('async function selectSaved('))
    expect(refresh).not.toContain('refresh()')
    expect(refresh).not.toContain('manual.current = true')
    expect(refresh).toContain('setRevision(value => value + 1)')
    expect(source).toContain('onDenied={denied}')
})

test('captured destructive confirmation performs zeroPOST after a failed status read locks the live review', async () => {
    const window = api.tuningWindow('all')
    handle = () => Response.json(preview())
    const checked = await api.previewTuningRule(settings, access(), draft(), window, null, signal(), '1')
    let current = { epoch: 4, active: true, disabled: false, pending: false, locked: false, range: 'all' as const, version: '1', acknowledged: true, previewKey: checked.key, jobId: null as string | null }
    const reviewed = { ...current }
    const capturedConfirm = async () => {
        if (!api.canConfirmReprocessing(current, reviewed, false)) return
        await api.startRuleReprocessing(settings, access(), rule(), window, checked, signal())
    }
    expect(api.canConfirmReprocessing(current, reviewed, false)).toBe(true)
    calls.length = 0; handle = () => Response.json({}, { status: 503 })
    try { await api.loadRuleReprocessing(settings, access(), rule(), signal()) }
    catch { current = api.lockReprocessReview(current) as typeof current }
    await capturedConfirm()
    expect(current.locked).toBe(true)
    expect(current.acknowledged).toBe(false)
    expect(current.previewKey).toBeNull()
    expect(calls.filter(call => call.init.method === 'POST')).toHaveLength(0)
    const source = await Bun.file(new URL('../components/RuleReprocessPanel.tsx', import.meta.url)).text()
    expect(source).toContain('lockReprocessReview(reviewState())')
    expect(source).toContain('epoch.current = invalidated.epoch')
    expect(source).toContain('canConfirmReprocessing(reviewState(), reviewed, cancel)')
})
test('queued pre-submit input cannot invalidate or discard an accepted create201 receipt', async () => {
    let state = { generation: 1, active: true, pending: false, disabled: false }, localDraft = draft(), epoch = 5
    const renderedGeneration = state.generation
    const capturedInput = () => {
        if (!api.canEditTuningInput(state, renderedGeneration)) return
        state.generation++; epoch++; localDraft = { ...localDraft, name: 'Late queued input' }
    }
    let resolve: (response: Response) => void = () => { throw new Error('Expected transport first') }
    handle = () => new Promise<Response>(done => { resolve = done })
    const reviewedEpoch = epoch
    state = { ...state, generation: state.generation + 1, pending: true }
    let ownedReceipt: OrganizationRule | null = null, uncertain = false
    const save = api.createTuningRule(settings, access(), localDraft, signal()).then(receipt => {
        if (epoch === reviewedEpoch) ownedReceipt = receipt
        else uncertain = true
    })
    capturedInput()
    resolve(Response.json({ rule: rule() }, { status: 201 }))
    await save
    expect(epoch).toBe(reviewedEpoch)
    expect(localDraft.name).toBe(draft().name)
    expect(ownedReceipt).toMatchObject({ id: rule().id, version: '1' })
    expect(uncertain).toBe(false)
    expect(calls).toHaveLength(1)
    state.pending = false
    capturedInput()
    expect(localDraft.name).toBe(draft().name)
    const source = await Bun.file(new URL('../components/RuleTuningEditor.tsx', import.meta.url)).text()
    expect(source).toContain('canEditTuningInput(')
    expect(source).toContain('inputGeneration.current++; pending.current = true')
    expect(source).toContain('else onUncertain()')
    expect(source).toContain('function editJson(')
    expect(source).toContain('function changeRange(')
})
test('reprocess confirmation and input guards reject changed job, acknowledgement, range, preview or lifecycle', () => {
    const reviewed = { epoch: 1, active: true, disabled: false, pending: false, locked: false, range: 'all' as const, version: '1', acknowledged: true, previewKey: 'preview', jobId: null }
    for (const changed of [{ active: false }, { disabled: true }, { pending: true }, { locked: true }, { epoch: 2 }, { range: '24' as const }, { version: '2' }, { acknowledged: false }, { previewKey: 'different' }, { jobId: 'active-job' }]) expect(api.canConfirmReprocessing({ ...reviewed, ...changed }, reviewed, false)).toBe(false)
    expect(api.canConfirmReprocessing({ ...reviewed, jobId: 'active-job' }, { ...reviewed, jobId: 'active-job' }, true)).toBe(true)
    expect(api.canConfirmReprocessing({ ...reviewed, jobId: 'new-job' }, { ...reviewed, jobId: 'old-job' }, true)).toBe(false)
    const input = { generation: 1, active: true, pending: false, disabled: false }
    expect(api.canEditTuningInput(input, 1)).toBe(true)
    for (const changed of [{ generation: 2 }, { active: false }, { pending: true }, { disabled: true }]) expect(api.canEditTuningInput({ ...input, ...changed }, 1)).toBe(false)
})

// Fabric resolves a retained native target to its CURRENT listener at dispatch time.
// This models target lookup, rather than calling the JavaScript closure captured before a render.
function nativeTargets() {
    const targets = new Map<number, (value: string) => void>()
    let key = '', target = 0, next = 1
    return {
        commit(nextKey: string, listener: (value: string) => void) {
            if (nextKey !== key || !target) { targets.delete(target); target = next++; key = nextKey }
            targets.set(target, listener)
            return target
        },
        dispatch(id: number, value: string) { targets.get(id)?.(value) },
    }
}
test('delayed native text/JSON targets cannot edit the current draft after returning to idle', () => {
    for (const replaceHosts of [false, true]) {
        const host = nativeTargets()
        let current = { generation: 1, active: true, pending: false, disabled: false }, boundary = 0, draftText = 'Current memory draft'
        const render = () => {
            const captured = current.generation
            return host.commit(api.tuningNativeHostKey(0, replaceHosts ? boundary : 0), value => {
                if (api.canEditTuningInput(current, captured)) draftText = value
            })
        }
        const staleNativeTarget = render()
        current = { ...current, generation: 2, pending: true }
        boundary++
        host.dispatch(staleNativeTarget, 'Before commit stale text')
        expect(draftText).toBe('Current memory draft')
        render()
        current.pending = false; boundary++
        render()
        host.dispatch(staleNativeTarget, 'After idle stale text')
        // The retained-host control reproduces the original failure despite a new JS generation.
        expect(draftText).toBe(replaceHosts ? 'Current memory draft' : 'After idle stale text')
    }
})
test('ordinary typing retains the same native input host and memory draft; context renewal removes old targets', () => {
    const host = nativeTargets()
    let draftText = '', context = 0
    const render = () => host.commit(api.tuningNativeHostKey(context, 0), value => { draftText = value })
    const original = render()
    for (const value of ['a', 'ab', 'abc']) { host.dispatch(original, value); expect(render()).toBe(original) }
    expect(draftText).toBe('abc')
    context++
    const replacement = render()
    expect(replacement).not.toBe(original)
    expect(draftText).toBe('abc')
    host.dispatch(original, 'stale prior-context edit')
    expect(draftText).toBe('abc')
    host.dispatch(replacement, 'new context edit')
    expect(draftText).toBe('new context edit')
})
test('acknowledgement target from a prior preview cannot acknowledge a refreshed preview after idle', () => {
    const host = nativeTargets()
    let previewReady = true, acknowledged = false, boundary = 0
    const render = () => host.commit(`acknowledge:${api.tuningNativeHostKey(0, boundary)}`, () => { if (previewReady) acknowledged = !acknowledged })
    const previousPreviewTarget = render()
    previewReady = false; boundary++; render()
    host.dispatch(previousPreviewTarget, '')
    expect(acknowledged).toBe(false)
    previewReady = true; boundary++; const currentPreviewTarget = render()
    host.dispatch(previousPreviewTarget, '')
    expect(acknowledged).toBe(false)
    host.dispatch(currentPreviewTarget, '')
    expect(acknowledged).toBe(true)
})
test('native host replacements are wired at operation, clear and context boundaries, not each keystroke', async () => {
    const editor = await Bun.file(new URL('../components/RuleTuningEditor.tsx', import.meta.url)).text()
    const panel = await Bun.file(new URL('../components/RuleReprocessPanel.tsx', import.meta.url)).text()
    expect(editor).toContain('<TextInput key={`text:${nativeKey}`}')
    expect(editor).toContain('context.current.signal !== signal || context.current.scope !== scope')
    expect(editor).toContain('useTuningHostBoundary(signal, access.scope)')
    expect(editor).toContain('if (value === null || current.current.json === null) { inputGeneration.current++; renewHosts() }')
    const ordinaryEdit = editor.slice(editor.indexOf('function change(next:'), editor.indexOf('function changeConditions('))
    expect(ordinaryEdit).not.toContain('renewHosts()')
    for (const source of [editor, panel]) {
        expect(source).toContain('renewHosts(); inputGeneration.current++; pending.current = true')
        expect(source).toContain('if (mounted.current) { renewHosts(); setBusy(false) }')
    }
    expect(panel).toContain('key={`acknowledge:${hostKey}`}')
    expect(panel).toContain('renewHosts(); epoch.current = invalidated.epoch')
})
