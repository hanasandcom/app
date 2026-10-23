import * as Crypto from 'expo-crypto'
import type { AppSettings } from '../../types'
import { apiFetch } from '../../lib/api'

export type ScannerEngineId = 'nmap' | 'naabu' | 'tenable-vm' | 'gvm' | 'zap' | 'testssl' | 'nuclei'
export type ScannerEngine = { id: string; name: string; status: 'available' | 'unavailable'; version: string | null; reason: string | null }
export type ScannerAsset = { id: string; hostname: string; verificationStatus: 'pending' | 'verified' | 'disabled'; verificationRecordName: string; verificationRecordValue: string; scanAuthorizedAt: string | null; authorizedAddresses: string[]; scheduleEnabled: boolean; intervalMinutes: number; nextRunAt: string | null; createdAt: string }
export type ScannerRun = { id: string; assetId: string; target: string; engine: string; profile: string; status: string; createdAt: string; startedAt: string | null; finishedAt: string | null; error: string | null }
export type ScannerFinding = { id: string; asset: string; title: string; severity: string; engine: string; status: string; updatedAt: string }
export type ScannerAssessment = { id: string; status: string; createdAt: string; startedAt: string | null; finishedAt: string | null; jobs: Array<{ id: string; asset: string; engine: string; status: string; error: string | null }> }
export type ScannerDashboard = { assets: ScannerAsset[]; engines: ScannerEngine[]; runs: ScannerRun[]; assessments: ScannerAssessment[]; findings: ScannerFinding[]; scannerError: string | null; tenableScans: Array<{ id: string; name: string; enabled: boolean }>; tenableIntegration: { configured: boolean; error: string | null } | null }

const baseUrl = 'https://scanner.hanasand.com/api'
type ScannerTransport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
const engineLabels: Record<ScannerEngineId, string> = { nmap: 'Nmap', naabu: 'Naabu', 'tenable-vm': 'Tenable VM', gvm: 'Greenbone', zap: 'OWASP ZAP', testssl: 'testssl.sh', nuclei: 'Nuclei' }
const activeStatuses = new Set(['queued', 'running', 'cancelling', 'pending'])

export function scannerHasActiveWork(dashboard: ScannerDashboard | null) {
    return (dashboard?.runs || []).some(run => activeStatuses.has(run.status.toLowerCase()))
}

export function scannerEngineLabel(id: string) { return engineLabels[id as ScannerEngineId] || id }

export function createScannerApi(settings: AppSettings, options: { transport?: ScannerTransport; baseUrl?: string } = {}) {
    const selectedOrganizationId = settings.selectedOrganizationId
    if (!selectedOrganizationId || selectedOrganizationId === 'personal') throw new Error('Choose an organization workspace to use Security Scanner.')
    const organizationId = selectedOrganizationId
    if (!settings.userId || !settings.authToken) throw new Error('Sign in to use Security Scanner.')

    async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
        const separator = path.includes('?') ? '&' : '?'
        const url = `${options.baseUrl || baseUrl}${path}${separator}organizationId=${encodeURIComponent(organizationId)}`
        const response = await apiFetch(settings, url, {
            method, cache: 'no-store', redirect: 'error', credentials: 'omit',
            headers: { Accept: 'application/json', Authorization: `Bearer ${settings.authToken}`, id: settings.userId, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }, (options.transport || fetch) as typeof fetch)
        const value = await response.json().catch(() => ({})) as T & { error?: string; message?: string }
        if (!response.ok) throw new Error(value.message || value.error || `Scanner request failed (${response.status}).`)
        return value
    }

    function requireOwnAccount() {
        if (settings.impersonationToken || settings.impersonatingUserId) throw new Error('Scanner changes are unavailable while viewing an impersonated account.')
    }

    return {
        getDashboard: () => request<ScannerDashboard>('/v1/uvm/dashboard'),
        createAsset: (hostname: string) => { requireOwnAccount(); return request<{ asset: ScannerAsset }>('/v1/uvm/assets', 'POST', { hostname }) },
        verifyAsset: (assetId: string) => { requireOwnAccount(); return request<{ asset: ScannerAsset }>(`/v1/uvm/assets/${encodeURIComponent(assetId)}/verify`, 'POST', {}) },
        scheduleAsset: (assetId: string, input: { enabled: boolean; intervalMinutes: number; authorized: boolean }) => { requireOwnAccount(); return request<{ asset: ScannerAsset }>(`/v1/uvm/assets/${encodeURIComponent(assetId)}/schedule`, 'PUT', { ...input, engines: input.enabled ? [{ engine: 'nmap', profile: 'tcp-top-1000' }] : [] }) },
        startScan: (assetId: string, engine: ScannerEngineId, authorized: boolean, tenableScanId?: string) => {
            requireOwnAccount()
            if (!authorized) throw new Error('Confirm that you are authorized to scan this asset first.')
            const requestId = Crypto.randomUUID()
            if (engine === 'nmap') return request<{ run: ScannerRun }>(`/v1/uvm/assets/${encodeURIComponent(assetId)}/scans`, 'POST', { requestId, authorized, profile: 'tcp-top-1000' })
            if (engine === 'naabu') return request<{ run: ScannerRun }>(`/v1/uvm/assets/${encodeURIComponent(assetId)}/naabu-scans`, 'POST', { requestId, authorized })
            if (engine === 'tenable-vm') {
                if (!tenableScanId) throw new Error('Choose an enabled Tenable VM scan template first.')
                return request<{ run: ScannerRun }>(`/v1/uvm/assets/${encodeURIComponent(assetId)}/tenable-scans`, 'POST', { requestId, scanId: tenableScanId, authorized })
            }
            if (engine === 'gvm') return request<{ run: ScannerRun }>('/v1/uvm/integrations/gvm/runs', 'POST', { requestId, organizationId, assetId, authorized })
            const suffix: Record<'zap' | 'testssl' | 'nuclei', string> = { zap: 'zap-scans', testssl: 'testssl-scans', nuclei: 'nuclei-scans' }
            return request<{ run: ScannerRun }>(`/v1/uvm/assets/${encodeURIComponent(assetId)}/${suffix[engine]}`, 'POST', { requestId, authorized })
        },
        cancelRun: (runId: string) => { requireOwnAccount(); return request<{ run: ScannerRun }>(`/v1/uvm/runs/${encodeURIComponent(runId)}/cancel`, 'POST', {}) },
        startAssessment: (assetIds: string[], engines: ScannerEngineId[], authorized: boolean) => {
            requireOwnAccount()
            if (!authorized) throw new Error('Confirm that you are authorized to scan these assets first.')
            return request<{ assessment: ScannerAssessment }>('/v1/uvm/assessments', 'POST', { requestId: Crypto.randomUUID(), assetIds, engines: engines.map(engine => ({ engine, ...(engine === 'nmap' ? { profile: 'tcp-top-1000' } : {}) })), authorized })
        },
        cancelAssessment: (assessmentId: string) => { requireOwnAccount(); return request<{ assessment: ScannerAssessment }>(`/v1/uvm/assessments/${encodeURIComponent(assessmentId)}/cancel`, 'POST', {}) },
        updateFinding: (findingId: string, status: string) => { requireOwnAccount(); return request(`/v1/uvm/findings/${encodeURIComponent(findingId)}`, 'PUT', { status, note: '' }) },
    }
}
