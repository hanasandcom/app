import { beforeEach, expect, mock, test } from 'bun:test'
import type { AppSettings } from '../types'
const calls: Array<{ url: string; init: RequestInit }> = []
let models = 0, modelStatus = 0
let handle: (url: string, init: RequestInit) => Response | Promise<Response>
mock.module('./api', () => ({
    apiFetch: async (_settings: AppSettings, input: string, init: RequestInit) => { calls.push({ url: input, init }); return handle(input, init) },
    fetchAiModels: async () => { models++; if (modelStatus) throw Object.assign(new Error('synthetic-secret-do-not-echo'), { status: modelStatus }); return [{ name: 'synthetic-model', model: { status: 'idle', tps: 2 } }] },
}))
const api = await import('./ai-metrics')
const settings = { apiBaseUrl: 'https://api.synthetic.invalid/api', siteBaseUrl: 'https://synthetic.invalid', userId: 'synthetic', authToken: 'synthetic-token', selectedOrganizationId: 'other', impersonationToken: '', impersonatingUserId: '' } as AppSettings
const signal = () => new AbortController().signal
beforeEach(() => { calls.length = 0; models = 0; modelStatus = 0; handle = () => Response.json({ reliability: { queueDepth: [], promptTiming: { sampleCount: 0 } }, windowDays: 30 }) })

test('exact economics and Docker endpoints use managed auth transport without cookies or caching', async () => {
    await api.loadAiEconomics(settings, signal())
    handle = () => Response.json({ containers: [] })
    await api.loadAiContainers(settings, signal())
    expect(calls.map(call => call.url)).toEqual(['https://synthetic.invalid/api/backend/ai/economics?days=30', 'https://api.synthetic.invalid/api/docker'])
    expect(calls.every(call => call.init.credentials === 'omit' && call.init.cache === 'no-store' && call.init.redirect === 'error')).toBe(true)
    expect(calls.every(call => call.init.body === undefined)).toBe(true)
})
test('discovery reuses existing model helper, without inventing missing sensors or capacity', async () => {
    const targets = await api.loadAiMetricTargets(settings, signal())
    expect(models).toBe(1)
    expect(targets[0].name).toBe('synthetic-model')
    expect(targets[0].ram).toBeNull()
    expect(targets[0].lanes).toBeNull()
    expect(targets[0].watts).toBeNull()
})
test('null, absent, numeric strings, NaN and infinity are unavailable; actual zero stays zero', () => {
    for (const value of [null, undefined, '0', Number.NaN, Number.POSITIVE_INFINITY, -1]) expect(api.aiNumber(value)).toBeNull()
    expect(api.aiNumber(0)).toBe(0)
    expect(api.aiValue(null)).toBe('Unavailable')
    expect(api.aiValue(0, ' W')).toBe('0.0 W')
    expect(api.aiPercent(0.25)).toBe('25%')
})
test('full client projection preserves real units and discards connection URLs and arbitrary fields', () => {
    const client = api.parseAiClient({ name: 'm', cpu: [{ name: 'cpu', load: 0.5 }], ram: [], gpu: [{ name: 'gpu', load: 0.25, memoryUsedMb: 100, memoryTotalMb: 200 }], lanes: [{ id: 'lane', url: 'https://secret.invalid', maxRequests: 4, activeRequests: 1, availableRequests: 3, queuedRequests: 2 }], power: { totalWatts: 50, monthlyKwh: 2.5 }, model: { tps: 3, currentTokens: 7 }, authToken: 'never-render' })
    expect(client.cpu?.[0].load).toBe(0.5)
    expect(client.gpu?.[0].memoryUsedMb).toBe(100)
    expect(client.lanes?.[0].queued).toBe(2)
    expect(JSON.stringify(client)).not.toContain('secret.invalid')
    expect(JSON.stringify(client)).not.toContain('never-render')
})
test('summary uses website average throughput and loads, summed lane counts and reported monthly energy', () => {
    const client = (name: string, tps: number) => api.parseAiClient({ name, ram: [{ load: 0.5 }], cpu: [{ load: 0.2 }], gpu: [{ load: 0.1 }], lanes: [{ maxRequests: 4, activeRequests: 1, availableRequests: 3 }], power: { totalWatts: 50, monthlyKwh: 2 }, model: { tps } })
    expect(api.aiSummary([client('a', 2), client('b', 6)])).toEqual({ ram: 0.5, cpu: 0.2, gpu: 0.1, tps: 4, active: 2, available: 6, maximum: 8, watts: 100, monthlyKwh: 4 })
    expect(api.aiSummary([client('a', 2), api.parseAiClient({ name: 'unknown' })]).watts).toBeNull()
    expect(api.aiSummary([]).cpu).toBeNull()
})
test('container envelopes and AI-name matching mirror actual dashboard scope', () => {
    const result = api.parseAiContainers({ data: { containers: [{ id: '1', name: 'hanasand_ai_worker', state: 'running' }, { id: '2', name: 'mail' }, { id: '3', name: 'model-client', health: 'unhealthy' }], generated_at: 'synthetic', unavailable_reason: 'Stats warming up' } })
    expect(result.items.map(item => item.id)).toEqual(['1', '3'])
    expect(result.items[0].health).toBe('running')
    expect(result.unavailable).toBe('Stats warming up')
    expect(() => api.parseAiContainers({})).toThrow()
})
test('queue timing keeps missing sample count distinct from zero completed runs', () => {
    expect(api.parseAiEconomics({ reliability: { queueDepth: [], promptTiming: {} } }).sampleCount).toBeNull()
    expect(api.parseAiEconomics({ reliability: { queueDepth: [], promptTiming: { sampleCount: 0 } } }).sampleCount).toBe(0)
    expect(() => api.parseAiEconomics({})).toThrow()
})
test('authorization failures carry status but never echo a credential-bearing body', async () => {
    for (const status of [401, 403]) {
        handle = () => Response.json({ error: 'synthetic-token postgres://secret' }, { status })
        try { await api.loadAiEconomics(settings, signal()); throw new Error('Expected failure') }
        catch (cause) { expect(cause).toBeInstanceOf(api.AiMetricsError); expect((cause as InstanceType<typeof api.AiMetricsError>).status).toBe(status); expect(String(cause)).not.toContain('synthetic-token') }
    }
})
test('pre-abort, malformed JSON, oversized payload and insecure bases fail without retries', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(api.loadAiEconomics(settings, controller.signal)).rejects.toThrow('cancelled')
    await expect(api.loadAiEconomics({ ...settings, siteBaseUrl: 'http://synthetic.invalid' }, signal())).rejects.toThrow('secure')
    expect(calls).toHaveLength(0)
    handle = () => new Response('{')
    await expect(api.loadAiEconomics(settings, signal())).rejects.toThrow('unavailable')
    handle = () => new Response('a'.repeat(api.aiMetricsLimit + 1))
    await expect(api.loadAiEconomics(settings, signal())).rejects.toThrow('size limit')
    expect(calls).toHaveLength(2)
})
test('memory-only scope changes for account, token, organization and both impersonation states', () => {
    for (const change of [{ userId: 'two' }, { authToken: 'two' }, { selectedOrganizationId: 'two' }, { impersonationToken: 'two' }, { impersonatingUserId: 'two' }]) expect(api.aiMetricsScope({ ...settings, ...change })).not.toBe(api.aiMetricsScope(settings))
})

