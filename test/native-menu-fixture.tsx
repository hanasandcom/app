// Opt-in synthetic entry. Normal index.ts never imports this file.
import { useState } from 'react'
import { Text, View } from 'react-native'
import { PillButton } from '../src/components/ui'
import { TrafficMapScreen } from '../src/screens/TrafficMapScreen'
import { NativeToolsScreen } from '../src/screens/NativeToolsScreen'
import { registerRootComponent } from 'expo'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { AppThemeProvider } from '../src/theme/context'
import type { AppSettings, RootTabParamList } from '../src/types'
const settings = { apiBaseUrl: 'https://traffic.invalid/api', siteBaseUrl: 'https://traffic.invalid', userId: 'synthetic-user', authToken: 'synthetic-token', selectedOrganizationId: 'synthetic-org', impersonationToken: '', impersonatingUserId: '', themeMode: 'obsidian' } as AppSettings
let finishPolicy: (() => void) | null = null
const policy = { enabled: true, defaults: { anonymous: { windowMs: 1000, maxRequests: 3 }, authenticated: { windowMs: 60000, maxRequests: 120 }, internal: { windowMs: 1000, maxRequests: 1000 } }, overrides: [], updatedAt: '2026-10-23T03:00:00Z', updatedBy: 'synthetic-user' }
const limits = { perSecond: null, perMinute: 60, perHour: 1000, perDay: 10000 }
const apiKey = { id: 'synthetic-key', ownerId: 'synthetic-user', name: 'Synthetic client', tier: 'custom', description: 'Synthetic only', enabled: true, expiresAt: '', scopes: [{ id: 'synthetic-scope', enabled: true, method: 'GET', route: '/api/test', limits }], organizationId: null, keyPrefix: 'synthetic-prefix', createdAt: '2026-10-23T03:00:00Z', updatedAt: '2026-10-23T03:00:00Z', lastUsedAt: null }
const archive = { service: 'core', file: 'core-2026-10-23.sql.gz', mtime: '2026-10-23T03:00:00Z', sizeBytes: 4096, verified: true, checksumSha256: 'synthetic-checksum' }
const operation = { id: 'synthetic-operation', kind: 'verify', trigger: 'manual', actorId: 'synthetic-user', status: 'succeeded', stage: 'complete', startedAt: '2026-10-23T03:00:00Z', finishedAt: '2026-10-23T03:00:01Z', durationMs: 1000, file: archive.file, targetDatabase: null, checksumSha256: 'synthetic-checksum', sizeBytes: 4096, archiveEntries: 2, sourceIntegrity: null, restoredIntegrity: null, targetRemoved: null, error: null, releaseCommit: null }
const dashboard = { backups: [{ id: 'core', name: 'Core', database: 'synthetic_core', status: 'healthy', operations: [operation], scheduleEnabled: true, schedule: '0 2 * * *', scheduleTimezone: 'UTC', latestFile: archive.file, currentOperation: null }], files: [archive], errors: [] }
const overview = { status: 'healthy', generatedAt: '2026-10-23T03:00:00Z', activeQueries: 1, totalSizeBytes: 1048576, health: { message: 'Synthetic database healthy' }, queries: [{ database: 'synthetic_core', user: 'synthetic-user', state: 'active', durationSeconds: 1, query: 'select synthetic', isLongRunning: false }], storage: { sampledAt: '2026-10-23T03:00:00Z', stale: false, host: 'synthetic', disk: { totalBytes: 1073741824, availableBytes: 536870912, dailyGrowthBytes: null, daysUntilFull: null }, instances: [{ id: 'synthetic-pg', engine: 'postgres', status: 'healthy', databases: [{ name: 'synthetic_core', sizeBytes: 1048576 }] }] } }
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
globalThis.fetch = Object.assign(async (...[input, init]: Parameters<typeof fetch>) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url)
    if (url.origin !== 'https://traffic.invalid' || url.username || url.password || url.hash) throw new Error('External requests are disabled in this synthetic fixture.')
    const method = init?.method || 'GET'
    if (url.pathname === '/api/management/organizations' && url.searchParams.get('internalPages') === '1' && method === 'GET') return json({ allowed: true, canEdit: true })
    if (url.pathname === '/api/organizations' && method === 'GET') return json({ organizations: [{ id: '3e735e7b-4d7f-444d-9806-231fa26cfcec', name: 'Hanasand', role: 'editor', lifecycleStatus: 'active' }] })
    if (url.pathname === '/api/users' && method === 'GET') return json([{ id: 'synthetic-user', name: 'Synthetic owner' }])
    if (url.pathname === '/api/rate-limit/settings') {
        if (method === 'PUT') { Object.assign(policy, JSON.parse(String(init?.body))); await new Promise<void>(resolve => { finishPolicy = resolve }) }
        else if (method !== 'GET') throw new Error('Unsupported synthetic policy method.')
        return json({ settings: policy, routes: [{ method: 'GET', route: '/api/test' }], tierPresets: [{ id: 'custom', label: 'Custom', description: 'Synthetic tier', defaultLimits: limits }] })
    }
    if (url.pathname === '/api/rate-limit/keys' && method === 'GET') return json({ apiKeys: [apiKey] })
    if (url.pathname === '/api/rate-limit/keys/synthetic-key' && method === 'PUT') { Object.assign(apiKey, JSON.parse(String(init?.body))); return json({ apiKey }) }
    if (url.pathname === '/api/db' && method === 'GET') return json(overview)
    if (url.pathname === '/api/db/health' && method === 'GET') return json({ ok: true, database: 'synthetic_core' })
    if (url.pathname === '/api/db/browse' && method === 'GET') return json(url.searchParams.get('mode') === 'contents' ? { items: [{ schema: 'public', name: 'examples', columns: ['id', 'name'], sizeBytes: 4096 }], nextCursor: null } : url.searchParams.get('mode') === 'count' ? { totalRows: 1, nextCursor: null } : { rows: [{ id: 1, name: 'Synthetic row' }], fields: ['id', 'name'], nextCursor: null })
    if (url.pathname === '/api/db/query' && method === 'POST') return json({ rows: [{ result: 'Synthetic SQL result' }], fields: ['result'], rowCount: 1 })
    if (url.pathname === '/api/backup/dashboard' && method === 'GET') return json(dashboard)
    if (url.pathname === '/api/backup/verify' && method === 'POST' && JSON.parse(String(init?.body)).file === archive.file) return json({ message: 'Synthetic archive verified', operation })
    if (method !== 'GET') throw new Error('Unsupported synthetic write blocked.')
    if (url.pathname === '/api/traffic/domains' && !url.search) return json({ domains: ['synthetic.invalid', 'mail.synthetic.invalid'] })
    if (url.pathname === '/api/traffic/metrics') return json({ sampled_at: '2026-10-23T03:00:00Z', total_requests: '51', avg_request_time: '18.5', error_rate: '0.02', top_methods: [{ key: 'GET', count: '50' }], top_status_codes: [{ key: '200', count: '50' }], top_domains: [{ key: 'synthetic.invalid', count: '51' }], top_os: [], top_browsers: [], requests_over_time: [{ key: '2026-10-23T02:00:00Z', count: '25' }, { key: '2026-10-23T03:00:00Z', count: '26' }], top_error_paths: [], top_slow_paths: [], top_paths: [] })
    if (url.pathname === '/api/traffic/records') {
        const page = Number(url.searchParams.get('page')), domain = url.searchParams.get('domain') || 'synthetic.invalid'
        return json({ total: 51, result: [{ id: page === 2 ? '51' : '1', domain, path: page === 2 ? '/second-page' : '/example-request', method: 'GET', status: 200, request_time: 18.5, timestamp: '2026-10-23T03:00:00Z', user_agent: 'Synthetic browser', referer: 'https://synthetic.invalid/start', country_iso: 'NO' }] })
    }
    throw new Error('Unsupported synthetic route.')
}, globalThis.fetch)
let denyStream = false
const syntheticStream = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.origin !== 'https://traffic.invalid' || url.pathname !== '/api/traffic/live' || (init?.method || 'GET') !== 'GET') throw new Error('External stream blocked.')
    if (denyStream) return { ok: false, status: 401, headers: new Headers(), body: null } as unknown as Response
    let timer: ReturnType<typeof setInterval>, next = 100
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            const send = (value: string) => controller.enqueue(new TextEncoder().encode(value))
            send('event: ready\ndata: {"status":"connected"}\n\n')
            timer = setInterval(() => send(`event: traffic\ndata: ${JSON.stringify([{ iso: 'NO', count: 2, max_id: String(++next), timestamp: new Date().toISOString() }])}\n\n`), 1000)
        },
        cancel() { clearInterval(timer) },
    })
    return { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream' }), body } as unknown as Response
}) as unknown as typeof fetch
const Stack = createNativeStackNavigator()
function Fixture() {
    const [tool, setTool] = useState<RootTabParamList['Tools']['tool']>('traffic-map')
    const [streamRevision, setStreamRevision] = useState(0)
    return <View style={{ flex: 1 }}><View style={{ paddingTop: 52, paddingHorizontal: 16, backgroundColor: '#101418', gap: 6 }}><Text style={{ color: '#b2b9c2' }}>Synthetic data only · no external requests</Text><PillButton small label='Finish synthetic policy response' onPress={() => { finishPolicy?.(); finishPolicy = null }} /><PillButton small label='Toggle synthetic stream access' onPress={() => { denyStream = !denyStream; setStreamRevision(value => value + 1) }} /><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{(['traffic-map', 'traffic-overview', 'rate-limits', 'database', 'backups'] as const).map(value => <PillButton small key={value} label={value} onPress={() => setTool(value)} />)}</View></View>{tool === 'traffic-map' ? <TrafficMapScreen key={streamRevision} settings={settings} streamTransport={syntheticStream} /> : <NativeToolsScreen key={tool} tool={tool} settings={settings} onManageSshKeys={() => {}} onSelectOrganization={() => {}} onConfigureDelivery={() => {}} onOpenCase={() => {}} onViewAiLogs={() => {}} onOpenVms={() => {}} onOpenHealthCheck={() => {}} onOpenVmCheckout={() => {}} onOpenIntelligenceCases={() => {}} onOpenActor={() => {}} onOpenMonitoredActors={() => {}} onOpenApiJson={() => {}} onOpenGuide={() => {}} />}</View>
}
registerRootComponent(() => <GestureHandlerRootView style={{ flex: 1 }}><AppThemeProvider mode='obsidian'><NavigationContainer><Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name='SyntheticTraffic' component={Fixture} /></Stack.Navigator></NavigationContainer></AppThemeProvider></GestureHandlerRootView>)
