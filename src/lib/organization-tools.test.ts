import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import type { AppSettings } from '../types'
const calls: Array<{ settings: AppSettings; url: string; init: RequestInit }> = []
let response: () => Response = () => Response.json({})
mock.module('./api', () => ({
    apiFetch: async (settings: AppSettings, url: string, init: RequestInit) => {
        calls.push({ settings, url, init })
        return response()
    }
}))
const api = await import('./organization-tools')
const settings = {
    apiBaseUrl: 'https://api.hanasand.com/api',
    siteBaseUrl: 'https://hanasand.com',
    userId: 'synthetic-user',
    authToken: 'synthetic-token',
    selectedOrganizationId: 'other-org',
    impersonationToken: ''
} as AppSettings
const org = { id: 'synthetic/org', name: 'Synthetic Organization', role: 'owner', status: 'active' }
const secret = `hsk_${'a'.repeat(12)}_${'b'.repeat(48)}`
const key = {
    id: 'synthetic/key',
    organizationId: org.id,
    name: 'Synthetic integration',
    keyPrefix: 'a'.repeat(12),
    enabled: true,
    expiresAt: '2027-01-01',
    scopes: [{ method: 'GET', route: '/api/status', enabled: true }],
    secret,
    secretHash: 'never-render'
}
const signal = () => new AbortController().signal
const originalLog = console.log
let logged = false
beforeEach(() => {
    calls.length = 0
    logged = false
    console.log = () => {
        logged = true
    }
    response = () => Response.json({ organizationId: org.id, apiKeys: [key] })
})
afterAll(() => {
    console.log = originalLog
})

describe('organization API keys', () => {
    it('loads memberships directly from Identity while keeping key operations on core', async () => {
        response = () => Response.json({ organizations: [org] })
        expect(await api.loadToolOrganizations(settings, signal())).toEqual([org])
        expect(calls[0].url).toBe('https://identity.hanasand.com/api/organizations')
        expect(calls[0].settings).toBe(settings)
    })

    it('shows actionable service errors without raw authentication codes', async () => {
        for (const [status, message] of [[401, 'session could not be verified'], [403, 'do not have access'], [429, 'Wait a moment'], [502, 'temporarily unavailable']] as const) {
            response = () => Response.json({ error: 'invalid_session' }, { status })
            await expect(api.loadToolOrganizations(settings, signal())).rejects.toThrow(message)
        }
    })
    it('uses actual organization-scoped list contract and projects metadata without key material', async () => {
        const keys = await api.loadOrganizationApiKeys(settings, org, signal())
        expect(calls[0].url).toBe('https://api.hanasand.com/api/organizations/synthetic%2Forg/api-keys')
        expect(calls[0].settings.selectedOrganizationId).toBe(org.id)
        expect(settings.selectedOrganizationId).toBe('other-org')
        expect(calls[0].init.cache).toBe('no-store')
        expect(JSON.stringify(keys)).not.toContain(secret)
        expect(JSON.stringify(keys)).not.toContain('never-render')
        expect(logged).toBe(false)
    })
    it('creates only on explicit call with name-only payload and returns a one-time secret separately', async () => {
        response = () => Response.json({ apiKey: key, secret }, { status: 201 })
        expect(calls).toHaveLength(0)
        const created = await api.createOrganizationApiKey(settings, org, ' Synthetic integration ', signal())
        expect(created.secret).toBe(secret)
        expect(JSON.stringify(created.apiKey)).not.toContain(secret)
        expect(calls).toHaveLength(1)
        expect(calls[0].init.method).toBe('POST')
        expect(JSON.parse(String(calls[0].init.body))).toEqual({ name: 'Synthetic integration' })
        expect(logged).toBe(false)
    })
    it('revokes with DELETE scoped to the selected organization and allows inactive-organization cleanup', async () => {
        response = () => Response.json({ apiKey: { ...key, enabled: false } })
        const revoked = await api.revokeOrganizationApiKey(
            settings,
            { ...org, status: 'inactive' },
            key.id,
            signal()
        )
        expect(revoked.enabled).toBe(false)
        expect(calls[0].url).toBe(
            'https://api.hanasand.com/api/organizations/synthetic%2Forg/api-keys/synthetic%2Fkey'
        )
        expect(calls[0].init.method).toBe('DELETE')
        expect(calls[0].init.body).toBeUndefined()
    })
    it('blocks personal scope, non-managers, impersonation, inactive creation, invalid names and insecure URLs before mutation', async () => {
        for (const role of ['editor', 'reader', 'viewer', ''])
            await expect(
                api.createOrganizationApiKey(settings, { ...org, role }, 'Test', signal())
            ).rejects.toThrow('owners and administrators')
        await expect(
            api.createOrganizationApiKey(settings, { ...org, id: 'personal' }, 'Test', signal())
        ).rejects.toThrow('Select an organization')
        await expect(
            api.createOrganizationApiKey(
                { ...settings, impersonationToken: 'synthetic-view' },
                org,
                'Test',
                signal()
            )
        ).rejects.toThrow('own account')
        await expect(
            api.createOrganizationApiKey(settings, { ...org, status: 'inactive' }, 'Test', signal())
        ).rejects.toThrow('Reactivate')
        for (const name of ['', 'x', 'x'.repeat(81)])
            await expect(api.createOrganizationApiKey(settings, org, name, signal())).rejects.toThrow('2–80')
        await expect(
            api.createOrganizationApiKey(
                { ...settings, apiBaseUrl: 'http://api.example.test' },
                org,
                'Test',
                signal()
            )
        ).rejects.toThrow('HTTPS')
        expect(calls).toHaveLength(0)
    })
    it('rejects cross-organization data, malformed secret responses, and never retries creation automatically', async () => {
        response = () => Response.json({ organizationId: 'other-org', apiKeys: [key] })
        await expect(api.loadOrganizationApiKeys(settings, org, signal())).rejects.toThrow('did not match')
        response = () =>
            Response.json({ apiKey: { ...key, organizationId: 'other-org' }, secret }, { status: 201 })
        await expect(api.createOrganizationApiKey(settings, org, 'Test', signal())).rejects.toThrow(
            'could not be confirmed'
        )
        expect(calls).toHaveLength(2)
        response = () => Response.json({ apiKey: key, secret: 'invalid' }, { status: 201 })
        await expect(api.createOrganizationApiKey(settings, org, 'Test', signal())).rejects.toThrow(
            'Refresh the list'
        )
        expect(calls).toHaveLength(3)
        expect(logged).toBe(false)
    })
    it('never reveals a key from a response arriving after blur, background or unmount', () => {
        expect(api.mayRevealCreatedApiKey(true, true, true)).toBe(true)
        expect(api.mayRevealCreatedApiKey(false, true, true)).toBe(false)
        expect(api.mayRevealCreatedApiKey(true, false, true)).toBe(false)
        expect(api.mayRevealCreatedApiKey(true, true, false)).toBe(false)
    })
})
