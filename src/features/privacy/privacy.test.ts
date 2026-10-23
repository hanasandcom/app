import { beforeEach, expect, mock, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'
import { AbortController as NativeAbortController, AbortSignal as NativeAbortSignal } from 'abort-controller/dist/abort-controller'
import type { AppSettings } from '../../types'

const calls: Array<{ settings: AppSettings; url: string; init: RequestInit }> = []
let handle: (url: string, init: RequestInit) => Response | Promise<Response>
mock.module('../../lib/api', () => ({ apiFetch: async (settings: AppSettings, url: string, init: RequestInit) => {
    calls.push({ settings, url, init }); return handle(url, init)
} }))
mock.module('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, digestStringAsync: async (_algorithm: string, value: string) => createHash('sha256').update(value, 'utf8').digest('hex') }))
const api = await import('./api'), model = await import('./model'), { PrivacyController } = await import('./controller'), files = await import('./export')
const settings = { apiBaseUrl: 'https://api.hanasand.com/api', siteBaseUrl: 'https://hanasand.com', userId: 'actor', authToken: 'synthetic-token', selectedOrganizationId: 'org.one:@', impersonationToken: '', impersonatingUserId: '' } as AppSettings
const orgId = settings.selectedOrganizationId!
const signal = () => new AbortController().signal
const run = (change = {}) => ({ id: 'run-one', organization_id: orgId, request_id: 'intent-one', trigger_type: 'manual', status: 'completed', deleted_count: 0, protected_count: 2, ...change })
const requestRow = (change = {}) => ({ id: 'request-one', organization_id: orgId, request_id: 'intent-one', request_type: 'export', status: 'completed', ...change })
const payload = (change = {}) => ({ schemaVersion: 'organization.privacy_state.v1', organization: { id: orgId, name: 'Example', status: 'active', retention_days: 365 }, permissions: { canExport: true, canRunRetention: true, canRequestDeletion: true }, runs: [], requests: [], items: [], itemPage: { offset: 0, limit: 50, nextOffset: null }, protection: { protected_events: 0, immutable_log_events: null, explanation: 'Held evidence remains.' }, ...change })
const state = (change = {}) => model.parsePrivacyState(payload(change), settings)
const exported = () => {
    const data = { public: { organization: { id: orgId }, label: 'Æøå 🔐' }, threatIntelligence: { schemaVersion: 'organization.privacy_export.ti.v1', organizationId: orgId, tenantId: orgId } }
    return { schemaVersion: 'organization.privacy_export.v1' as const, organizationId: orgId, tenantId: orgId, exportedAt: '2026-10-23T05:00:00Z', data, checksum: createHash('sha256').update(JSON.stringify(data), 'utf8').digest('hex') }
}
beforeEach(() => { calls.length = 0; handle = () => Response.json(payload()) })

test('direct Core GET uses exact scope/paging and explicit actor headers without website or Identity routing', async () => {
    const result = await api.loadPrivacy(settings, signal())
    expect(result.organization).toEqual({ id: orgId, name: 'Example', status: 'active', retentionDays: 365 })
    expect(calls[0].url).toBe('https://api.hanasand.com/api/organizations/org.one%3A%40/privacy?itemOffset=0&itemLimit=50')
    expect(calls[0].settings).toBe(settings)
    expect(calls[0].init).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store' })
    expect(new Headers(calls[0].init.headers).get('authorization')).toBe('Bearer synthetic-token')
    expect(new Headers(calls[0].init.headers).get('id')).toBe('actor')
    handle = () => Response.json(payload({ itemPage: { offset: 50, limit: 50, nextOffset: 100 } }))
    expect((await api.loadPrivacy(settings, signal(), 50)).page.nextOffset).toBe(100)
})
test('configured HTTPS services retain explicit actor headers; invalid configuration and personal scope never fetch', async () => {
    await api.loadPrivacy({ ...settings, apiBaseUrl: 'https://privacy.invalid/api' }, signal())
    expect(new Headers(calls[0].init.headers).get('authorization')).toBe('Bearer synthetic-token')
    const count = calls.length
    for (const change of [{ selectedOrganizationId: 'personal' }, { selectedOrganizationId: '../other' }, { apiBaseUrl: 'http://unsafe.invalid' }, { apiBaseUrl: 'https://user:secret@unsafe.invalid' }]) await expect(api.loadPrivacy({ ...settings, ...change }, signal())).rejects.toThrow()
    expect(calls).toHaveLength(count)
})
test('valid empty differs from missing, wrong-scope, malformed, wrong-page and unavailable data', async () => {
    expect(state().runs).toEqual([])
    for (const change of [{ runs: null }, { requests: {} }, { items: [null] }, { runs: [run({ organization_id: 'other' })] }, { organization: { id: 'other' } }, { permissions: {} }, { itemPage: { offset: 0, limit: 50, nextOffset: 0 } }]) expect(() => state(change)).toThrow()
    for (const status of [401, 403, 404, 503]) {
        handle = () => Response.json({ error: 'private SQL detail' }, { status })
        await expect(api.loadPrivacy(settings, signal())).rejects.not.toThrow('private SQL detail')
    }
    handle = () => Response.json(payload({ itemPage: { offset: 50, limit: 50, nextOffset: null } }))
    await expect(api.loadPrivacy(settings, signal())).rejects.toThrow('wrong page')
    expect(model.metric(null)).toBeNull(); expect(model.metric(undefined)).toBeNull(); expect(model.metric('0')).toBe(0)
})
test('server permissions, both impersonation fields and exact scope guard every action before transport', async () => {
    for (const change of [{ impersonationToken: 'synthetic-impersonation' }, { impersonatingUserId: 'target' }, { authToken: 'different-token' }, { selectedOrganizationId: 'other' }]) {
        await expect(api.performPrivacyAction({ ...settings, ...change }, state(), 'export', 'intent-one', signal())).rejects.toThrow()
    }
    await expect(api.performPrivacyAction(settings, state({ permissions: { canExport: false, canRunRetention: false, canRequestDeletion: false } }), 'export', 'intent-one', signal())).rejects.toThrow()
    expect(calls).toHaveLength(0)
    // Privacy has no active-only organization ACL: do not invent one for archived organizations.
    expect(model.canUsePrivacyAction(settings, state({ organization: { id: orgId, name: 'Example', status: 'archived', retention_days: 365 } }), 'export')).toBe(true)
})
test('deletion sends only exact current name/password and UUID-compatible request; invalid confirmation never submits', async () => {
    await expect(api.performPrivacyAction(settings, state(), 'delete', 'intent-one', signal(), { confirmation: 'example', currentPassword: 'synthetic-password' })).rejects.toThrow()
    expect(calls).toHaveLength(0)
    handle = () => Response.json(payload({ runs: [run({ trigger_type: 'privacy_deletion', privacy_request_id: 'request-one' })], requests: [requestRow({ request_type: 'deletion' })], worker: { claimed: true, runId: 'run-one', failed: false, hasMore: false, deadLetter: false } }))
    expect((await api.performPrivacyAction(settings, state(), 'delete', 'intent-one', signal(), { confirmation: 'Example', currentPassword: 'synthetic-password' })).status).toBe('completed')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ action: 'delete', requestId: 'intent-one', confirmation: 'Example', currentPassword: 'synthetic-password' })
})
test('retention202 and durable502 are preserved and worker status/run must agree', async () => {
    for (const status of [200, 202, 502]) {
        handle = () => Response.json(payload({ runs: [run({ status: status === 200 ? 'completed' : status === 202 ? 'queued' : 'failed' })], worker: { claimed: true, runId: 'run-one', failed: status === 502, hasMore: status === 202, deadLetter: false } }), { status })
        const result = await api.performPrivacyAction(settings, state(), 'run_retention', 'intent-one', signal())
        expect(result.httpStatus).toBe(status); expect(result.status).toBe(status === 200 ? 'completed' : status === 202 ? 'running' : 'failed')
    }
    for (const change of [{ runs: [] }, { worker: { claimed: true, runId: 'foreign' } }, { runs: [run({ status: 'failed' })], worker: { claimed: false } }, { runs: [run({ id: '' })] }]) {
        handle = () => Response.json(payload({ runs: [run()], worker: { claimed: true, runId: 'run-one' }, ...change }))
        await expect(api.performPrivacyAction(settings, state(), 'run_retention', 'intent-one', signal())).rejects.toMatchObject({ uncertain: true })
    }
})
test('deletion missing/wrong linked run is a typed unknown outcome, never a TypeError or manufactured success', async () => {
    for (const runs of [[], [run({ trigger_type: 'privacy_deletion', privacy_request_id: 'different' })], [run({ trigger_type: 'manual' })]]) {
        handle = () => Response.json(payload({ requests: [requestRow({ request_type: 'deletion' })], runs, worker: { claimed: true, runId: 'run-one' } }))
        await expect(api.performPrivacyAction(settings, state(), 'delete', 'intent-one', signal(), { confirmation: 'Example', currentPassword: 'synthetic-password' })).rejects.toBeInstanceOf(model.PrivacyError)
    }
})
test('export verifies schema/scope/completed receipt and exact UTF8 data checksum before sharing', async () => {
    handle = () => Response.json({ export: exported(), request: { id: 'request-one', status: 'completed' } })
    expect((await api.performPrivacyAction(settings, state(), 'export', 'intent-one', signal())).exported?.checksum).toBe(exported().checksum)
    for (const change of [{ organizationId: 'other' }, { tenantId: 'other' }, { checksum: 'a'.repeat(64) }]) {
        handle = () => Response.json({ export: { ...exported(), ...change }, request: { id: 'request-one', status: 'completed' } })
        await expect(api.performPrivacyAction(settings, state(), 'export', 'intent-one', signal())).rejects.toMatchObject({ uncertain: true })
    }
    for (const data of [{ ...exported().data, public: [] }, { ...exported().data, public: { organization: { id: 'other' } } },
        { ...exported().data, threatIntelligence: [] }, { ...exported().data, threatIntelligence: { schemaVersion: 'organization.privacy_export.ti.v1', organizationId: 'other', tenantId: orgId } },
        { ...exported().data, threatIntelligence: { schemaVersion: 'organization.privacy_export.ti.v1', organizationId: orgId, tenantId: 'other' } }]) {
        // A valid outer hash never authorizes a foreign or malformed nested export.
        handle = () => Response.json({ export: { ...exported(), data, checksum: createHash('sha256').update(JSON.stringify(data)).digest('hex') }, request: { id: 'request-one', status: 'completed' } })
        await expect(api.performPrivacyAction(settings, state(), 'export', 'intent-one', signal())).rejects.toMatchObject({ uncertain: true })
    }
    handle = () => Response.json({ error: 'private detail', request: { id: 'request-one', status: 'failed' } }, { status: 502 })
    expect((await api.performPrivacyAction(settings, state(), 'export', 'intent-one', signal())).status).toBe('failed')
})
test('existing export409 and transport failure remain unknown with no POST retry', async () => {
    for (const handler of [() => Response.json({ error: 'used' }, { status: 409 }), () => { throw new Error('offline') }]) {
        handle = handler
        const count = calls.length
        await expect(api.performPrivacyAction(settings, state(), 'export', 'intent-one', signal())).rejects.toMatchObject({ uncertain: true })
        expect(calls).toHaveLength(count + 1)
    }
})
test('installed native AbortController works without AbortSignal.any; pre-abort never submits', async () => {
    const original = globalThis.AbortController
    globalThis.AbortController = NativeAbortController as unknown as typeof AbortController
    try {
        expect('any' in NativeAbortSignal).toBe(false)
        const external = new NativeAbortController()
        await api.loadPrivacy(settings, external.signal as unknown as AbortSignal)
        external.abort()
        const count = calls.length
        await expect(api.loadPrivacy(settings, external.signal as unknown as AbortSignal)).rejects.toThrow()
        expect(calls).toHaveLength(count)
    } finally { globalThis.AbortController = original }
})
test('deadline covers ignored fetch abort AND stalled response body; late POST is unknown', async () => {
    const never = new Promise<Response>(() => undefined)
    await expect(api.loadPrivacy(settings, signal(), 0, { transport: () => never, timeoutMs: 5 })).rejects.toThrow('interrupted')
    const body = Response.json(payload())
    body.text = () => new Promise(() => undefined)
    await expect(api.loadPrivacy(settings, signal(), 0, { transport: async () => body, timeoutMs: 5 })).rejects.toThrow('interrupted')
    await expect(api.performPrivacyAction(settings, state(), 'export', 'intent-one', signal(), undefined, { transport: () => never, timeoutMs: 5 })).rejects.toMatchObject({ uncertain: true })
})
test('response declared and actual sizes are bounded', async () => {
    handle = () => new Response('{}', { headers: { 'content-length': String(5 * 1024 * 1024) } })
    await expect(api.loadPrivacy(settings, signal())).rejects.toThrow('too large')
    handle = () => new Response(' '.repeat(4 * 1024 * 1024 + 1))
    await expect(api.loadPrivacy(settings, signal())).rejects.toThrow('too large')
})
test('unknown reconciliation requires exact scope/type/request and deletion linkage; absence stays unresolved', () => {
    const intent = { action: 'export' as const, requestId: 'intent-one' }
    for (const requests of [[], [requestRow({ request_id: 'other' })], [requestRow({ request_type: 'deletion' })], [requestRow({ organization_id: 'other' })]]) {
        const snapshot = { ...state(), requests }
        expect(model.matchedPrivacyOutcome(snapshot, intent)).toBe(false)
    }
    expect(model.matchedPrivacyOutcome(state({ requests: [requestRow()] }), intent)).toBe(true)
    expect(model.matchedPrivacyOutcome(state({ requests: [requestRow({ request_type: 'deletion' })] }), { ...intent, action: 'delete' })).toBe(false)
})
test('one-use manual read cannot unlock a newer uncertain write; automatic refresh never unlocks', () => {
    const ops = new PrivacyController(); ops.visible = true
    const old = ops.beginRead(ops.generation, true)!
    ops.finishRead(old.ticket, state())
    const write = ops.beginWrite(ops.generation, { action: 'export', requestId: 'intent-one' })!
    ops.finishWrite(write.generation, false)
    expect(ops.finishRead(old.ticket, state({ requests: [requestRow()] }))).toBe(false)
    const automatic = ops.beginRead(ops.generation, false)!
    ops.finishRead(automatic.ticket, state({ requests: [requestRow()] }))
    expect(ops.locked).toBe(true)
    const manual = ops.beginRead(ops.generation, true)!
    ops.finishRead(manual.ticket, state())
    expect(ops.locked).toBe(true)
    const matching = ops.beginRead(ops.generation, true)!
    ops.finishRead(matching.ticket, state({ requests: [requestRow()] }))
    expect(ops.locked).toBe(false); expect(ops.unknown).toBeUndefined()
    expect(ops.finishRead(matching.ticket, state())).toBe(false)
})
test('lifecycle aborts actual controller and discards late response; old native target cannot mint a manual read', () => {
    const ops = new PrivacyController(); ops.visible = true
    const oldGeneration = ops.generation
    const write = ops.beginWrite(oldGeneration, { action: 'export', requestId: 'intent-one' })!
    ops.hide()
    expect(write.controller.signal.aborted).toBe(true)
    expect(ops.finishWrite(write.generation, true)).toBe(false)
    ops.visible = true
    expect(ops.beginRead(oldGeneration, true)).toBeNull()
    expect(ops.unknown).toEqual({ action: 'export', requestId: 'intent-one' })
    const targets = new Map<number, () => unknown>()
    const oldTarget = 101, oldHandler = () => ops.beginRead(oldGeneration, true)
    targets.set(oldTarget, oldHandler)
    // React's changed key removes the old native target; current listener lookup has no target.
    targets.delete(oldTarget); targets.set(102, () => ops.beginRead(ops.generation, true))
    expect(targets.get(oldTarget)?.()).toBeUndefined()
    const source = readFileSync(new NodeURL('../../screens/OrganizationPrivacyScreen.tsx', import.meta.url), 'utf8')
    expect(source).toContain('key={`privacy-hosts-${captured}`}')
    expect(source).toContain('key={`refresh-${captured}`}')
    expect(source).toContain('ops.beginRead(generation, manual)')
    expect(source).toContain('clearPassword(); setError')
    expect(source).toContain('useFocusEffect')
    expect(source).toContain('AppState.addEventListener(\'change\'')
})
test('internal navigation invalidates precommit confirmations and removes old native hosts while preserving unknown intent', () => {
    const ops = new PrivacyController(); ops.visible = true
    const captured = ops.generation
    const continueOldConfirmation = () => ops.beginWrite(captured, { action: 'delete', requestId: 'old-intent' })
    const currentTargets = new Map<number, () => unknown>([[41, continueOldConfirmation]])
    expect(ops.navigate(captured)).toBe(true)
    expect(continueOldConfirmation()).toBeNull()
    currentTargets.delete(41)
    expect(currentTargets.get(41)?.()).toBeUndefined()
    const write = ops.beginWrite(ops.generation, { action: 'export', requestId: 'intent-one' })!
    ops.finishWrite(write.generation, false)
    expect(ops.navigate(ops.generation)).toBe(true)
    expect(ops.locked).toBe(true); expect(ops.unknown?.requestId).toBe('intent-one')
    const source = readFileSync(new NodeURL('../../screens/OrganizationPrivacyScreen.tsx', import.meta.url), 'utf8')
    expect(source).toContain('ops.navigate(captured)')
    expect(source).toContain('panel.current !== \'summary\'')
    expect(source).toContain('clearPassword(); draft.current.confirmation = \'\'')
})
test('actual native share guard rechecks current scope after deferred availability before opening any handoff', async () => {
    let resolve!: (available: boolean) => void, current = true, shares = 0
    const available = new Promise<boolean>(done => { resolve = done })
    const pending = files.guardedPrivacyShare('file:///synthetic.json', () => current, () => available, async () => { shares++ })
    current = false; resolve(true); await pending
    expect(shares).toBe(0)
    await files.guardedPrivacyShare('file:///synthetic.json', () => true, async () => true, async () => { shares++ })
    expect(shares).toBe(1)
})
test('temporary export is removed on sharing failure, stale scope or completion, without persisting credentials', async () => {
    const events: string[] = [], adapter = { write: async (name: string, content: string) => { events.push(`write:${name}`); expect(content).not.toContain(settings.authToken); return { uri: 'file:///synthetic.json', remove: () => { events.push('remove') } } }, share: async () => { events.push('share') } }
    await files.sharePrivacyExport(exported(), () => true, adapter)
    expect(events.at(-1)).toBe('remove')
    events.length = 0
    await expect(files.sharePrivacyExport(exported(), () => true, { ...adapter, share: async () => { throw new Error('share failed') } })).rejects.toThrow('share failed')
    expect(events.at(-1)).toBe('remove')
    events.length = 0
    await files.sharePrivacyExport(exported(), () => false, adapter)
    expect(events).toEqual([])
    let current = true
    await files.sharePrivacyExport(exported(), () => current, { ...adapter, write: async (...args) => { const file = await adapter.write(...args); current = false; return file } })
    expect(events.some(value => value === 'share')).toBe(false); expect(events.at(-1)).toBe('remove')
})
