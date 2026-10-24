// Opt-in synthetic entry; never imported by index.ts. No real account or service calls.
import { useState } from 'react'
import { Text, View } from 'react-native'
import { registerRootComponent } from 'expo'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { AppThemeProvider } from '../src/theme/context'
import { PillButton } from '../src/components/ui'
import { FindingsScreen } from '../src/screens/FindingsScreen'
import { ApiReferenceScreen } from '../src/screens/ApiReferenceScreen'
import type { AppSettings } from '../src/types'
const settings = { themeMode: 'obsidian', apiBaseUrl: 'https://api.synthetic.invalid/api', siteBaseUrl: 'https://synthetic.invalid', userId: 'fixture-user', authToken: 'synthetic-token', selectedOrganizationId: 'fixture-org', impersonationToken: '', impersonatingUserId: '' } as AppSettings
const at = '2026-10-23T05:00:00Z'
const contract = { openapi: '3.1.0', info: { title: 'Synthetic intelligence API', version: '0.0' }, security: [{ Bearer: [] }],
    servers: [{ url: 'https://never-execute.invalid' }],
    paths: { '/actors': { get: { summary: 'List synthetic actors', operationId: 'getActors', responses: { '200': { $ref: '#/components/responses/Actors' } } } } },
    components: { responses: { Actors: { description: 'Synthetic actors', content: { 'application/json': { schema: { $ref: '#/components/schemas/Actor' } } } } }, schemas: { Actor: { type: 'object', properties: { name: { type: 'string' } } } }, securitySchemes: { Bearer: { type: 'http', scheme: 'bearer' } } } }
function finding(index: number) {
    return { id: `finding-${index}`, organizationId: 'fixture-org', tenantId: 'fixture-org', company: `Fixture Company ${index}`, actor: 'Fixture Actor', matchedTerm: { value: 'synthetic.invalid' }, reviewState: 'new', deliveryState: 'pending', severity: 'medium', sourceFamily: 'public_report', firstSeenAt: at, lastSeenAt: at, recommendedAction: 'Review the retained synthetic source.', workflowContext: { caseId: 'HA-42', organizationId: 'fixture-org' },
        evidence: Array.from({ length: 11 }, (_, item) => ({ id: `evidence-${index}-${item}`, sourceName: 'Synthetic source', captureMode: 'metadata', redactionState: item === 0 ? 'raw_sensitive' : 'redacted', contentHash: `fixture-hash-${item}`, observedAt: at,
            excerpt: item === 0 ? 'FIXTURE_SENSITIVE_PROSE_MUST_NOT_RENDER' : item === 1 ? 'Evidence: {"actor":"Fixture Actor","unknown":"FIXTURE_UNKNOWN_JSON_MUST_NOT_RENDER"}' : 'A synthetic public report mentions the example company.', provenance: { captureId: `capture-${item}`, collectedAt: at, publishedAt: at } })) }
}
const json = (value: unknown): Response => {
    const payload = JSON.stringify(value)
    return { ok: true, status: 200, headers: { get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null }, body: null,
        text: async () => payload, json: async () => value } as Response
}
globalThis.fetch = Object.assign(async (...[input, init]: Parameters<typeof fetch>) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url)
    if (!['https://api.synthetic.invalid', 'https://synthetic.invalid'].includes(url.origin) || url.username || url.password || url.hash)
        throw new Error('External requests are disabled in this synthetic fixture.')
    if ((init?.method || 'GET') !== 'GET') throw new Error('Unsupported synthetic write blocked.')
    if (url.pathname === '/api/openapi/ti') return json(contract)
    if (url.pathname === '/api/findings/alerts' && url.searchParams.get('tenantId') === 'fixture-org' && url.searchParams.get('organizationId') === 'fixture-org' && url.searchParams.get('limit') === '50') {
        const cursor = url.searchParams.get('cursor')
        if (cursor && cursor !== 'opaque+/=?') throw new Error('Invalid synthetic cursor.')
        return json({ organization: { id: 'fixture-org' }, visibilityDecision: { allowed: true }, alerts: cursor ? [finding(22)] : Array.from({ length: 21 }, (_, index) => finding(index + 1)), total: 22, nextCursor: cursor ? null : 'opaque+/=?' })
    }
    throw new Error(`Unsupported synthetic read blocked: ${url.pathname}`)
}) as unknown as typeof fetch
const Stack = createNativeStackNavigator()
function Fixture() {
    const [mode, setMode] = useState('Findings'), [handoff, setHandoff] = useState('No handoff selected')
    return <View style={{ flex: 1 }}>
        <View style={{ paddingTop: 52, paddingHorizontal: 16, backgroundColor: '#101418', gap: 6 }}>
            <Text style={{ color: '#b2b9c2' }}>Synthetic only · external requests disabled</Text>
            <Text style={{ color: '#b2b9c2' }}>{handoff}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{['Findings', 'Docs', 'JSON'].map(name => <PillButton small key={name} label={`Fixture ${name}`} onPress={() => setMode(name)} />)}</View>
        </View>
        {mode === 'Findings' ? <FindingsScreen settings={settings} onOpenActor={name => setHandoff(`Native actor search: ${name}`)} onOpenCase={ref => setHandoff(`Case ${ref.caseId} · Alert ${ref.alertId} · Organization ${ref.organizationId || 'Personal'}`)} onOpenMonitoredActors={id => setHandoff(`Monitored actors organization: ${id}`)} />
            : <ApiReferenceScreen settings={settings} mode={mode === 'JSON' ? 'json' : 'reference'} transport={globalThis.fetch} onOpenJson={() => setMode('JSON')} onOpenGuide={() => setHandoff('Public guide website requested')} />}
    </View>
}
registerRootComponent(() => <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider><AppThemeProvider mode='obsidian'><NavigationContainer><Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name='SyntheticIntelligence' component={Fixture} /></Stack.Navigator></NavigationContainer></AppThemeProvider></SafeAreaProvider></GestureHandlerRootView>)
