import { beforeEach, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { AppSettings } from '../types'
const calls: Array<{ settings: AppSettings; url: URL; init: RequestInit }> = []
let handle: (url: URL, init: RequestInit) => Response | Promise<Response>
mock.module('./api', () => ({ apiFetch: async (settings: AppSettings, input: string, init: RequestInit) => { const url = new URL(input); calls.push({ settings, url, init }); return handle(url, init) } }))
const { filterTrafficPage, loadTrafficDomains, loadTrafficMetrics, loadTrafficRecords, trafficAccountKey } = await import('./traffic')
const settings = { apiBaseUrl: 'https://traffic.synthetic.invalid/api', userId: 'fixture-user', authToken: 'fixture-session', selectedOrganizationId: 'fixture-org', impersonationToken: '', impersonatingUserId: '' } as AppSettings
const metric = () => ({ total_requests: '12', avg_request_time: '125', error_rate: 0.25, sampled_at: '2026-10-23T03:00:00Z',
    top_methods: [{ key: 'GET', count: '12' }], top_status_codes: [{ key: '200', count: 9 }], top_domains: [{ key: 'example.test', count: 12 }], top_os: [], top_browsers: [{ key: 'Fixture browser', count: 12 }], top_error_paths: [{ key: '/missing', count: 3 }], top_paths: [{ key: '/', count: 12 }], top_slow_paths: [{ key: '/slow', avg_time: '250.5' }], requests_over_time: [{ key: '2026-10-23 03:00:00+00', count: '12' }] })
const record = (change: Record<string, unknown> = {}) => ({ id: '9007199254740993', user_agent: 'Fixture browser', domain: 'example.test', path: '/page', method: 'GET', referer: 'https://example.test/source', request_time: 125, status: 200, timestamp: '2026-10-23T03:00:00Z', country_iso: 'NO', ...change })
const input = { domain: '', limit: 50, page: 1 }
beforeEach(() => { calls.length = 0; handle = url => Response.json(url.pathname.endsWith('domains') ? { domains: ['example.test'] } : url.pathname.endsWith('metrics') ? metric() : { result: [record()], total: 1 }) })

test('only direct existing Core GET routes use the current bound-account adapter, never cookies or website SSE proxy', async () => {
    await loadTrafficDomains(settings); await loadTrafficMetrics(settings, 'example.test'); await loadTrafficRecords(settings, { ...input, domain: 'example.test', page: 2 })
    expect(calls.map(call => call.url.pathname)).toEqual(['/api/traffic/domains', '/api/traffic/metrics', '/api/traffic/records'])
    expect(calls[2].url.searchParams.toString()).toBe('limit=50&page=2&domain=example.test')
    for (const call of calls) { expect(call.settings).toBe(settings); expect(call.init.credentials).toBe('omit'); expect(call.init.redirect).toBe('error'); expect(call.init.method).toBeUndefined(); expect(call.init.body).toBeUndefined(); expect(new Headers(call.init.headers).get('authorization')).toBe('Bearer fixture-session'); expect(new Headers(call.init.headers).get('id')).toBe('fixture-user') }
})
test('all domains is truly global with no invented organization filter; domain values stay encoded', async () => {
    await loadTrafficMetrics(settings, ''); expect(calls[0].url.search).toBe('')
    await loadTrafficRecords(settings, { ...input, domain: 'example.test:443' })
    expect(calls[1].url.searchParams.get('domain')).toBe('example.test:443'); expect(calls[1].url.searchParams.has('organizationId')).toBe(false)
    expect(calls[1].url.search).toContain('%3A')
})
test('normalizes PostgreSQL numeric strings and explicit-zone hourly timestamps for native engines', async () => {
    const result = await loadTrafficMetrics(settings, '')
    expect(result.total_requests).toBe(12); expect(result.avg_request_time).toBe(125); expect(result.top_methods[0].count).toBe(12)
    expect(result.top_slow_paths[0].avg_time).toBe(250.5); expect(result.requests_over_time[0].key).toBe('2026-10-23T03:00:00.000Z')
    expect(result.top_os).toEqual([]); expect(result.sampled_at).toBe('2026-10-23T03:00:00.000Z')
})
test('preserves bigint record IDs and country fields; no detail endpoint or IP lookup is needed', async () => {
    const result = await loadTrafficRecords(settings, input)
    expect(result.result[0]).toMatchObject({ id: '9007199254740993', country_iso: 'NO', path: '/page', request_time: 125 })
    expect(result.total).toBe(1); expect(result.limit).toBe(50); expect(calls).toHaveLength(1)
    handle = () => Response.json({ result: [record({ id: 1, status: 0, country_iso: null })], total: '1' })
    expect((await loadTrafficRecords(settings, input)).result[0]).toMatchObject({ id: '1', status: 0, country_iso: null })
})
test('empty genuine data remains empty, missing/malformed statistics are never converted to zero', async () => {
    handle = () => Response.json({ domains: [] }); expect(await loadTrafficDomains(settings)).toEqual([])
    handle = () => Response.json({ result: [], total: 0 }); expect((await loadTrafficRecords(settings, input)).total).toBe(0)
    for (const changed of [{ total_requests: undefined }, { avg_request_time: null }, { error_rate: 2 }, { top_paths: null }, { top_methods: [{ key: 'GET', count: -1 }] }, { sampled_at: 'invalid' }, { requests_over_time: [{ key: '2026-10-23 03:00:00', count: 1 }] }]) {
        handle = () => Response.json({ ...metric(), ...changed }); await expect(loadTrafficMetrics(settings, '')).rejects.toThrow('invalid response')
    }
})
test('malformed/oversized page payloads, duplicate IDs and unsafe numbers fail explicitly', async () => {
    for (const body of [{ result: [record(), record()], total: 2 }, { result: [record({ id: 9007199254740992 })], total: 1 }, { result: [record({ timestamp: 'not-a-date' })], total: 1 }, { result: [record({ country_iso: 'UNKNOWN' })], total: 1 }, { result: [], total: -1 }, { result: Array.from({ length: 51 }, (_, i) => record({ id: String(i + 1) })), total: 51 }]) {
        handle = () => Response.json(body); await expect(loadTrafficRecords(settings, input)).rejects.toThrow('invalid response')
    }
})
test('validates domains, page/limit and secure authenticated base before fetch', async () => {
    for (const changed of [{ page: 0 }, { page: 1.5 }, { limit: 201 }, { limit: 0 }, { page: Number.MAX_SAFE_INTEGER }, { domain: 'example.test/path' }, { domain: 'x'.repeat(254) }]) await expect(loadTrafficRecords(settings, { ...input, ...changed })).rejects.toThrow()
    for (const apiBaseUrl of ['http://example.test/api', 'https://user@example.test/api', 'https://example.test/api?x=1']) await expect(loadTrafficDomains({ ...settings, apiBaseUrl })).rejects.toThrow()
    await expect(loadTrafficDomains({ ...settings, authToken: '' })).rejects.toThrow('Sign in')
    expect(calls).toHaveLength(0)
})
test('never hides HTTP errors as no traffic; response body and endpoint secrets are not echoed', async () => {
    for (const status of [401, 403, 429, 500, 503]) {
        calls.length = 0; handle = () => Response.json({ error: 'private-token-example' }, { status })
        let message = ''; try { await loadTrafficDomains(settings) } catch (error) { message = String(error) }
        expect(message).not.toContain('private-token-example'); expect(message).not.toBe(''); expect(calls).toHaveLength(1)
    }
})
test('account/session/workspace/service and BOTH impersonation states invalidate in-memory UI scope', () => {
    for (const changed of [{ userId: 'other' }, { authToken: 'new-session' }, { apiBaseUrl: 'https://other.synthetic.invalid/api' }, { selectedOrganizationId: 'other-org' }, { impersonationToken: 'other-target' }, { impersonatingUserId: 'other-user' }]) expect(trafficAccountKey({ ...settings, ...changed })).not.toBe(trafficAccountKey(settings))
})
test('pre-aborted read makes no request and abort forwarding rejects a late response without AbortSignal.any', async () => {
    const before = new AbortController(); before.abort(); await expect(loadTrafficDomains(settings, before.signal)).rejects.toThrow(); expect(calls).toHaveLength(0)
    const controller = new AbortController(); let resolve!: (value: Response) => void
    handle = () => new Promise<Response>(done => { resolve = done })
    const pending = loadTrafficDomains(settings, controller.signal); controller.abort(); resolve(Response.json({ domains: ['old-account.test'] }))
    await expect(pending).rejects.toThrow('Canceled'); expect(calls[0].init.signal?.aborted).toBe(true)
})
test('loaded-page filters are local only and keep unknown-country requests', async () => {
    const rows = (await loadTrafficRecords(settings, input)).result
    const requests = [...rows, { ...rows[0], id: '2', method: 'POST', status: 503, country_iso: null }]
    expect(filterTrafficPage(requests, 'EXAMPLE.TEST', 'POST', '5').map(row => row.id)).toEqual(['2'])
    expect(filterTrafficPage(requests, 'absent')).toEqual([]); expect(calls).toHaveLength(1)
})
test('screen source keeps focused detail, bounded pages and all breakdowns with navigation/background stale-result guards', () => {
    const screen = readFileSync(`${import.meta.dir}/../screens/TrafficScreen.tsx`, 'utf8')
    for (const marker of ['useIsFocused()', 'AppState.addEventListener(\'change\'', 'controller.signal.aborted || generation !== epoch.current', 'controller.abort(); epoch.current++', 'Global traffic · not limited to the selected workspace', 'Back to requests', 'Loaded page only', 'limit: view === \'overview\' ? 12 : 50', 'top_methods', 'top_status_codes', 'top_domains', 'top_paths', 'top_error_paths', 'top_slow_paths', 'top_os', 'top_browsers', 'requests_over_time']) expect(screen).toContain(marker)
    expect(screen).not.toContain('Linking.openURL'); expect(screen).not.toContain('JSON.stringify(metrics)')
})
