import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { AppSettings } from '../types'
const calls: Array<{ settings: AppSettings; url: string; init: RequestInit }> = []
let respond: () => Response | Promise<Response> = () => Response.json({})
mock.module('./api', () => ({ apiFetch: async (settings: AppSettings, url: string, init: RequestInit) => {
    calls.push({ settings, url, init }); return respond()
} }))
const api = await import('./rate-limits')
const settings = { apiBaseUrl: 'https://api.hanasand.com/api', siteBaseUrl: 'https://hanasand.com',
    userId: 'synthetic-user', authToken: 'synthetic-token', selectedOrganizationId: 'unrelated',
    impersonationToken: '', impersonatingUserId: '' } as AppSettings
const organizations = [{ id: api.internalOrganizationId, name: 'Hanasand', status: 'active', role: 'editor' }]
const limits = { perSecond: null, perMinute: 60, perHour: 1000, perDay: 10000 }
const policy = { enabled: true, defaults: {
    anonymous: { windowMs: 1000, maxRequests: 3 }, authenticated: { windowMs: 60000, maxRequests: 120 }, internal: { windowMs: 86400000, maxRequests: 1000000 }
}, overrides: [{ id: 'keep-id', enabled: false, method: 'GET', route: '/api/custom', scope: 'internal' as const, windowMs: 1500, maxRequests: 8 }], updatedAt: '2026-10-23', updatedBy: 'synthetic-admin' }
const draft = { name: 'Client', ownerId: 'synthetic-owner', description: 'Synthetic test only', tier: 'custom',
    enabled: true, expiresAt: '2027-12-31T23:59:59.999Z', scopes: [{ id: 'keep-scope-id', enabled: false, method: 'POST', route: '/mill', limits }] }
const key = { ...draft, id: 'key/one', organizationId: null, keyPrefix: 'safe-prefix', createdAt: '2026-10-23', updatedAt: '2026-10-23', lastUsedAt: null }
const signal = () => new AbortController().signal
beforeEach(() => { calls.length = 0; respond = () => Response.json({}) })

