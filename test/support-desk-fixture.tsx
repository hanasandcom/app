// Opt-in synthetic entry. Normal index.ts never imports this file.
import { useState } from 'react'
import { Text, View } from 'react-native'
import { registerRootComponent } from 'expo'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { AppThemeProvider } from '../src/theme/context'
import { PillButton } from '../src/components/ui'
import { SupportDeskScreen } from '../src/screens/SupportDeskScreen'
import { OrganizationDirectoryScreen } from '../src/screens/OrganizationDirectoryScreen'
import { DeliveryHistoryScreen } from '../src/screens/DeliveryHistoryScreen'
import { AiMetricsScreen } from '../src/screens/AiMetricsScreen'
import { IntegrationsScreen } from '../src/screens/IntegrationsScreen'
import type { SupportLiveAdapter, SupportSocket } from '../src/lib/support-live'
import { responseLike } from '../src/lib/headers'
import type { AiMetricsLive } from '../src/lib/ai-metrics-live'
import { AiMetricsPromptError } from '../src/lib/ai-metrics-live'
import { parseAiClient } from '../src/lib/ai-metrics'
import type { AppSettings } from '../src/types'
const baseSettings = { themeMode: 'obsidian', apiBaseUrl: 'https://api.synthetic.invalid/api', siteBaseUrl: 'https://synthetic.invalid',
    userId: 'synthetic-agent', authToken: 'synthetic-token', selectedOrganizationId: 'org', impersonationToken: '', impersonatingUserId: '' } as AppSettings
