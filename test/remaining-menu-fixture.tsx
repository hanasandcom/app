// Opt-in synthetic entry. Normal startup never imports this file.
import { useState } from 'react'
import { Text, View } from 'react-native'
import { registerRootComponent } from 'expo'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { AppThemeProvider } from '../src/theme/context'
import { PillButton } from '../src/components/ui'
import { UserManagementScreen } from '../src/screens/UserManagementScreen'
import { LoadTestsScreen } from '../src/screens/LoadTestsScreen'
import type { LoadSocket, LoadSocketTransport } from '../src/lib/load-test-live'
import type { AppSettings } from '../src/types'

const settings = { themeMode: 'obsidian', apiBaseUrl: 'https://api.synthetic.invalid/api', siteBaseUrl: 'https://synthetic.invalid',
    userId: 'synthetic-operator', authToken: 'synthetic-token', selectedOrganizationId: 'fixture-org', impersonationToken: '', impersonatingUserId: '' } as AppSettings
const org = { id: 'fixture-org', name: 'Synthetic team', slug: 'synthetic-team', status: 'active' }
const at = '2026-10-23T07:00:00Z'
const users = Array.from({ length: 36 }, (_, index) => ({ id: index === 0 ? settings.userId : `fixture-user-${index}`, name: index ? `Fixture person ${String(index).padStart(2, '0')}` : 'Fixture operator',
    username: index ? `fixture-person-${index}` : 'fixture-operator', email: `person-${index}@synthetic.invalid`, active: true, avatar: '', created_at: at, last_login_at: at,
    deactivated_at: null as string | null, deactivated_by: null as string | null, organization_memberships: [org], deletion_scheduled_at: null as string | null }))
const tests = [{ id: 'fixture-scan', url: 'https://target.synthetic.invalid/check', status: 'done', timeout: 30,
    stages: [{ duration: '30s', target: 1 }], logs: ['Synthetic run completed.'], errors: [] as string[], created_at: at, started_at: at, finished_at: at,
    exit_code: 0, queue_position: 0, latest_run_number: 2, visits: 3, duration: { seconds: 30 },
    summary: { requests: 32, checks: 32, failures: 0, failureRate: 0, duration: { avg: 23, med: 20, p95: 30, max: 35 },
        rps: [{ time: at, value: 1 }, { time: '2026-10-23T07:00:30Z', value: 1.1 }] },
    previous_run_summary: { requests: 30, duration: { p95: 35 } }, p95_delta_ms: 5 }]