describe('global rate limit authority', () => {
    it('requires the fixed active internal organization and a writer role', () => {
        for (const role of ['owner', 'admin', 'editor']) expect(api.canWriteRates(settings, [{ ...organizations[0], role }])).toBe(true)
        for (const role of ['reader', 'member', 'viewer', '', 'Owner']) expect(api.canWriteRates(settings, [{ ...organizations[0], role }])).toBe(false)
        expect(api.canWriteRates(settings, [{ ...organizations[0], id: 'unrelated' }])).toBe(false)
        expect(api.canWriteRates(settings, [{ ...organizations[0], status: 'inactive' }])).toBe(false)
        expect(api.canWriteRates(settings, [])).toBe(false)
        expect(api.canWriteRates({ ...settings, impersonationToken: 'synthetic-impersonation' }, organizations)).toBe(false)
        expect(api.canWriteRates({ ...settings, impersonatingUserId: 'synthetic-target' }, organizations)).toBe(false)
    })
    it('blocks unauthorized helpers before any write request', async () => {
        await expect(api.saveRatePolicy(settings, [], policy, signal())).rejects.toThrow('active Hanasand')
        await expect(api.saveRateKey({ ...settings, impersonatingUserId: 'other' }, organizations, draft, signal())).rejects.toThrow('active Hanasand')
        await expect(api.deleteRateKey(settings, [], 'one', signal())).rejects.toThrow('active Hanasand')
        expect(calls).toHaveLength(0)
    })
    it('rejects stale, hidden, busy and no-longer-authorized confirmations', () => {
        expect(api.validRateConfirmation(3, 3, true, false, true)).toBe(true)
        expect(api.validRateConfirmation(2, 3, true, false, true)).toBe(false)
        expect(api.validRateConfirmation(3, 3, false, false, true)).toBe(false)
        expect(api.validRateConfirmation(3, 3, true, true, true)).toBe(false)
        expect(api.validRateConfirmation(3, 3, true, false, false)).toBe(false)
    })
    it('never reveals an asynchronous secret after blur, background, scope change or unmount', () => {
        expect(api.mayRevealRateSecret(4, 4, true, true, true)).toBe(true)
        expect(api.mayRevealRateSecret(4, 5, true, true, true)).toBe(false)
        expect(api.mayRevealRateSecret(4, 4, false, true, true)).toBe(false)
        expect(api.mayRevealRateSecret(4, 4, true, false, true)).toBe(false)
        expect(api.mayRevealRateSecret(4, 4, true, true, false)).toBe(false)
        // Returning to the foreground cannot revive an operation from an older epoch.
        expect(api.mayRevealRateSecret(4, 6, true, true, true)).toBe(false)
    })
    it('scopes account drafts to credentials and either impersonation field, independently of workspace selection', () => {
        const base = api.rateAccountScope(settings)
        expect(api.rateAccountScope({ ...settings, selectedOrganizationId: 'new' })).toBe(base)
        for (const change of [{ authToken: 'new' }, { userId: 'new' }, { impersonationToken: 'new' }, { impersonatingUserId: 'new' }]) expect(api.rateAccountScope({ ...settings, ...change })).not.toBe(base)
    })
})
describe('policy and client scope preservation', () => {
    it('preserves every policy scope, override ID and disabled flag, without writable metadata', async () => {
        respond = () => Response.json({ settings: policy })
        expect(await api.saveRatePolicy(settings, organizations, policy, signal())).toEqual(policy)
        expect(calls[0].url).toBe('https://api.hanasand.com/api/rate-limit/settings')
        expect(calls[0].init.method).toBe('PUT')
        expect(calls[0].init.cache).toBe('no-store')
        expect(new Headers(calls[0].init.headers).get('id')).toBe('synthetic-user')
        const payload = JSON.parse(String(calls[0].init.body))
        expect(payload).toEqual({ enabled: true, defaults: policy.defaults, overrides: policy.overrides })
        expect(calls[0].settings).toBe(settings)
    })
    it('rejects clamping, fractional numbers, duplicate overrides and invalid routes before sending', async () => {
        for (const value of [0, 999, 86400001, 1.5, Number.NaN]) {
            expect(() => api.policyPayload({ ...policy, defaults: { ...policy.defaults, anonymous: { windowMs: value, maxRequests: 5 } } })).toThrow()
        }
        expect(() => api.policyPayload({ ...policy, overrides: [...policy.overrides, { ...policy.overrides[0], id: 'different' }] })).toThrow('duplicate')
        expect(() => api.policyPayload({ ...policy, overrides: [{ ...policy.overrides[0], route: '/mill' }] })).toThrow('/api')
        expect(() => api.positiveInteger('1e2', 'Number')).toThrow()
        expect(() => api.positiveInteger('1.2', 'Number')).toThrow()
        expect(calls).toHaveLength(0)
    })
    it('loads the real settings/catalog/preset envelope without manufactured defaults', async () => {
        respond = () => Response.json({ settings: policy, routes: [{ method: 'GET', route: '/api/test' }], tierPresets: [{ id: 'custom', label: 'Custom', description: '', defaultLimits: limits }] })
        const data = await api.loadRateConfiguration(settings, signal())
        expect(data.settings).toEqual(policy)
        expect(data.tierPresets[0].defaultLimits.perSecond).toBeNull()
        respond = () => Response.json({ settings: {} })
        await expect(api.loadRateConfiguration(settings, signal())).rejects.toThrow('incomplete')
    })
    it('roundtrips public route scopes and blank/unlimited limits independently of tier', () => {
        expect(api.keyPayload(draft)).toEqual(draft)
        expect(api.nullableLimit('')).toBeNull()
        expect(api.nullableLimit('5')).toBe(5)
        expect(() => api.nullableLimit('0')).toThrow()
        expect(() => api.keyPayload({ ...draft, scopes: [...draft.scopes, { ...draft.scopes[0], id: 'two' }] })).toThrow('duplicate')
        expect(() => api.keyPayload({ ...draft, scopes: [] })).toThrow('at least one')
        expect(() => api.keyPayload({ ...draft, expiresAt: 'invalid' })).toThrow('expiry')
    })
})
describe('client key service boundaries', () => {
    it('projects key summaries without secret material and keeps one-time creation separate', async () => {
        respond = () => Response.json({ apiKeys: [{ ...key, secret: 'never-in-list', secret_hash: 'never-in-list' }] })
        const listed = await api.loadRateKeys(settings, signal())
        expect(listed).toEqual([key])
        expect(JSON.stringify(listed)).not.toContain('never-in-list')
        calls.length = 0
        respond = () => Response.json({ apiKey: { ...key, secret: 'never-in-summary' }, secret: 'one-time-secret' }, { status: 201 })
        const result = await api.saveRateKey(settings, organizations, draft, signal())
        expect(result.apiKey).toEqual(key)
        expect(result.secret).toBe('one-time-secret')
        expect(calls).toHaveLength(1)
        expect(calls[0].init.method).toBe('POST')
        expect(JSON.parse(String(calls[0].init.body))).toEqual(draft)
        expect(new Headers(calls[0].init.headers).has('Idempotency-Key')).toBe(false)
    })
    it('updates the exact encoded key, preserves scope limits and never exposes a response secret', async () => {
        respond = () => Response.json({ apiKey: key, secret: 'must-not-reveal' })
        const result = await api.saveRateKey(settings, organizations, draft, signal(), key.id)
        expect(result.secret).toBeNull()
        expect(calls[0].url).toEndWith('/rate-limit/keys/key%2Fone')
        expect(calls[0].init.method).toBe('PUT')
        expect(JSON.parse(String(calls[0].init.body)).scopes).toEqual(draft.scopes)
    })
    it('deletes rather than inventing a revoke or reset endpoint', async () => {
        respond = () => Response.json({ ok: true })
        await api.deleteRateKey(settings, organizations, key.id, signal())
        expect(calls[0].init.method).toBe('DELETE')
        expect(calls[0].init.body).toBeUndefined()
    })
    it('never retries a lost creation response or authorization/conflict failure', async () => {
        respond = () => { throw new Error('Synthetic lost connection') }
        await expect(api.saveRateKey(settings, organizations, draft, signal())).rejects.toThrow('lost connection')
        expect(calls).toHaveLength(1)
        for (const status of [401, 403, 409, 500]) {
            calls.length = 0
            respond = () => Response.json({ error: 'raw-internal-detail' }, { status })
            await expect(api.saveRateKey(settings, organizations, draft, signal())).rejects.toThrow()
            expect(calls).toHaveLength(1)
        }
    })
    it('uses owner IDs and honors omitted emails without persisting additional account fields', async () => {
        respond = () => Response.json([{ id: 'one', name: 'Synthetic One', active: true, secret: 'discard' }, { id: 'two', username: 'two', email: 'two@example.invalid' }])
        expect(await api.loadRateOwners(settings, signal())).toEqual([{ id: 'one', name: 'Synthetic One', email: '' }, { id: 'two', name: 'two', email: 'two@example.invalid' }])
        expect(calls[0].url).toEndWith('/api/users')
        respond = () => Response.json({}, { status: 404 })
        expect(await api.loadRateOwners(settings, signal())).toEqual([])
    })
})