test('unknown lane telemetry cannot produce a partial known-capacity total', () => {
    const known = api.parseAiClient({ name: 'known', lanes: [{ maxRequests: 3, activeRequests: 1, availableRequests: 2 }] })
    expect(api.aiSummary([known, api.parseAiClient({ name: 'unknown' })]).maximum).toBeNull()
    expect(() => api.parseAiClient({ name: 'x'.repeat(301) })).toThrow()
})
test('screen source wires foreground/scope cleanup, epochs and manual auth recovery; interaction remains a separate fixture check', async () => {
    const source = await Bun.file(new URL('../screens/AiMetricsScreen.tsx', import.meta.url)).text()
    for (const guard of ['key={aiMetricsScope(settings)}', 'state !== \'active\'', 'reviewed !== epoch.current', 'readController.current?.abort()', 'sessionController.current?.abort()', 'testController.current?.abort()', 'if (authBlocked.current && !manual.current) return', 'if (!authBlocked.current) void refresh()', 'history.current = []; conversation.current', 'if (pending.current) return']) expect(source).toContain(guard)
    expect(source).not.toContain('AsyncStorage')
    expect(source).not.toContain('localStorage')
    const prompt = await Bun.file(new URL('../components/AiMetricsPrompt.tsx', import.meta.url)).text()
    expect(prompt).toContain('latest.current.epoch !== snapshot.epoch')
    expect(prompt).toContain('latest.current.clientName !== snapshot.clientName')
    expect(prompt).toContain('Alert.alert(')
})

test('existing discovery HTTP401 and403 retain status and require manual refresh without raw error echo', async () => {
    for (const status of [401, 403]) {
        modelStatus = status
        try { await api.loadAiMetricTargets(settings, signal()); throw new Error('Expected failure') }
        catch (cause) { expect(cause).toBeInstanceOf(api.AiMetricsError); expect((cause as InstanceType<typeof api.AiMetricsError>).status).toBe(status); expect(String(cause)).toContain('manually'); expect(String(cause)).not.toContain('synthetic-secret') }
    }
    expect(models).toBe(2)
})