let hold = false, fail = false, release: (() => void) | undefined
const sockets = new Set<LoadSocket>()
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
async function finishWrite(value: unknown) {
    if (hold) await new Promise<void>(resolve => { release = resolve })
    return fail ? json({ error: 'Synthetic response lost after the change was saved.' }, 500) : json(value)
}
globalThis.fetch = Object.assign(async (...[input, init]: Parameters<typeof fetch>) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (!['https://api.synthetic.invalid', 'https://synthetic.invalid'].includes(url.origin) || url.username || url.password || url.hash) throw new Error('External requests are disabled in this synthetic fixture.')
    const headers = new Headers(init?.headers)
    if (headers.get('authorization') !== 'Bearer synthetic-token' || headers.get('id') !== settings.userId) return json({ error: 'Synthetic actor headers missing.' }, 401)
    const method = init?.method || 'GET', body = init?.body ? JSON.parse(String(init.body)) : {}
    if (method === 'GET') {
        if (url.pathname === '/api/management/organizations') return json({ allowed: true, canEdit: true, organizations: [org] })
        if (url.pathname === '/api/users') return json(users.filter(user => !user.deletion_scheduled_at))
        if (url.pathname.startsWith('/api/user/')) {
            const user = users.find(user => user.id === decodeURIComponent(url.pathname.slice('/api/user/'.length)))
            return user ? json(user) : json({ error: 'Synthetic profile not visible.' }, 404)
        }
        if (url.pathname === '/api/tests/mine' || url.pathname === '/api/tests/recent') return json(tests)
        if (url.pathname === '/api/tests/quota') return json({ identity: settings.userId, plan: 'free', limit: 5, used: 1, remaining: 4, resetsAt: null })
        if (url.pathname.startsWith('/api/test/')) return json(tests.find(test => test.id === decodeURIComponent(url.pathname.slice('/api/test/'.length))) ?? null)
    }
    const account = /^\/api\/user\/([^/]+)(\/active)?$/.exec(url.pathname)
    if (account && (method === 'DELETE' && !account[2] || method === 'PUT' && account[2])) {
        const user = users.find(user => user.id === decodeURIComponent(account[1]))
        if (!user) return json({ error: 'Synthetic user missing.' }, 404)
        if (method === 'PUT' && typeof body.active === 'boolean') {
            user.active = body.active; user.deactivated_at = body.active ? null : at
            return finishWrite({ id: user.id, name: user.name, active: user.active })
        }
        if (method === 'DELETE') {
            user.deletion_scheduled_at = '2026-11-22T07:00:00Z'; user.active = false
            return finishWrite({ pending_deletion: true, user })
        }
    }
    if (method === 'POST' && url.pathname === '/api/test') {
        const test = { ...tests[0], id: `fixture-scan-${tests.length + 1}`, url: body.url, timeout: body.timeout, stages: body.stages, status: 'queued' }
        tests.unshift(test)
        return finishWrite({ ...test, quota: { plan: 'free', limit: 5, used: 2, remaining: 3, resetsAt: null } })
    }
    if (method === 'POST' && /^\/api\/test\/[^/]+\/rerun$/.test(url.pathname)) {
        const test = tests.find(test => test.id === decodeURIComponent(url.pathname.split('/')[3]))
        if (!test) return json({}, 404)
        if (['queued', 'running'].includes(test.status)) return json({}, 409)
        test.status = 'queued'
        return finishWrite({ ok: true, status: 'queued' })
    }
    throw new Error(`Unsupported synthetic write blocked or read unavailable: ${method} ${url.pathname}`)
}) as typeof fetch
const liveTransport: LoadSocketTransport = address => {
    const url = new URL(address)
    if (url.origin !== 'wss://api.synthetic.invalid' || !/^\/api\/ws\/test\/fixture-scan(?:-\d+)?$/.test(url.pathname)) throw new Error('External sockets are disabled.')
    const socket: LoadSocket = { onopen: null, onmessage: null, onerror: null, onclose: null, close: () => { sockets.delete(socket) } }
    sockets.add(socket)
    setTimeout(() => { if (sockets.has(socket)) { socket.onopen?.(); socket.onmessage?.({ data: JSON.stringify({ type: 'join', participants: 1 }) }) } }, 0)
    return socket
}
const Stack = createNativeStackNavigator()
function Fixture() {
    const [mode, setMode] = useState('Users'), [event, setEvent] = useState('No synthetic operations yet')
    return <View style={{ flex: 1 }}>
        <View style={{ paddingTop: 52, paddingHorizontal: 16, gap: 6, backgroundColor: '#101418' }}>
            <Text style={{ color: '#b2b9c2' }}>Synthetic only · no external requests</Text>
            <Text style={{ color: '#b2b9c2' }}>{event}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {['Users', 'Load testing'].map(name => <PillButton key={name} small label={`Fixture ${name}`} onPress={() => setMode(name)} />)}
                <PillButton small label='Toggle held response' onPress={() => { hold = !hold; setEvent(`Hold: ${hold}`) }} />
                <PillButton small label='Release response' onPress={() => { release?.(); release = undefined; setEvent('Released synthetic response') }} />
                <PillButton small label='Toggle saved-but-error' onPress={() => { fail = !fail; setEvent(`Saved then error: ${fail}`) }} />
                <PillButton small label='Emit synthetic live log' onPress={() => { for (const socket of sockets) socket.onmessage?.({ data: JSON.stringify({ type: 'update', data: { type: 'log', message: 'Synthetic live evidence' } }) }) }} />
            </View>
        </View>
        {mode === 'Users' ? <UserManagementScreen settings={settings} onSelectOrganization={id => setEvent(`Open organization: ${id}`)} /> : <LoadTestsScreen settings={settings} liveTransport={liveTransport} />}
    </View>
}
registerRootComponent(() => <GestureHandlerRootView style={{ flex: 1 }}><AppThemeProvider mode='obsidian'><NavigationContainer><Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name='SyntheticRemainingMenu' component={Fixture} /></Stack.Navigator></NavigationContainer></AppThemeProvider></GestureHandlerRootView>)
