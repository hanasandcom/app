// Opt-in entry only; normal index.ts never imports it. All data is synthetic.
import { useEffect, useState } from 'react'
import { registerRootComponent } from 'expo'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { Text, View } from 'react-native'
import { IntegrationsScreen } from '../src/screens/IntegrationsScreen'
import { PillButton } from '../src/components/ui'
import { AppThemeProvider } from '../src/theme/context'
import type { AppSettings } from '../src/types'

const organizationId = 'fixture-org'
const settings = { apiBaseUrl: 'https://integrations.invalid/api', siteBaseUrl: 'https://integrations.invalid', userId: 'fixture-user', authToken: 'fixture-token',
    selectedOrganizationId: organizationId, impersonationToken: '', impersonatingUserId: '', themeMode: 'obsidian' } as AppSettings
if (settings.apiBaseUrl !== 'https://integrations.invalid/api') throw new Error('This fixture requires its synthetic API.')
type Destination = { id: string; orgId: string; name: string; kind: string; status: string; endpointHint: string; lastTestStatus: string | null; lastTestedAt: string | null }
const destinations: Destination[] = [
    { id: 'fixture-active', orgId: organizationId, name: 'Dry run alerts', kind: 'webhook', status: 'active', endpointHint: 'hooks.synthetic.invalid/…', lastTestStatus: null, lastTestedAt: null },
    { id: 'fixture-paused', orgId: organizationId, name: 'Paused alerts', kind: 'webhook', status: 'paused', endpointHint: 'hooks.synthetic.invalid/…', lastTestStatus: null, lastTestedAt: null },
]
let unknownLifecycle = false, sequence = 0
let reportOperation: (value: string) => void = () => {}
const urls = new Map(destinations.map(row => [row.id, 'https://hooks.synthetic.invalid/synthetic-token']))
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
function feed() {
    return { destinations, destinationAdminProof: { access: { canManage: true } },
        destinationLifecycle: destinations.map(row => ({ destinationId: row.id, access: { canManage: true, canUpdate: true, canDisable: row.status === 'active', canTest: row.status === 'active' } })),
        destinationTests: destinations.map(row => ({ destinationId: row.id, access: { canTest: row.status === 'active' }, blockers: row.status === 'active' ? [] : [{ blocking: true, message: 'Destination is paused or archived.' }] })),
    }
}
globalThis.fetch = Object.assign(async (...[input, init]: Parameters<typeof fetch>) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url)
    if (url.origin !== 'https://integrations.invalid' || url.username || url.password || url.hash) throw new Error('External requests are disabled in this fixture.')
    const method = init?.method || 'GET', path = url.pathname
    if (path === `/api/organizations/${organizationId}` && method === 'GET' && !url.search) return unknownLifecycle
        ? json({ error: 'Synthetic lifecycle unavailable' }, 503)
        : json({ organization: { id: organizationId, lifecycleStatus: 'active', privacyDeletionInProgress: false } })
    const prefix = '/api/dwm/webhook-destinations'
    if (!(path === prefix || /^\/api\/dwm\/webhook-destinations\/[A-Za-z0-9_-]+(?:\/test)?$/.test(path))) throw new Error('Unsupported external route is disabled in this fixture.')
    if (path === prefix && method === 'GET' && Array.from(url.searchParams.keys()).length === 1 && url.searchParams.get('orgId') === organizationId) return json(feed())
    if (url.search) throw new Error('Unsupported query is disabled in this fixture.')
    const body = JSON.parse(String(init?.body || '{}'))
    if (path === prefix && method === 'POST') {
        if (body.orgId !== organizationId || !body.endpointUrl || !body.name) return json({ error: 'Invalid synthetic create.' }, 400)
        const destination = { id: `fixture-created-${++sequence}`, orgId: organizationId, name: body.name, kind: body.kind, status: 'active', endpointHint: 'hooks.synthetic.invalid/…', lastTestStatus: null, lastTestedAt: null }
        destinations.push(destination); urls.set(destination.id, body.endpointUrl); reportOperation('Synthetic destination created.')
        return json({ destination, destinationCrud: { canApply: true } }, 201)
    }
    const match = path.match(/^\/api\/dwm\/webhook-destinations\/([^/]+)(\/test)?$/)
    const destination = match && destinations.find(row => row.id === match[1])
    if (!destination || !match) return json({ error: 'Synthetic destination not found.' }, 404)
    if (method === 'PUT' && !match[2]) {
        if (body.orgId !== organizationId) return json({ error: 'Scope mismatch.' }, 403)
        const previous = urls.get(destination.id)
        Object.assign(destination, { name: body.name, kind: body.kind })
        if (body.endpointUrl) urls.set(destination.id, body.endpointUrl)
        reportOperation(body.endpointUrl ? 'Synthetic edit changed URL.' : urls.get(destination.id) === previous ? 'Synthetic edit retained existing URL.' : 'Synthetic URL mismatch.')
        return json({ destination, destinationCrud: { canApply: true } })
    }
    if (method === 'DELETE' && !match[2]) {
        if (destination.status !== 'active') return json({ error: 'Paused destination cannot be removed.' }, 409)
        destination.status = 'archived'; reportOperation('Synthetic destination archived.')
        return json({ destination, destinationCrud: { canApply: true } })
    }
    if (method === 'POST' && match[2]) {
        if (destination.status !== 'active' || body.dryRun !== false || body.live !== true) return json({ error: 'Invalid synthetic test.' }, 400)
        const status = /dry/i.test(destination.name) ? 'dry_run' : /skip/i.test(destination.name) ? 'skipped' : /fail/i.test(destination.name) ? 'failed' : 'delivered'
        destination.lastTestStatus = status; destination.lastTestedAt = '2026-10-23T10:00:00Z'; reportOperation(`Synthetic test recorded: ${status}. No external request occurred.`)
        return json({ delivery: { id: 'synthetic-delivery', destinationId: destination.id, orgId: organizationId, status, dryRun: status === 'dry_run' } }, status === 'failed' ? 502 : 202)
    }
    return json({ error: 'Unsupported synthetic operation.' }, 400)
}, globalThis.fetch)

function Fixture() {
    const [unavailable, setUnavailable] = useState(false)
    const [operation, setOperation] = useState('No synthetic changes yet.')
    useEffect(() => { reportOperation = setOperation; return () => { reportOperation = () => {} } }, [])
    return <View style={{ flex: 1 }}>
        <View style={{ paddingTop: 48, paddingHorizontal: 18, paddingBottom: 10, gap: 6, backgroundColor: '#101418' }}>
            <Text style={{ color: '#b2b9c2', fontSize: 12 }}>Synthetic only. Names containing Dry/Skip/Fail select test outcomes; other names deliver. Refresh after toggling lifecycle.</Text>
            <Text accessibilityLiveRegion='polite' style={{ color: '#b2b9c2', fontSize: 12 }}>{operation}</Text>
            <PillButton small label={unavailable ? 'Lifecycle503: restore available' : 'Lifecycle available: simulate503'} onPress={() => { unknownLifecycle = !unknownLifecycle; setUnavailable(unknownLifecycle) }} />
        </View>
        <IntegrationsScreen settings={settings} />
    </View>
}
const Stack = createNativeStackNavigator()
registerRootComponent(() => <GestureHandlerRootView style={{ flex: 1 }}><AppThemeProvider mode='obsidian'><NavigationContainer>
    <Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name='IntegrationsFixture' component={Fixture} /></Stack.Navigator>
</NavigationContainer></AppThemeProvider></GestureHandlerRootView>)
