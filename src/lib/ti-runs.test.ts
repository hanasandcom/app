import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import type { AppSettings } from '../types'

const calls: Array<{ settings: AppSettings; url: URL; init: RequestInit }> = []
let status = 200, payload: unknown
const originalTiBase = process.env.EXPO_PUBLIC_TI_SITE_URL
mock.module('./api', () => ({ apiFetch: async (settings: AppSettings, input: string, init: RequestInit) => {
    calls.push({ settings, url: new URL(input), init })
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
} }))
const runsApi = await import('./ti-runs')
const settings = { siteBaseUrl: 'https://hanasand.com', authToken: 'session', userId: 'user-1', impersonationToken: '', impersonatingUserId: '' } as AppSettings
const run = () => ({ id: 'run-1', sourceName: 'Synthetic source', sourceFamily: 'clear-web', status: 'completed', startedAt: '2026-10-24T10:00:00Z', finishedAt: '2026-10-24T10:01:00Z', nextRunAt: null, rows: 12, captures: 3, screenshots: 1, trigger: 'automated', hidden: 'must not escape parser' })
beforeEach(() => { calls.length = 0; status = 200; payload = { runs: [run()], page: 2, limit: 50, total: 61, previousPage: 1, nextPage: 3 } })
afterEach(() => { if (originalTiBase === undefined) delete process.env.EXPO_PUBLIC_TI_SITE_URL; else process.env.EXPO_PUBLIC_TI_SITE_URL = originalTiBase })

describe('native TI collection run contract', () => {
    it('uses the authenticated internal TI proxy with bounded page parameters', async () => {
        const page = await runsApi.loadTiCollectionRuns(settings, 2)
        expect(calls[0].url.origin).toBe('https://ti.hanasand.com')
        expect(calls[0].url.pathname).toBe('/api/ti/collection-runs')
        expect(calls[0].url.searchParams.get('page')).toBe('2')
        expect(calls[0].url.searchParams.get('limit')).toBe('50')
        expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer session', id: 'user-1', Accept: 'application/json' })
        expect(page.runs[0].id).toBe('run-1')
        expect(page.nextPage).toBe(3)
    })
    it('refuses missing sessions, impersonation, invalid page values, and insecure hosts', async () => {
        await expect(runsApi.loadTiCollectionRuns({ ...settings, authToken: '' }, 1)).rejects.toThrow('Sign in')
        await expect(runsApi.loadTiCollectionRuns({ ...settings, impersonatingUserId: 'target' }, 1)).rejects.toThrow('Switch back')
        await expect(runsApi.loadTiCollectionRuns(settings, 0)).rejects.toThrow('valid collection history page')
        process.env.EXPO_PUBLIC_TI_SITE_URL = 'http://ti.hanasand.com'
        await expect(runsApi.loadTiCollectionRuns(settings, 1)).rejects.toThrow('secure TI website')
        expect(calls).toHaveLength(0)
    })
    it('rejects invalid pagination, counters, and record status instead of showing partial data', async () => {
        payload = { runs: [run()], page: 1, limit: 50, total: 61, previousPage: null, nextPage: 3 }
        await expect(runsApi.loadTiCollectionRuns(settings, 2)).rejects.toThrow('invalid response')
        payload = { runs: [{ ...run(), status: 'surprise' }], page: 2, limit: 50, total: 61, previousPage: 1, nextPage: 3 }
        await expect(runsApi.loadTiCollectionRuns(settings, 2)).rejects.toThrow('invalid response')
        payload = { runs: [{ ...run(), rows: -1 }], page: 2, limit: 50, total: 61, previousPage: 1, nextPage: 3 }
        await expect(runsApi.loadTiCollectionRuns(settings, 2)).rejects.toThrow('invalid response')
    })
    it('reports server authorization and unavailable-service errors clearly', async () => {
        status = 403; payload = { error: { code: 'forbidden', message: 'Internal access required.' } }
        await expect(runsApi.loadTiCollectionRuns(settings, 1)).rejects.toThrow('requires access to internal pages')
        status = 503; payload = { error: { code: 'collection_runs_unavailable', message: 'Collection run history is temporarily unavailable.' } }
        await expect(runsApi.loadTiCollectionRuns(settings, 1)).rejects.toThrow('temporarily unavailable')
    })
    it('keeps an unrecognized upstream status visible as unknown', async () => {
        payload = { runs: [{ ...run(), status: 'unknown' }], page: 2, limit: 50, total: 61, previousPage: 1, nextPage: 3 }
        const response = await runsApi.loadTiCollectionRuns(settings, 2)
        expect(response.runs[0].status).toBe('unknown')
    })
})
