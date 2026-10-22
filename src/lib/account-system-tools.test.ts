import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { AppSettings } from '../types'
const calls: Array<{ settings: AppSettings; path: string; init: RequestInit }> = []
let response: unknown = {}
let failure: Error | null = null
mock.module('./profile-api', () => ({ accountRequest: async (settings: AppSettings, path: string, init: RequestInit) => { calls.push({ settings, path, init }); if (failure) throw failure; return response } }))
const tools = await import('./account-system-tools')
const settings = { apiBaseUrl: 'https://api.example.test/api', userId: 'synthetic-user', authToken: 'synthetic-token', impersonationToken: '', selectedOrganizationId: 'personal' } as AppSettings
const signal = () => new AbortController().signal
beforeEach(() => { calls.length = 0; response = {}; failure = null })

describe('native billing, host updates and SSH-access tasks', () => {
    it('reads subscription and real quota semantics without treating absent entitlement as unlimited', async () => {
        response = { subscription: { planId: 'monitoring', status: 'active', currentPeriodEnd: '2026-11-01', cancelAtPeriodEnd: true, secret: 'not-rendered' }, entitlements: [{ planId: 'monitoring', features: ['alerts'] }], quotas: [{ key: 'searchesPerDay', limit: null, used: 0, remaining: null }, { key: 'watchTerms', limit: 10, used: 2, remaining: 8 }] }
        const data = await tools.loadAccountSubscription(settings, signal())
        expect(data.subscription?.cancelAtPeriodEnd).toBe(true)
        expect(data.quotas[0]).toMatchObject({ limit: null, used: 0, remaining: null })
        expect(data.quotas[1]).toMatchObject({ limit: 10, used: 2, remaining: 8 })
        expect(JSON.stringify(data)).not.toContain('not-rendered')
        expect(calls[0].path).toBe('billing/subscription')
        expect(calls[0].settings).toBe(settings)
        expect(calls[0].init.signal).toBeInstanceOf(AbortSignal)
    })
    it('distinguishes no subscription from malformed data and propagates authorization failures', async () => {
        response = { subscription: null, entitlements: [], quotas: [] }
        expect((await tools.loadAccountSubscription(settings, signal())).subscription).toBeNull()
        response = {}
        await expect(tools.loadAccountSubscription(settings, signal())).rejects.toThrow('unavailable')
        failure = new Error('Active organization access required')
        await expect(tools.loadAccountSubscription(settings, signal())).rejects.toThrow('organization access')
    })
    it('creates a portal only on explicit call and permits only the exact secure Stripe billing host', async () => {
        expect(calls).toHaveLength(0)
        response = { url: 'https://billing.stripe.com/p/session/synthetic-session' }
        expect(await tools.createAccountBillingPortal(settings, signal())).toBe('https://billing.stripe.com/p/session/synthetic-session')
        expect(calls[0].path).toBe('billing/portal')
        expect(calls[0].init.method).toBe('POST')
        for (const url of ['http://billing.stripe.com/p/session/x', 'https://billing.stripe.com.attacker.test/x', 'https://user:secret@billing.stripe.com/x', 'javascript:alert(1)', 'https://checkout.stripe.com/x', 'https://billing.stripe.com:8443/x']) expect(() => tools.safeBillingPortalUrl(url)).toThrow('invalid management')
        await expect(tools.createAccountBillingPortal({ ...settings, impersonationToken: 'synthetic-view' }, signal())).rejects.toThrow('own account')
        expect(calls).toHaveLength(1)
    })
    it('uses exact two-host routes and rejects mismatched host responses', async () => {
        for (const host of ['inspur', 'ovhcloud'] as const) {
            response = { host, status: { status: 'pending', checked_at: '2026-10-22T20:00:00Z', policy: { non_security_delay_hours: 72, repository_verification: 'Signed Ubuntu repositories' }, pending_updates: [{ package: 'synthetic-package', version: '1.2', security: true, first_seen: 100 }], installed_packages: [{ package: 'other', version: '1' }] }, history: [{ run_id: 'run', status: 'failed', error: 'Synthetic failure', packages: [], occurred_at: '2026-10-21' }] }
            const data = await tools.loadHostUpdates(settings, host, signal())
            expect(data.host).toBe(host)
            expect(data.pending[0].security).toBe(true)
            expect(data.history[0].error).toBe('Synthetic failure')
            expect(calls.at(-1)?.path).toBe(`system/updates?host=${host}`)
        }
        await expect(tools.loadHostUpdates(settings, 'inspur', signal())).rejects.toThrow('unavailable')
    })
    it('keeps missing package timing unknown and respects server delay and security policy', () => {
        const now = 100 * 3600000
        const item = { name: 'package', version: '1', repository: '', origin: '', security: false, firstSeen: 3600 }
        expect(tools.pendingUpdateTiming(item, 72, now)).toBe('Ready under the reported policy')
        expect(tools.pendingUpdateTiming({ ...item, firstSeen: 99 * 3600 }, 72, now)).toBe('1 of 72 hours elapsed')
        expect(tools.pendingUpdateTiming({ ...item, firstSeen: null }, 72, now)).toContain('Waiting')
        expect(tools.pendingUpdateTiming({ ...item, firstSeen: 101 * 3600 }, 72, now)).toContain('Waiting')
        expect(tools.pendingUpdateTiming(item, null, now)).toContain('Waiting')
        expect(tools.pendingUpdateTiming({ ...item, security: true }, 72, now)).toContain('immediate')
    })
    it('projects host metadata and user key counts without exposing certificate/private-key fields', async () => {
        response = { hosts: [{ id: 'inspur', name: 'Synthetic host', status: 'online', address: '203.0.113.1', username: 'synthetic', hostname: 'host', operatingSystem: 'Ubuntu', private_key: 'never-render' }], users: [{ id: 'synthetic-user', name: 'Example', username: 'example', keyCount: 2, public_key: 'never-render' }] }
        const data = await tools.loadHostAccess(settings, signal())
        expect(data.hosts[0].status).toBe('online')
        expect(data.users[0].keyCount).toBe(2)
        expect(JSON.stringify(data)).not.toContain('never-render')
        expect(calls[0].path).toBe('host-overview')
        response = { hosts: [{ id: 'other', status: 'garbled' }], users: [] }
        expect((await tools.loadHostAccess(settings, signal())).hosts[0].status).toBe('unknown')
        await expect(tools.loadHostAccess({ ...settings, impersonationToken: 'synthetic-view' }, signal())).rejects.toThrow('own account')
        expect(calls).toHaveLength(2)
    })
    it('resets account tool identity across users, organization changes and impersonation', () => {
        for (const change of [{ userId: 'other' }, { selectedOrganizationId: 'other' }, { impersonationToken: 'other' }, { apiBaseUrl: 'https://other.example.test/api' }]) expect(tools.accountToolKey({ ...settings, ...change })).not.toBe(tools.accountToolKey(settings))
    })
})
