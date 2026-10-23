// Opt-in UI fixture. The normal index never imports it. All HTTP is intercepted;
// neither account storage nor any external service is used by this entry.
import { registerRootComponent } from 'expo'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { WatchlistsScreen } from '../src/screens/WatchlistsScreen'
import { AppThemeProvider } from '../src/theme/context'
import type { AppSettings } from '../src/types'

const organizationId = 'fixture-organization'
const settings = {
    apiBaseUrl: 'https://watchlists.invalid/api', siteBaseUrl: 'https://watchlists.invalid',
    userId: 'fixture-user', authToken: 'fixture-token', impersonationToken: '',
    selectedOrganizationId: organizationId, themeMode: 'obsidian',
} as AppSettings
const schema = 'organization.watchlist_projection_receipt.v1'
type Item = { id: string; organizationId: string; kind: string; value: string; notes: string; status: string; updatedAt: string }
let items: Item[] = [
    { id: 'fixture-company', organizationId, kind: 'company', value: 'Example Company', notes: 'Synthetic active term', status: 'active', updatedAt: '2026-10-23T00:00:00Z' },
    { id: 'fixture-domain', organizationId, kind: 'domain', value: 'example.test', notes: 'Synthetic paused term', status: 'paused', updatedAt: '2026-10-23T00:00:00Z' },
    { id: 'fixture-keyword', organizationId, kind: 'keyword', value: 'archived example', notes: 'Synthetic archived term', status: 'archived', updatedAt: '2026-10-23T00:00:00Z' },
]
let sequence = 0
function json(value: unknown, status = 200) {
    return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}
function saved(changed: Item[], partial = false, cleanup = false) {
    return {
        saved: true, ...(cleanup ? { archivedItems: changed } : { watchlistItem: changed[0] }),
        dwmAlertBridge: {
            schemaVersion: schema, organizationId, itemIds: changed.map(item => item.id),
            projection: {
                status: partial ? 'pending' : 'synchronized', source: 'identity',
                checkedAt: partial ? null : '2026-10-23T00:00:00Z',
                watchlistIds: changed.map(item => `org_shared_watchlist:${organizationId}:${item.id}`),
                unresolvedItemIds: partial ? changed.map(item => item.id) : [],
            },
            alertRebuild: { status: 'not_requested', reason: 'projection_only' },
        },
    }
}
globalThis.fetch = Object.assign(async (...[input, init]: Parameters<typeof fetch>) => {
    const url = new URL(String(input))
    const prefix = `/api/organizations/${organizationId}/watchlists`
    if (url.origin !== 'https://watchlists.invalid' || !(url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))) throw new Error('External requests are disabled in this fixture.')
    const method = init?.method || 'GET'
    if (method === 'GET' && url.pathname === prefix) return json({
        organization: { id: organizationId, name: 'Synthetic workspace', lifecycleStatus: 'active' },
        watchlistItems: items,
        sharedWatchlistContract: {
            organizationId, capabilities: { authoritativeProjectionSync: true, projectionReceiptSchemaVersion: schema },
            permissions: { canWrite: true, canArchive: true, canCleanup: true },
        },
    })
    const body = JSON.parse(String(init?.body || '{}'))
    if (method === 'POST' && url.pathname === prefix) {
        const item = { ...body, id: `fixture-created-${++sequence}`, organizationId, status: 'active', updatedAt: '2026-10-23T00:00:00Z' } as Item
        items = [...items, item]
        return json(saved([item], true), 201)
    }
    const id = url.pathname.slice(prefix.length + 1).split('/')[0]
    if (id === 'cleanup') {
        const changed = items.filter(item => body.itemIds.includes(item.id)).map(item => ({ ...item, status: 'archived' }))
        items = items.map(item => changed.find(value => value.id === item.id) || item)
        return json(saved(changed, false, true))
    }
    const item = items.find(item => item.id === id)
    if (!item) return json({ error: 'not_found' }, 404)
    if (method === 'PUT') Object.assign(item, { kind: body.kind, value: body.value, notes: body.notes })
    else if (method === 'DELETE') item.status = 'archived'
    else if (method === 'POST' && url.pathname.endsWith('/actions')) item.status = body.action === 'pause' ? 'paused' : body.action === 'archive' ? 'archived' : 'active'
    else return json({ error: 'unsupported_fixture_operation' }, 400)
    return json(saved([item]))
}, globalThis.fetch)

const Stack = createNativeStackNavigator()
registerRootComponent(() => <GestureHandlerRootView style={{ flex: 1 }}>
    <AppThemeProvider mode='obsidian'><NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name='WatchlistsFixture'>
            {() => <WatchlistsScreen settings={settings} />}
        </Stack.Screen></Stack.Navigator>
    </NavigationContainer></AppThemeProvider>
</GestureHandlerRootView>)
