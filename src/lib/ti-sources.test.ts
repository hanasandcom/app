import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import type { AppSettings } from '../types'

const calls: Array<{ url: URL; init: RequestInit }> = []
let status = 200, payload: unknown
const originalTiBase = process.env.EXPO_PUBLIC_TI_SITE_URL
mock.module('./api', () => ({ apiFetch: async (_settings: AppSettings, input: string, init: RequestInit) => {
    calls.push({ url: new URL(input), init })
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
} }))
const api = await import('./ti-sources')
const settings = { siteBaseUrl: 'https://hanasand.com', authToken: 'session', userId: 'user-1', impersonationToken: '', impersonatingUserId: '' } as AppSettings
const source = () => ({ id: 'source-1', name: 'Synthetic feed', family: 'rss', type: 'feed', accessMethod: 'public_rss', status: 'active', healthState: 'healthy', url: 'https://example.test/rss', domain: 'example.test', lastRunAt: '2026-10-24T10:00:00Z', lastUsefulAt: null, nextRunAt: null, productiveCycleCount: 2, customerMatchCount: 1, executable: true, cadenceMinutes: 60, domains: ['example.test'] })
beforeEach(() => { calls.length = 0; status = 200; payload = { sources: [source()], page: 2, limit: 25, total: 51, previousPage: 1, nextPage: 3 } })
afterEach(() => { if (originalTiBase === undefined) delete process.env.EXPO_PUBLIC_TI_SITE_URL; else process.env.EXPO_PUBLIC_TI_SITE_URL = originalTiBase })

describe('native TI source contract', () => {
    it('uses the authenticated internal proxy with bounded pagination and search', async () => {
        const result = await api.loadTiSources(settings, 2, 'example')
        expect(calls[0].url.origin).toBe('https://ti.hanasand.com')
        expect(calls[0].url.pathname).toBe('/api/ti/sources')
        expect(calls[0].url.searchParams.get('page')).toBe('2')
        expect(calls[0].url.searchParams.get('limit')).toBe('25')
        expect(calls[0].url.searchParams.get('q')).toBe('example')
        expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer session', id: 'user-1', Accept: 'application/json' })
        expect(result.sources[0].id).toBe('source-1')
        expect(result.nextPage).toBe(3)
    })
    it('refuses missing or impersonated sessions, invalid pages and insecure TI hosts', async () => {
        await expect(api.loadTiSources({ ...settings, authToken: '' }, 1, '')).rejects.toThrow('Sign in')
        await expect(api.loadTiSources({ ...settings, impersonationToken: 'target' }, 1, '')).rejects.toThrow('Switch back')
        await expect(api.loadTiSources(settings, 0, '')).rejects.toThrow('valid TI source page')
        process.env.EXPO_PUBLIC_TI_SITE_URL = 'http://ti.hanasand.com'
        await expect(api.loadTiSources(settings, 1, '')).rejects.toThrow('secure TI website')
        expect(calls).toHaveLength(0)
    })
    it('rejects malformed records and distinguishes service errors from no sources', async () => {
        payload = { sources: [{ ...source(), status: 'mystery' }], page: 2, limit: 25, total: 51, previousPage: 1, nextPage: 3 }
        await expect(api.loadTiSources(settings, 2, '')).rejects.toThrow('invalid response')
        status = 503; payload = { error: { message: 'The TI source inventory is temporarily unavailable.' } }
        await expect(api.loadTiSources(settings, 2, '')).rejects.toThrow('temporarily unavailable')
    })
    it('uses the existing reviewed source-status control and requires a confirmed result', async () => {
        payload = { ok: true, payload: { source: { status: 'paused' } } }
        await api.setTiSourceStatus(settings, 'source-1', 'paused')
        expect(calls[0].url.pathname).toBe('/api/ti/scraper/control')
        expect(calls[0].init.method).toBe('POST')
        expect(JSON.parse(String(calls[0].init.body))).toEqual({ action: 'source_status', sourceId: 'source-1', status: 'paused' })
        payload = { ok: false, payload: { source: { status: 'active' } } }
        await expect(api.setTiSourceStatus(settings, 'source-1', 'paused')).rejects.toThrow('not confirmed')
    })
})
