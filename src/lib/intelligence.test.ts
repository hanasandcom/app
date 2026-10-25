import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { AppSettings } from '../types'
const calls: Array<{ settings: AppSettings; url: URL; init: RequestInit }> = []
let payload: unknown = {}, status = 200
mock.module('./api', () => ({ apiFetch: async (settings: AppSettings, input: string, init: RequestInit) => { calls.push({ settings, url: new URL(input), init }); if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError'); return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } }) } }))
const intel = await import('./intelligence')
const settings = { siteBaseUrl: 'https://hanasand.com', apiBaseUrl: 'https://api.hanasand.com/api', authToken: 'synthetic-session', userId: 'synthetic-user', impersonationToken: '', selectedOrganizationId: 'personal' } as AppSettings
const filter = { scope: 'global', tenantId: '', status: '', query: '' } as const
const signal = () => new AbortController().signal
const record = () => ({ id: 'record-1', incidentId: 'incident-1', captureId: 'capture-1', sourceId: 'source-1', actorName: 'Synthetic actor', status: 'unresolved_reference', stages: { collection: '2026-10-22T10:00:00Z' }, timestampAnomalies: ['timezone_missing:publication'], reportReferences: [], latencies: { reportToDeliveredSeconds: undefined }, provenance: { collection: { event: 'server_first_seen', evidencePath: 'capture.collectedAt', secret: 'do-not-render' } }, sources: [{ title: 'Source', url: 'https://example.test/report' }], secret: 'do-not-render' })
const snapshot = () => ({ generatedAt: '2026-10-22T12:00:00Z', items: [record()], summary: { recordCount: 2, completeCount: 0, reviewedCoverage: 0 }, page: { total: 2, nextCursor: '50' }, metrics: { byStage: [{ name: 'reportToDeliveredSeconds', sampleSize: 0, medianSeconds: null, p95Seconds: null, p99Seconds: null }], bySourceFamily: [], byActor: [] }, quality: { fields: [{ name: 'first_report', coverage: 0, presentCount: 0, missingCount: 2 }], issues: [{ name: 'timezone_missing:publication', count: 1 }], bySourceClass: [{ name: 'public', recordCount: 2, missing: { first_report: 2 }, issues: { 'timezone_missing:publication': 1 } }] } })
const evidence = { role: 'publisher', timestamp: '2026-10-22T10:00:00+02:00', referenceUrl: 'https://example.test/report', evidencePath: 'article.time[datetime]', referenceTitle: 'Synthetic report' } as const
beforeEach(() => { calls.length = 0; payload = {}; status = 200 })

describe('native intelligence routes and contracts', () => {
    it('uses the public actors collection and numbered nextPage, never the opaque backend cursor', async () => {
        payload = { data: [{ id: 'actor-1', canonicalName: 'Synthetic actor', aliases: ['Alias'], confidence: 0.8, evidenceCount: 2, sourceIds: ['source-1'], captureIds: ['capture-1'], reviewState: 'reviewed', firstSeenAt: '2026-10-20T12:00:00Z', lastSeenAt: '2026-10-22T12:00:00Z', updatedAt: '2026-10-22T12:01:00Z', secret: 'do-not-render' }], pagination: { page: 2, limit: 50, total: 101, nextPage: 3, nextCursor: 'opaque-backend-cursor' } }
        const data = await intel.loadActorProfiles(settings, { query: '  Synthetic actor  ', page: 2 }, signal())
        expect(calls[0].url.origin).toBe('https://api.hanasand.com')
        expect(calls[0].url.pathname).toBe('/api/v1/actors')
        expect([...calls[0].url.searchParams]).toEqual([['limit', '50'], ['page', '2'], ['q', 'Synthetic actor']])
        expect(data.nextPage).toBe(3)
        expect(data.items[0]).toMatchObject({ name: 'Synthetic actor', confidence: 0.8, evidenceCount: 2, aliases: ['Alias'], lastSeenAt: '2026-10-22T12:00:00Z' })
        expect(JSON.stringify(data)).not.toContain('do-not-render')
        expect(calls[0].settings).toBe(settings)
        expect(calls[0].init.credentials).toBe('omit')
        expect(calls[0].init.signal).toBeInstanceOf(AbortSignal)
        expect(calls[0].init.headers).toBeUndefined()
    })
    it('distinguishes empty actor collections from invalid payloads and prevents backwards pagination', async () => {
        payload = { data: [], pagination: { page: 1, total: 0, nextPage: null } }
        expect((await intel.loadActorProfiles(settings, { query: '', page: 1 }, signal())).items).toEqual([])
        for (const body of [{}, { data: [], pagination: { page: 1, total: 5, nextPage: 1 } }, { data: [{ canonicalName: 'Missing ID' }], pagination: { page: 1, total: 1, nextPage: null } }]) {
            payload = body
            await expect(intel.loadActorProfiles(settings, { query: '', page: 1 }, signal())).rejects.toThrow('invalid')
        }
        await expect(intel.loadActorProfiles(settings, { query: '', page: 0 }, signal())).rejects.toThrow('valid profile page')
        await expect(intel.loadActorProfiles(settings, { query: 'x'.repeat(201), page: 1 }, signal())).rejects.toThrow('200 characters')
    })
    it('uses timeliness scope, queue and exact returned cursor without conflating global and organization', async () => {
        payload = snapshot()
        const data = await intel.loadDeliveryHealth(settings, { scope: 'tenant', tenantId: 'org-123', status: 'unresolved_reference', query: 'Synthetic actor' }, '0', signal())
        expect(calls[0].url.origin).toBe('https://hanasand.com')
        expect(calls[0].url.pathname).toBe('/api/ti/timeliness')
        expect([...calls[0].url.searchParams]).toEqual([['scope', 'tenant'], ['tenantId', 'org-123'], ['limit', '50'], ['q', 'Synthetic actor'], ['status', 'unresolved_reference'], ['cursor', '0']])
        expect(data.nextCursor).toBe('50')
        expect(data.items[0].stages.first_report).toBe('')
        expect(data.items[0].stages.delivered).toBe('')
        expect(data.items[0].provenance.collection.event).toBe('server_first_seen')
        expect(data.items[0].anomalies).toEqual(['timezone_missing:publication'])
        expect(data.metrics.stages[0]).toMatchObject({ sampleSize: 0, medianSeconds: null, p95Seconds: null, p99Seconds: null })
        expect(data.quality.sourceClasses[0].missing.first_report).toBe(2)
        expect(JSON.stringify(data)).not.toContain('do-not-render')
        await intel.loadDeliveryHealth(settings, { ...filter, tenantId: 'must-not-leak' }, null, signal())
        expect(calls[1].url.searchParams.has('tenantId')).toBe(false)
    })
    it('rejects invalid scopes and malformed or repeated-cursor delivery responses', async () => {
        await expect(intel.loadDeliveryHealth(settings, { ...filter, scope: 'tenant', tenantId: '' }, null, signal())).rejects.toThrow('valid tenant')
        expect(calls).toHaveLength(0)
        payload = snapshot()
        await expect(intel.loadDeliveryHealth(settings, filter, '50', signal())).rejects.toThrow('invalid response')
        payload = { ...snapshot(), items: [{ ...record(), status: 'made_up' }] }
        await expect(intel.loadDeliveryHealth(settings, filter, null, signal())).rejects.toThrow('invalid')
        payload = { ...snapshot(), items: [] , page: { total: 0, nextCursor: null } }
        expect((await intel.loadDeliveryHealth(settings, filter, null, signal())).items).toEqual([])
    })
    it('only writes explicitly submitted validated evidence and preserves the published timezone', async () => {
        expect(calls).toHaveLength(0)
        payload = { item: record(), created: true }
        const result = await intel.recordDeliveryEvidence(settings, { ...filter, scope: 'tenant', tenantId: 'org-123' }, 'record-1', evidence, signal())
        expect(result.created).toBe(true)
        expect(calls).toHaveLength(1)
        expect(calls[0].init.method).toBe('POST')
        expect(calls[0].url.origin).toBe('https://hanasand.com')
        expect(calls[0].url.pathname).toBe('/api/ti/timeliness')
        expect(calls[0].url.searchParams.get('tenantId')).toBe('org-123')
        expect(JSON.parse(calls[0].init.body as string)).toEqual({ recordId: 'record-1', ...evidence })
        payload = { item: { ...record(), id: 'different-record' }, created: true }
        await expect(intel.recordDeliveryEvidence(settings, filter, 'record-1', evidence, signal())).rejects.toThrow('different record')
    })
    it('rejects private or credential-bearing references, missing timezone and invalid evidence paths before a write', async () => {
        for (const referenceUrl of ['https://localhost/report', 'https://example.local/report', 'https://127.0.0.1/report', 'https://10.0.0.1/report', 'https://192.168.2.2/report', 'https://[::1]/report', 'https://user:password@example.test/report', 'https://example.test/?api_key=secret', 'javascript:alert(1)']) {
            await expect(intel.recordDeliveryEvidence(settings, filter, 'record-1', { ...evidence, referenceUrl }, signal())).rejects.toThrow()
        }
        expect(() => intel.validateReportEvidence('record-1', { ...evidence, timestamp: '2026-10-22T10:00:00' })).toThrow('timezone')
        expect(() => intel.validateReportEvidence('record-1', { ...evidence, evidencePath: '<script>' })).toThrow('source-field path')
        expect(calls).toHaveLength(0)
        expect(intel.validateReportEvidence('record-1', { ...evidence, referenceUrl: 'http://example.test/report' }).referenceUrl).toBe('http://example.test/report')
        expect(intel.intelligenceSourceUrl('javascript:alert(1)')).toBeNull()
        expect(intel.intelligenceSourceUrl('https://user:secret@example.test/report')).toBeNull()
    })
    it('propagates authorization and cancellation and prevents wrong-account impersonation', async () => {
        status = 403; payload = { error: { code: 'timeliness_forbidden', message: 'Timeliness operations require an analyst role' } }
        await expect(intel.loadDeliveryHealth(settings, filter, null, signal())).rejects.toThrow('analyst role')
        status = 404; payload = { message: 'Route not found' }
        await expect(intel.loadActorProfiles(settings, { query: '', page: 1 }, signal())).rejects.toThrow('temporarily unavailable')
        status = 200
        const controller = new AbortController(); controller.abort()
        await expect(intel.loadActorProfiles(settings, { query: '', page: 1 }, controller.signal)).rejects.toThrow('Aborted')
        calls.length = 0
        await expect(intel.loadActorProfiles({ ...settings, impersonationToken: 'synthetic-view' }, { query: '', page: 1 }, signal())).rejects.toThrow('own account')
        await expect(intel.loadActorProfiles({ ...settings, authToken: '' }, { query: '', page: 1 }, signal())).rejects.toThrow('Sign in')
        expect(calls).toHaveLength(0)
        for (const change of [{ userId: 'other' }, { selectedOrganizationId: 'other' }, { siteBaseUrl: 'https://other.example.test' }, { impersonationToken: 'other' }]) expect(intel.intelligenceAccountKey({ ...settings, ...change })).not.toBe(intel.intelligenceAccountKey(settings))
    })
    it('deduplicates overlapping pages by identity without losing earlier loaded records', () => {
        expect(intel.mergeIntelligencePage([{ id: 'a', value: 1 }, { id: 'b', value: 2 }], [{ id: 'b', value: 3 }, { id: 'c', value: 4 }])).toEqual([{ id: 'a', value: 1 }, { id: 'b', value: 3 }, { id: 'c', value: 4 }])
    })
    it('orders latest activity by most recently observed evidence and keeps missing dates last', () => {
        const rows = [
            { id: 'older', lastSeenAt: '2026-10-22T10:00:00Z' },
            { id: 'newer', lastSeenAt: '2026-10-22T12:00:00Z' },
            { id: 'unknown', lastSeenAt: '' },
            { id: 'invalid', lastSeenAt: 'not-a-date' },
        ]
        expect(intel.sortActorActivity(rows).map(item => item.id)).toEqual(['newer', 'older', 'unknown', 'invalid'])
    })
})