const ticketId = '11111111-1111-4111-8111-111111111111'
const ticket = { id: ticketId, subject: 'Fixture customer conversation', user_id: 'synthetic-customer', user_name: 'Fixture Customer', channel: 'human', status: 'open', updated_at: '2026-10-23T04:30:00Z' }
const messages = [{ id: '33333333-3333-4333-8333-333333333333', sender_id: 'synthetic-customer', sender_name: 'Fixture Customer', body: 'Please help with my synthetic account.', created_at: ticket.updated_at }]
const alert = { id: 'alert', organizationId: 'org', tenantId: 'org', company: 'Fixture finding', actor: 'Fixture actor', matchedTerm: { value: 'synthetic.invalid' }, reviewState: 'new', deliveryState: 'pending', evidence: [{ id: 'capture', provenance: { retained: true } }], workflowContext: { caseId: 'case', organizationId: 'org' } }
const attempts = [{ id: 'orphan-attempt', alertId: 'absent-alert', orgId: 'org', status: 'failed', attemptedAt: ticket.updated_at, dryRun: false, responseStatus: 503, auditEventId: 'audit', idempotencyKey: 'dedup', error: 'Synthetic service unavailable' }]
const organization = { id: 'org', name: 'Fixture Team', slug: 'fixture-team', status: 'active', lifecycleStatus: 'active', role: 'editor', member_count: 3, created_at: ticket.updated_at, last_active_at: ticket.updated_at }
const client = { name: 'fixture-client', model: { status: 'idle', tps: 4 }, cpu: [{ name: 'CPU', load: 0.2 }], ram: [{ load: 0.5 }], gpu: [{ name: 'GPU', load: 0.25 }], lanes: [{ id: 'lane', maxRequests: 2, activeRequests: 0, availableRequests: 2 }], power: { totalWatts: 45, monthlyKwh: 2 } }
let staff = true, holdReply = false, finishReply: (() => void) | null = null, rejectPrompt = true
const sockets = new Set<SupportSocket>()
const json = (value: unknown, status = 200) => responseLike(JSON.stringify(value), status, '', { 'content-type': 'application/json' })
globalThis.fetch = Object.assign(async (...[input, init]: Parameters<typeof fetch>) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url)
    if (!['https://api.synthetic.invalid', 'https://synthetic.invalid', 'https://support.synthetic.invalid'].includes(url.origin)
        || url.username || url.password || url.hash) throw new Error('External requests are disabled in this synthetic fixture.')
    const method = init?.method || 'GET', body = init?.body ? JSON.parse(String(init.body)) : {}
    if (url.origin === 'https://support.synthetic.invalid') {
        if (method === 'GET' && url.pathname === '/api/support/tickets') return json({ isSupport: staff, realtime: true, tickets: [ticket] })
        if (method === 'GET' && url.pathname === '/api/support/my-tickets') return json({ tickets: [ticket] })
        const path = `/api/support/tickets/${ticketId}`
        if (method === 'GET' && url.pathname === `${path}/messages`) return json({ messages })
        if (method === 'POST' && url.pathname === `${path}/messages`) {
            if (holdReply) await new Promise<void>(resolve => { finishReply = resolve })
            if (!messages.some(item => item.id === body.requestId)) messages.push({ id: body.requestId, sender_id: baseSettings.userId, sender_name: 'Fixture Agent', body: body.message, created_at: ticket.updated_at })
            return json({ ok: true, messageId: body.requestId })
        }
        if (method === 'POST' && url.pathname === `${path}/status` && ['open', 'closed'].includes(body.status)) { ticket.status = body.status; return json({ ok: true, ticket }) }
        if ((method === 'POST' && url.pathname === `${path}/account/password`) || (method === 'PUT' && url.pathname === `${path}/account/email`)) return json({ ok: true })
    }
    if (method === 'GET') {
        if (url.pathname === '/api/management/organizations') return json({ organizations: [organization, { ...organization, id: 'unjoined', name: 'Fixture Unjoined', slug: 'unjoined', member_count: null }] })
        if (url.pathname === '/api/organizations') return json({ organizations: [organization] })
        if (url.pathname === '/api/organizations/org') return json({ organization: { ...organization, privacyDeletionInProgress: false } })
        if (url.pathname === '/api/dwm/webhook-destinations') return json({ destinations: [{ id: 'dest', orgId: 'org', name: 'Fixture Alerts', kind: 'webhook', status: 'active' }], destinationAdminProof: { access: { canManage: true } }, destinationLifecycle: [], destinationTests: [] })
        if (url.pathname === '/api/findings/alerts') return json({ alerts: [alert] })
        if (url.pathname === '/api/dwm/webhook-deliveries') return json({ deliveries: attempts, visibility: { allowed: true }, deliveryReadinessConsumer: { access: { canRetry: true }, liveDeliveryEnabled: true }, deliveryRetryRequest: { access: { canRetry: true }, entries: attempts.map(item => ({ orgId: item.orgId, alertId: item.alertId, deliveryId: item.id, liveRequest: { canSend: true, externalSendEnabled: true, blockers: [] } })) } })
        if (url.pathname === '/api/backend/ai/economics') return json({ reliability: { queueDepth: [], promptTiming: { sampleCount: 0 } }, windowDays: 30 })
        if (url.pathname === '/api/docker') return json({ containers: [{ id: 'container', name: 'hanasand-ai-fixture', image: 'synthetic', health: 'healthy', status: 'Up' }] })
        if (url.pathname === '/api/ai/models') return json({ connected: [client] })
    }
    if (method === 'POST' && url.pathname === '/api/dwm/webhook-deliveries') {
        const retained = attempts.find(item => item.id === body.deliveryId)
        const receipt = { id: `receipt-${attempts.length}`, orgId: 'org', alertId: retained?.alertId || body.alertId, status: body.dryRun ? 'dry_run' : 'delivered', dryRun: Boolean(body.dryRun), attemptedAt: ticket.updated_at, responseStatus: 200, auditEventId: 'synthetic-audit', idempotencyKey: 'synthetic-key', error: '' }
        attempts.unshift(receipt); return json({ deliveries: [receipt] }, 202)
    }
    throw new Error(`Unsupported synthetic write blocked or read unavailable: ${method} ${url.pathname}`)
}) as unknown as typeof fetch
const supportLive: SupportLiveAdapter = {
    proof: async () => ({ proof: 'synthetic-proof' }),
    socket: () => {
        const socket: SupportSocket = { onopen: null, onmessage: null, onclose: null, onerror: null,
            send: body => { if (JSON.parse(body).type !== 'auth') throw new Error('Unexpected fixture frame'); setTimeout(() => socket.onmessage?.({ data: '{"type":"ready"}' }), 0) },
            close: () => { sockets.delete(socket) }
        }
        sockets.add(socket); setTimeout(() => socket.onopen?.(), 0); return socket
    }
}
const aiLive: AiMetricsLive = {
    observe: async (_settings, signal, observer) => {
        observer.state('connected'); observer.snapshot([parseAiClient(client)], 2)
        const close = () => observer.state('disconnected'); signal.addEventListener('abort', close, { once: true }); return close
    },
    test: async (_settings, _input, signal, content, started) => {
        if (rejectPrompt) throw new AiMetricsPromptError('Fixture client vanished before submission.', false)
        if (signal.aborted) throw new AiMetricsPromptError('Fixture cancelled.', false)
        started(); content('Synthetic response'); return 'Synthetic response'
    }
}
const Stack = createNativeStackNavigator()
function Fixture() {
    const [mode, setMode] = useState('Support'), [revision, setRevision] = useState(0), [workspace, setWorkspace] = useState('other')
    const [event, setEvent] = useState('No fixture writes yet')
    const settings = { ...baseSettings, selectedOrganizationId: mode === 'Directory' ? workspace : 'org' }
    return <View style={{ flex: 1 }}>
        <View style={{ paddingTop: 52, paddingHorizontal: 16, backgroundColor: '#101418', gap: 6 }}>
            <Text style={{ color: '#b2b9c2' }}>Synthetic only · no external requests</Text>
            <Text style={{ color: '#b2b9c2' }}>{event}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{['Support', 'Directory', 'Delivery', 'AI'].map(name => <PillButton small key={name} label={`Fixture ${name}`} onPress={() => setMode(name)} />)}</View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                <PillButton small label='Toggle held reply' onPress={() => { holdReply = !holdReply; setEvent(`Hold reply: ${holdReply}`) }} />
                <PillButton small label='Finish held reply' onPress={() => { finishReply?.(); finishReply = null; setEvent('Held reply released') }} />
                <PillButton small label='Emit support update' onPress={() => { for (const socket of sockets) socket.onmessage?.({ data: '{"type":"changed"}' }); setEvent('Synthetic live change emitted') }} />
                <PillButton small label='Allow model response' onPress={() => { rejectPrompt = false; setEvent('Synthetic model response allowed') }} />
                <PillButton small label='Toggle staff access' onPress={() => { staff = !staff; setRevision(value => value + 1) }} />
            </View>
        </View>
        {mode === 'Support' && <SupportDeskScreen key={revision} settings={settings} liveAdapter={supportLive} />}
        {mode === 'Directory' && <OrganizationDirectoryScreen settings={settings} onSelectOrganization={id => { setWorkspace(id); setEvent(`Workspace switched: ${id}`) }} />}
        {mode === 'Delivery' && <DeliveryHistoryScreen settings={settings} onConfigure={() => setMode('Integrations')} onOpenCase={ref => setEvent(`Case: ${ref.caseId}`)} />}
        {mode === 'Integrations' && <IntegrationsScreen settings={settings} />}
        {mode === 'AI' && <AiMetricsScreen settings={settings} live={aiLive} onViewLogs={name => setEvent(`Logs: ${name}`)} />}
    </View>
}
registerRootComponent(() => <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider><AppThemeProvider mode='obsidian'><NavigationContainer><Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name='SyntheticOperations' component={Fixture} /></Stack.Navigator></NavigationContainer></AppThemeProvider></SafeAreaProvider></GestureHandlerRootView>)
