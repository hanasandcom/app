import { expect, mock, test } from 'bun:test'
import type { Transport } from './api'
import type { ServiceAccountError as ServiceError } from './model'
import type { AppSettings } from '../../types'
mock.module('../../lib/api', () => ({ apiFetch: () => { throw new Error('Unexpected real transport') } }))
const api = await import('./api')
const model = await import('./model')
const { AccountController, AccountIntents } = await import('./controller')
const { acceptsAccountResult, freshAccountWrite } = await import('./actions')
const s = { userId: 'synthetic-user', authToken: 'synthetic-token', apiBaseUrl: 'https://api.hanasand.com/api', siteBaseUrl: 'https://hanasand.com', selectedOrganizationId: 'personal', impersonationToken: '', impersonatingUserId: '' } as AppSettings
const endpoint = { method: 'GET', route: '/api/logs', label: 'Read logs' }, date = '2026-10-23T12:00:00Z'
const account = (patch = {}) => ({ id: 'svc_existing', name: 'Existing', description: 'Fictional', active: true, created_at: date, keys: [{ id: 'key-existing', ownerId: 'svc_existing', enabled: true, keyPrefix: '0123456789ab', createdAt: date, lastUsedAt: null, scopes: [{ ...endpoint, enabled: true }] }], ...patch })
const directory = () => model.parseDirectory({ endpoints: [endpoint], accounts: [account()] })
const access = (settings = s, write = true) => ({ scope: model.sessionScope(settings), canRead: true, canWrite: write, checkedAt: Date.now() })
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const options = (body: unknown, status = 200) => ({ transport: async () => response(body, status) })
const secret = `hsk_${'a'.repeat(12)}_${'b'.repeat(48)}`
const created = () => ({ apiKey: { id: 'key-new', ownerId: 'svc_new', name: 'New', enabled: true, keyPrefix: 'a'.repeat(12), scopes: [{ ...endpoint, enabled: true }] }, secret })
function controller(settings = s, registry = new AccountIntents()) {
    const c = new AccountController(settings, registry); c.visible = true
    const ticket = c.beginRead(c.generation, false)!
    c.finishRead(ticket, access(settings), directory()); return c
}
function operation(action: 'create' | 'update' | 'revoke' = 'create', settings = s) {
    const c = controller(settings), op = c.begin(c.review(c.generation, action, action === 'create' ? 'new-service-account' : 'svc_existing')!, 'operation-one')!
    return { c, op }
}
test('directory parses only bounded display fields; disabled scopes and revoked history remain explicit', () => {
    const raw = account({ active: false }); raw.keys[0].scopes[0].enabled = false
    const value = model.parseDirectory({ endpoints: [endpoint], accounts: [{ ...raw, password: 'NEVER_KEEP', keys: [{ ...raw.keys[0], secret_hash: 'NEVER_KEEP' }] }] })
    expect(value.accounts[0].active).toBe(false); expect(value.accounts[0].keys[0].scopes[0].enabled).toBe(false)
    expect(JSON.stringify(value)).not.toContain('NEVER_KEEP')
    expect(model.accountRows(value, '', 'asc', false)).toEqual([]); expect(model.accountRows(value, 'Read logs', 'asc', true).length).toBe(1)
})
test('malformed/duplicate/foreign account keys and missing timestamps never become empty inventory', () => {
    for (const body of [{}, { endpoints: [endpoint], accounts: null }, { endpoints: [endpoint, endpoint], accounts: [] }, { endpoints: [], accounts: [account(), account()] },
        { endpoints: [], accounts: [account({ active: 'yes' })] }, { endpoints: [], accounts: [account({ created_at: undefined })] },
        { endpoints: [], accounts: [account({ keys: [{ ...account().keys[0], ownerId: 'other' }] })] }]) expect(() => model.parseDirectory(body)).toThrow()
    expect(model.parseDirectory({ endpoints: [], accounts: [] }).accounts).toEqual([])
})
test('search covers names/id/description/scope, name sorting is numeric and active counts do not invent history', () => {
    const d = model.parseDirectory({ endpoints: [endpoint], accounts: [account({ id: 'a', name: 'Agent 10', keys: [] }), account({ id: 'b', name: 'Agent 2', keys: [] }), account({ id: 'c', name: 'Retained', active: false, keys: [] })] })
    expect(model.accountRows(d, '', 'asc', false).map(a => a.id)).toEqual(['b', 'a'])
    expect(model.accountRows(d, 'fictional', 'desc', true).length).toBe(3)
})
test('permission discovery is direct Identity; custom HTTPS gets explicit credentials and global scope without cookies', async () => {
    const calls: { url: string; init: RequestInit; settings: AppSettings }[] = []
    const transport: Transport = async (settings, url, init) => { calls.push({ settings, url, init }); return response({ allowed: true, canEdit: false }) }
    const result = await api.loadAccess(s, new AbortController().signal, { transport })
    expect(calls[0].url).toBe('https://identity.hanasand.com/api/management/organizations?internalPages=1'); expect(result.canWrite).toBe(false)
    const custom = { ...s, apiBaseUrl: 'https://custom.example.test/api', selectedOrganizationId: 'org' }
    await api.loadAccess(custom, new AbortController().signal, { transport })
    expect(calls[1].url).toBe('https://custom.example.test/api/management/organizations?internalPages=1')
    expect(new Headers(calls[1].init.headers).get('Authorization')).toBe('Bearer synthetic-token'); expect(new Headers(calls[1].init.headers).get('id')).toBe(s.userId)
    expect(calls[1].init.credentials).toBe('omit'); expect(calls[1].init.cache).toBe('no-store'); expect(calls[1].settings.selectedOrganizationId).toBeUndefined()
})
test('read success never grants write authority; both impersonation states deny before transport', async () => {
    for (const change of [{ impersonationToken: 'imp' }, { impersonatingUserId: 'other' }]) {
        const settings = { ...s, ...change }; let calls = 0
        const transport: Transport = async () => { calls++; return response(created(), 201) }
        await expect(api.createAccount(settings, access(settings), directory(), { name: 'New', description: '', scopes: [endpoint] }, new AbortController().signal, { transport })).rejects.toThrow('own account')
        expect(calls).toBe(0)
    }
    await expect(api.revokeAccount(s, access(s, false), 'svc_existing', new AbortController().signal, options({ message: 'Revoked' }))).rejects.toThrow('editing access')
})
test('creation sends only exact server-supported method/route pairs and validates the once-only secret receipt', async () => {
    let sent: Record<string, unknown> = {}
    const transport: Transport = async (_s, url, init) => { expect(url).toBe('https://api.hanasand.com/api/service-accounts'); expect(init.method).toBe('POST'); sent = JSON.parse(String(init.body)); return response(created(), 201) }
    const receipt = await api.createAccount(s, access(), directory(), { name: ' New ', description: ' Description ', scopes: [endpoint] }, new AbortController().signal, { transport })
    expect(sent).toEqual({ name: 'New', description: 'Description', scopes: [{ method: 'GET', route: '/api/logs' }] }); expect(receipt).toEqual({ id: 'svc_new', keyId: 'key-new', secret })
    expect(Object.keys(receipt).sort()).toEqual(['id', 'keyId', 'secret'])
})
test('unsupported/duplicate scopes and invalid names fail before dispatch', async () => {
    let calls = 0
    const transport: Transport = async () => { calls++; return response(created(), 201) }
    for (const input of [{ name: '', description: '', scopes: [endpoint] }, { name: 'New', description: '', scopes: [] }, { name: 'New', description: '', scopes: [endpoint, endpoint] }, { name: 'New', description: '', scopes: [{ ...endpoint, route: '/api/unknown' }] }]) {
        await expect(api.createAccount(s, access(), directory(), input, new AbortController().signal, { transport })).rejects.toThrow()
    }
    expect(calls).toBe(0)
})
test('malformed success is uncertain and does not expose unverified key/receipt', async () => {
    for (const body of [{ ...created(), secret: 'bad' }, { ...created(), apiKey: { ...created().apiKey, ownerId: 'svc_existing' } }, { ...created(), apiKey: { ...created().apiKey, scopes: [{ ...endpoint, enabled: false }] } }]) {
        try { await api.createAccount(s, access(), directory(), { name: 'New', description: '', scopes: [endpoint] }, new AbortController().signal, options(body, 201)); throw new Error('Unexpected success') }
        catch (error) { expect(error).toBeInstanceOf(model.ServiceAccountError); expect((error as ServiceError).uncertain).toBe(true); expect((error as Error).message).not.toContain(secret) }
    }
})
test('PATCH preserves immutable scopes; DELETE is revocation with history, not a fabricated deletion count', async () => {
    let body: unknown
    const transport: Transport = async (_s, url, init) => { expect(url.endsWith('/service-accounts/svc_existing')).toBe(true); body = init.body ? JSON.parse(String(init.body)) : undefined; return init.method === 'PATCH' ? response({ id: 'svc_existing', name: 'Edited', description: 'Details' }) : response({ message: 'Credentials revoked; history retained.' }) }
    expect(await api.updateAccount(s, access(), 'svc_existing', { name: 'Edited', description: 'Details' }, new AbortController().signal, { transport })).toEqual({ id: 'svc_existing', name: 'Edited', description: 'Details' })
    expect(body).toEqual({ name: 'Edited', description: 'Details' })
    expect((await api.revokeAccount(s, access(), 'svc_existing', new AbortController().signal, { transport })).message).toContain('history retained'); expect(body).toBeUndefined()
})
test('known server errors stay sanitized, 500 writes stay uncertain and nothing automatically retries', async () => {
    let calls = 0
    const transport: Transport = async () => { calls++; return response({ error: `Database failure ${secret}` }, 500) }
    try { await api.createAccount(s, access(), directory(), { name: 'New', description: '', scopes: [endpoint] }, new AbortController().signal, { transport }) }
    catch (error) { expect((error as ServiceError).uncertain).toBe(true); expect((error as Error).message).not.toContain(secret) }
    expect(calls).toBe(1)
})
test('whole fetch plus body deadline bounds ignored cancellation without unsupported native signal APIs', async () => {
    const NativeController = (await import('abort-controller')).AbortController
    const native = new NativeController()
    const transport: Transport = async () => new Promise(() => {})
    await expect(api.loadAccess(s, native.signal as unknown as AbortSignal, { transport, timeoutMs: 3 })).rejects.toThrow('interrupted')
    const slow: Transport = async () => ({ ok: true, status: 201, headers: new Headers(), text: () => new Promise(() => {}) }) as Response
    try { await api.createAccount(s, access(), directory(), { name: 'New', description: '', scopes: [endpoint] }, new AbortController().signal, { transport: slow, timeoutMs: 3 }) }
    catch (error) { expect((error as ServiceError).uncertain).toBe(true) }
})
test('unsafe target URL, traversal id, oversized and nonJSON bodies fail without fallback', async () => {
    for (const apiBaseUrl of ['http://example.test/api', 'https://user:pass@example.test/api', 'https://example.test/api?token=x']) {
        expect(() => new AccountController({ ...s, apiBaseUrl })).not.toThrow()
        expect(model.intentScope({ ...s, apiBaseUrl })).not.toContain('pass')
        await expect(api.loadDirectory({ ...s, apiBaseUrl }, new AbortController().signal, options({}))).rejects.toThrow()
    }
    await expect(api.updateAccount(s, access(), '../bad', { name: 'New', description: '' }, new AbortController().signal, options({}))).rejects.toThrow('identifier')
    const transport: Transport = async () => new Response('{}', { headers: { 'Content-Length': String(9 * 1024 * 1024) } })
    await expect(api.loadDirectory(s, new AbortController().signal, { transport })).rejects.toThrow('size limit')
    await expect(api.loadDirectory(s, new AbortController().signal, { transport: async () => new Response('<html>') })).rejects.toThrow('verified')
})
test('minimal unknown intent survives remount/token refresh/workspace A→B→A without storing names, bodies or keys', () => {
    const registry = new AccountIntents(), c = controller(s, registry), op = c.begin(c.review(c.generation, 'create', 'new-service-account')!, 'one')!
    c.finish(op, false); c.hide()
    const next = new AccountController({ ...s, authToken: 'rotated', selectedOrganizationId: 'other-org', apiBaseUrl: 'https://API.hanasand.com:443/api/' }, registry)
    expect(next.unknown).toEqual({ token: 'one', action: 'create', target: 'new-service-account' })
    expect(new AccountController({ ...s, userId: 'other' }, registry).unknown).toBeUndefined()
    expect(Object.keys(next.unknown!)).toEqual(['token', 'action', 'target'])
})
test('unknown read reconciliation requires fresh manual full list/current writer and exact retained target; denied/failed/automatic cannot acknowledge', () => {
    for (const scenario of ['automatic', 'denied', 'failed', 'reader', 'missing', 'manual'] as const) {
        const { c, op } = operation('revoke'); c.finish(op, false)
        const ticket = c.beginRead(c.generation, scenario !== 'automatic')!
        c.finishRead(ticket, scenario === 'denied' ? { ...access(), canRead: false, canWrite: false } : access(s, scenario !== 'reader'), scenario === 'failed' ? null : scenario === 'missing' ? { endpoints: [], accounts: [] } : directory())
        expect(c.canAcknowledge).toBe(scenario === 'manual')
        expect(c.unknown?.token).toBe('operation-one')
        if (scenario === 'manual') { expect(c.acknowledge(c.generation, 'old')).toBe(false); expect(c.acknowledge(c.generation, 'operation-one')).toBe(true) }
    }
})
test('one-use manual ticket cannot clear a newer write; draft edit invalidates an old Alert without replacing a typing host', () => {
    const c = controller(), g = c.generation, review = c.review(g, 'update', 'svc_existing')!
    c.edit(g); expect(c.generation).toBe(g); expect(c.begin(review, 'old')).toBeNull()
    const old = c.beginRead(c.generation, true)!; c.finishRead(old, access(), directory())
    const op = c.begin(c.review(c.generation, 'update', 'svc_existing')!, 'new')!
    c.finish(op, false)
    expect(c.finishRead(old, access(), directory())).toBe(false); expect(c.canAcknowledge).toBe(false)
})
test('registry is bounded, strips extras and refuses eviction or old-token CAS', () => {
    const registry = new AccountIntents(1)
    expect(registry.claim('one', { token: 'one', action: 'create', target: 'new', secret } as never)).toBe(true)
    expect(JSON.stringify(registry.get('one'))).not.toContain(secret)
    expect(registry.claim('two', { token: 'two', action: 'revoke', target: 'svc_existing' })).toBe(false)
    expect(registry.clear('one', 'old')).toBe(false); expect(registry.clear('one', 'one')).toBe(true)
})
test('fresh authority/target revocation and hide during await block dispatch and once-only secret acceptance', async () => {
    for (const mode of ['denied', 'inactive', 'hidden'] as const) {
        const { c, op } = operation('update'); let dispatches = 0
        const services = { ...api.serviceAccountServices, loadAccess: async () => { if (mode === 'hidden') { c.hide(); c.visible = true } return access(s, mode !== 'denied') }, loadDirectory: async () => model.parseDirectory({ endpoints: [endpoint], accounts: [account({ active: mode !== 'inactive' })] }) }
        await expect((async () => { await freshAccountWrite(s, services, c, op); dispatches++ })()).rejects.toThrow()
        expect(dispatches).toBe(0)
        if (mode === 'hidden') expect(acceptsAccountResult(s, c, op)).toBe(false)
    }
})
test('native current-target lookup drops old input/action hosts after selection/write/end while preserving nonsecret controlled state', () => {
    const c = controller(), hosts = new Map<number, () => void>(); let draft = 'Preserved', calls = 0
    const render = () => { const g = c.generation; hosts.clear(); hosts.set(g, () => { if (c.edit(g)) { draft = 'Late'; calls++ } }); return g }
    const old = render(); c.navigate(old); render(); hosts.get(old)?.(); expect(draft).toBe('Preserved')
    const before = c.generation, op = c.begin(c.review(before, 'create', 'new')!, 'one')!
    render(); c.finish(op, true); render(); hosts.get(before)?.(); expect(calls).toBe(0); expect(draft).toBe('Preserved')
})
test('actual screen wiring uses generation/native host keys, operation-bound secret acceptance and explicit manual read tickets', async () => {
    const [screen, editor, hook] = await Promise.all(['../../screens/ServiceAccountsScreen.tsx', './AccountEditor.tsx', './useAccounts.ts'].map(path => Bun.file(new URL(path, import.meta.url)).text()))
    expect(screen).toContain('key={`account-controls:${g}`}'); expect(screen).toContain('w.refresh(g, true)'); expect(screen).toContain('key={`once-key:${g}`}')
    expect(editor).toContain('key={`account-editor:${g}:${account?.id || \'create\'}`}'); expect(editor).toContain('w.controller.edit(g)'); expect(editor).toContain('target && !account'); expect(editor).toContain('acceptsAccountResult(settings, w.controller, op)'); expect(editor).toContain('w.acceptSecret(op, receipt.secret); setName(\'\'); setDescription(\'\'); setSelected([])')
    expect(hook).toContain('controller.beginRead(generation, manual)'); expect(hook).toContain('acceptsAccountResult(settings, controller, op)) setSecret(value)')
    expect(hook).toContain('controller.hide(); setVisible(false); setSecret(\'\')'); expect(hook).toContain('controller.finish(operation, definite)')
})
