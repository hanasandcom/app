import { describe, expect, mock, test } from 'bun:test'
import type { AppSettings } from '../../types'

mock.module('expo-crypto', () => ({ randomUUID: () => '11111111-1111-4111-8111-111111111111' }))
mock.module('../../lib/pinned-desktop-transport', () => ({ requestPinnedDesktopAgent: async () => { throw new Error('Pinned transport unavailable in scanner tests.') } }))
mock.module('../../lib/device-proof', () => ({ getDevicePublicJwk: async () => ({}), createDeviceProof: async () => ({ proof: 'test-proof', url: 'https://scanner.hanasand.com/api' }) }))
const { createScannerApi, scannerHasActiveWork } = await import('./api')

const settings = { apiBaseUrl: 'https://api.invalid/api', siteBaseUrl: 'https://hanasand.com', userId: 'test-user', authToken: 'test-token', selectedOrganizationId: 'org-hanasand', impersonationToken: '' } as AppSettings
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })

describe('native Security Scanner API', () => {
    test('loads the organization dashboard using the existing scanner contract', async () => {
        let request: { url: string; init?: RequestInit } | undefined
        const api = createScannerApi(settings, { baseUrl: 'https://scanner.invalid/api', transport: async (input, init) => { request = { url: String(input), init }; return json({ assets: [], engines: [], runs: [], findings: [], scannerError: null, tenableScans: [], tenableIntegration: null }) } })
        await api.getDashboard()
        expect(request?.url).toBe('https://scanner.invalid/api/v1/uvm/dashboard?organizationId=org-hanasand')
        expect(new Headers(request?.init?.headers).get('authorization')).toBe('Bearer test-token')
        expect(new Headers(request?.init?.headers).get('id')).toBe('test-user')
        expect(request?.init?.credentials).toBe('omit')
    })

    test('requires organization context and explicit scan authorization', async () => {
        expect(() => createScannerApi({ ...settings, selectedOrganizationId: 'personal' })).toThrow('Choose an organization workspace')
        const api = createScannerApi(settings, { baseUrl: 'https://scanner.invalid/api', transport: async () => json({}) })
        await expect(Promise.resolve().then(() => api.startScan('asset-1', 'nmap', false))).rejects.toThrow('Confirm that you are authorized')
    })

    test('refuses scanner writes while the app is impersonating another account', async () => {
        const api = createScannerApi({ ...settings, impersonationToken: 'delegated-token' }, { baseUrl: 'https://scanner.invalid/api', transport: async () => json({}) })
        await expect(Promise.resolve().then(() => api.startScan('asset-1', 'nmap', true))).rejects.toThrow('unavailable while viewing an impersonated account')
    })

    test('uses the existing Nmap, ZAP and cancel routes without putting credentials in the URL', async () => {
        const requests: Array<{ url: string; init?: RequestInit }> = []
        const api = createScannerApi(settings, { baseUrl: 'https://scanner.invalid/api', transport: async (input, init) => { requests.push({ url: String(input), init }); return json({ run: { id: 'run-1' } }) } })
        await api.startScan('asset/1', 'nmap', true)
        await api.startScan('asset-2', 'zap', true)
        await api.cancelRun('run-1')
        expect(requests.map(item => new URL(item.url).pathname)).toEqual([
            '/api/v1/uvm/assets/asset%2F1/scans',
            '/api/v1/uvm/assets/asset-2/zap-scans',
            '/api/v1/uvm/runs/run-1/cancel',
        ])
        expect(requests.every(item => !item.url.includes('test-token'))).toBe(true)
        expect(JSON.parse(String(requests[0].init?.body))).toMatchObject({ authorized: true, profile: 'tcp-top-1000' })
    })

    test('matches the existing engine, assessment, schedule and finding routes', async () => {
        const requests: Array<{ url: string; init?: RequestInit }> = []
        const api = createScannerApi(settings, { baseUrl: 'https://scanner.invalid/api', transport: async (input, init) => { requests.push({ url: String(input), init }); return json({ run: { id: 'run-1' }, assessment: { id: 'assessment-1' }, asset: { id: 'asset-1' } }) } })
        await api.startScan('asset-1', 'naabu', true)
        await api.startScan('asset-1', 'tenable-vm', true, 'template-1')
        await api.startScan('asset-1', 'gvm', true)
        await api.startScan('asset-1', 'testssl', true)
        await api.startScan('asset-1', 'nuclei', true)
        await api.startAssessment(['asset-1'], ['nmap', 'zap'], true)
        await api.cancelAssessment('assessment-1')
        await api.scheduleAsset('asset-1', { enabled: true, intervalMinutes: 1440, authorized: true })
        await api.updateFinding('finding-1', 'accepted_risk')
        expect(requests.map(item => `${item.init?.method || 'GET'} ${new URL(item.url).pathname}`)).toEqual([
            'POST /api/v1/uvm/assets/asset-1/naabu-scans',
            'POST /api/v1/uvm/assets/asset-1/tenable-scans',
            'POST /api/v1/uvm/integrations/gvm/runs',
            'POST /api/v1/uvm/assets/asset-1/testssl-scans',
            'POST /api/v1/uvm/assets/asset-1/nuclei-scans',
            'POST /api/v1/uvm/assessments',
            'POST /api/v1/uvm/assessments/assessment-1/cancel',
            'PUT /api/v1/uvm/assets/asset-1/schedule',
            'PUT /api/v1/uvm/findings/finding-1',
        ])
        expect(JSON.parse(String(requests[2].init?.body))).toMatchObject({ organizationId: 'org-hanasand', assetId: 'asset-1', authorized: true })
        expect(JSON.parse(String(requests[7].init?.body))).toMatchObject({ enabled: true, intervalMinutes: 1440, authorized: true, engines: [{ engine: 'nmap', profile: 'tcp-top-1000' }] })
        expect(JSON.parse(String(requests[8].init?.body))).toEqual({ status: 'accepted_risk', note: '' })
    })

    test('stops active-work polling when the run completes and keeps service failures visible', async () => {
        expect(scannerHasActiveWork({ assets: [], engines: [], runs: [{ status: 'queued' }], findings: [], scannerError: null, tenableScans: [], tenableIntegration: null } as never)).toBe(true)
        expect(scannerHasActiveWork({ assets: [], engines: [], runs: [{ status: 'succeeded' }], findings: [], scannerError: null, tenableScans: [], tenableIntegration: null } as never)).toBe(false)
        const api = createScannerApi(settings, { baseUrl: 'https://scanner.invalid/api', transport: async () => json({ message: 'Scanner API unavailable' }, 503) })
        await expect(api.getDashboard()).rejects.toThrow('Scanner API unavailable')
    })
})
