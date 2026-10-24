import { afterAll, beforeEach, expect, mock, test } from 'bun:test'
import type { AppSettings } from '../types'
import { automationSavePayload, normalizeAutomation, toAutomationDraft } from './automation-contract'
mock.module('expo-crypto', () => ({}))
mock.module('./pinned-desktop-transport', () => ({ requestPinnedDesktopAgent: async () => { throw new Error('Not used') } }))
mock.module('./device-proof', () => ({ getDevicePublicJwk: async () => ({ kty: 'EC', crv: 'P-256', x: 'synthetic-x', y: 'synthetic-y' }), createDeviceProof: async (_token: string, _method: string, url: string) => ({ proof: 'synthetic-proof', url }) }))
const api = await import('./api')
const settings = { apiBaseUrl: 'https://api.hanasand.com/api', siteBaseUrl: 'https://hanasand.com', userId: 'synthetic-user', authToken: 'synthetic-token', selectedOrganizationId: 'synthetic-org' } as AppSettings
const calls: Array<{ url: string; init: RequestInit }> = []
const item = { id: 'synthetic/check', name: 'Synthetic check', prompt: 'Synthetic', actionType: 'mail_health_check', monitoringType: 'fetch', targetUrl: 'https://example.test/health', followRedirects: false, timeoutSeconds: 30, retryCount: 0, notifyWarnings: true, notificationDestinations: ['https://discord.com/api/webhooks/synthetic/value'], modelName: 'https://discord.com/api/webhooks/synthetic/value', organizationId: 'synthetic-org' }
const originalFetch = globalThis.fetch
beforeEach(() => { calls.length = 0; globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => { calls.push({ url: String(url), init: init || {} }); return Response.json(init?.method ? { automation: item } : { automations: [item], canManageSystem: true }) }) as typeof fetch })
afterAll(() => { globalThis.fetch = originalFetch })
test('health list retains permissions, personal scope is explicit and requests keep native device proof', async () => {
    const all = await api.fetchAutomationOverview(settings)
    expect(all.canManageSystem).toBe(true)
    expect(all.automations[0].actionType).toBe('mail_health_check')
    expect(calls[0].url).toBe('https://api.hanasand.com/api/automations')
    await api.fetchAutomationOverview(settings, 'personal')
    expect(new URL(calls[1].url).searchParams.get('scope')).toBe('personal')
    const headers = new Headers(calls[0].init.headers)
    expect(headers.get('authorization')).toBe('Bearer synthetic-token')
    expect(headers.get('dpop')).toBe('synthetic-proof')
    expect(headers.get('x-organization-id')).toBe('synthetic-org')
    expect(calls[0].init.credentials).toBe('omit')
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal)
    expect(calls[0].init.signal?.aborted).toBe(false)
})
test('create/update use exact existing contracts and preserve monitoring options in PUT', async () => {
    const draft = toAutomationDraft(normalizeAutomation(item)!)
    const payload = automationSavePayload({ ...draft, name: 'Renamed' })
    await api.updateAutomation(settings, item.id, payload)
    expect(calls[0].url).toBe('https://api.hanasand.com/api/automations/synthetic%2Fcheck')
    expect(calls[0].init.method).toBe('PUT')
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ actionType: 'mail_health_check', targetUrl: item.targetUrl, monitoringType: 'fetch', followRedirects: false, retryCount: 0, timeoutSeconds: 30, notifyWarnings: true, notificationDestinations: item.notificationDestinations, organizationId: item.organizationId })
    await api.createAutomation(settings, payload)
    expect(calls[1].init.method).toBe('POST')
    expect(calls[1].url).toBe('https://api.hanasand.com/api/automations')
})
