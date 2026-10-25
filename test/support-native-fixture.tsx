// Opt-in synthetic UI fixture. Normal index.ts never imports this entry.
// Bundle with EXPO_PUBLIC_SUPPORT_API=https://support.invalid/api; no account storage.
import { registerRootComponent } from 'expo'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { Text } from 'react-native'
import { ProfileSupportPanel } from '../src/components/ProfileSupportPanel'
import { Screen } from '../src/components/ui'
import { AppThemeProvider } from '../src/theme/context'
import type { AppSettings } from '../src/types'
import type { SupportMessage, SupportTicket } from '../src/lib/profile-api'
import { responseLike } from '../src/lib/headers'

if (process.env.EXPO_PUBLIC_SUPPORT_API !== 'https://support.invalid/api') throw new Error('Support fixture requires its exact synthetic API at bundle time.')
const settings = { apiBaseUrl: 'https://support.invalid/api', siteBaseUrl: 'https://support.invalid', userId: 'fixture-user', authToken: 'fixture-token',
    impersonationToken: '', impersonatingUserId: '', selectedOrganizationId: 'personal', themeMode: 'obsidian' } as AppSettings
const openId = '11111111-1111-4111-8111-111111111111', closedId = '22222222-2222-4222-8222-222222222222'
const now = '2026-10-23T10:00:00Z'
let sequence = 0, firstFeedback = true, uncertainSaved = false
const tickets: SupportTicket[] = [
    { id: openId, user_id: settings.userId, subject: 'Open synthetic question', status: 'open', resolution_version: 0, feedback_rating: null, updated_at: now, last_message: 'How can we help?' },
    { id: closedId, user_id: settings.userId, subject: 'Resolved synthetic question', status: 'closed', resolution_version: 3, feedback_rating: null, updated_at: now, last_message: 'Your question is resolved.' },
]
//100 tickets make list-before-composer regressions visible without live data.
for (let index = 0; index < 98; index++) tickets.push({ id: `44444444-4444-4444-8444-${String(index).padStart(12, '0')}`, user_id: settings.userId, subject: `Synthetic history ${index + 1}`, status: 'open', resolution_version: 0, feedback_rating: null, updated_at: now, last_message: 'Earlier synthetic conversation' })
const messages: Record<string, SupportMessage[]> = {
    [openId]: [{ id: 'initial-open', sender_id: 'fixture-agent', sender_name: 'Synthetic Support', body: 'How can we help?', created_at: now }],
    [closedId]: [{ id: 'initial-closed', sender_id: 'fixture-agent', sender_name: 'Synthetic Support', body: 'Your question is resolved. Please rate your experience.', created_at: now }],
}
const replies = new Map<string, { body: string; id: string }>()
const uuid = () => `33333333-3333-4333-8333-${String(++sequence).padStart(12, '0')}`
const json = (value: unknown, status = 200) => responseLike(JSON.stringify(value), status, '', { 'content-type': 'application/json' })
function append(id: string, body: string, sender = settings.userId) {
    const messageId = uuid()
    messages[id] = [...messages[id] || [], { id: messageId, sender_id: sender, sender_name: sender === settings.userId ? 'You' : 'Synthetic Support', body, created_at: now }]
    const ticket = tickets.find(row => row.id === id)!
    ticket.last_message = body
    return messageId
}
globalThis.fetch = Object.assign(async (...[input, init]: Parameters<typeof fetch>) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url)
    if (url.origin !== 'https://support.invalid' || !url.pathname.startsWith('/api/support/') || url.search || url.hash) throw new Error('All external requests are disabled in this fixture.')
    const method = init?.method || 'GET', path = url.pathname
    if (method === 'GET' && path === '/api/support/my-tickets') return json({ isSupport: false, tickets, realtime: false })
    const body = JSON.parse(String(init?.body || '{}'))
    if (method === 'POST' && path === '/api/support/tickets') {
        if (!body.message?.trim()) return json({ error: 'Message is required.' }, 400)
        const id = uuid()
        tickets.unshift({ id, user_id: settings.userId, subject: body.subject || 'Support question', status: 'open', resolution_version: 0, feedback_rating: null, updated_at: now })
        append(id, body.message)
        return json({ id }, 201)
    }
    const match = path.match(/^\/api\/support\/tickets\/([^/]+)\/(messages|feedback)$/)
    const ticket = match && tickets.find(row => row.id === match[1])
    if (!ticket || !match) return json({ error: 'Support ticket not found.' }, 404)
    if (method === 'GET' && match[2] === 'messages') return json({ messages: messages[ticket.id] || [] })
    if (method === 'POST' && match[2] === 'messages') {
        if (ticket.status === 'closed') return json({ error: 'Chat resolved. Start a new ticket.' }, 409)
        const key = `${ticket.id}:${body.requestId || ''}`, previous = body.requestId && replies.get(key)
        if (previous) return previous.body === body.message ? json({ ok: true, messageId: previous.id }) : json({ error: 'Request ID already used.' }, 409)
        const id = append(ticket.id, body.message)
        if (body.requestId) replies.set(key, { id, body: body.message })
        if (!uncertainSaved && /uncertain/i.test(body.message)) { uncertainSaved = true; throw new Error('Synthetic disconnect after save. Refresh before retrying.') }
        return json({ ok: true, messageId: id })
    }
    if (method === 'POST' && match[2] === 'feedback') {
        if (firstFeedback && ticket.id === closedId) {
            firstFeedback = false; ticket.resolution_version = 4
            return json({ error: 'Synthetic resolution changed. Refresh this conversation; your draft is kept.' }, 409)
        }
        if (ticket.status !== 'closed' || ticket.resolution_version !== body.resolutionVersion) return json({ error: 'Refresh the current resolution.' }, 409)
        if (!Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5 || typeof body.comment !== 'string' || body.comment.length > 2000) return json({ error: 'Invalid feedback.' }, 400)
        if (ticket.feedback_rating !== null && (ticket.feedback_rating !== body.rating || ticket.feedback_comment !== body.comment)) return json({ error: 'Feedback already saved.' }, 409)
        ticket.feedback_rating = body.rating; ticket.feedback_comment = body.rating <= 3 ? body.comment.trim() : ''
        append(ticket.id, `Customer feedback: ${body.rating}/5${ticket.feedback_comment ? ` · ${ticket.feedback_comment}` : ''}`, 'fixture-agent')
        return json({ ok: true })
    }
    return json({ error: 'Unsupported synthetic operation.' }, 400)
}, globalThis.fetch)

registerRootComponent(() => <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider><AppThemeProvider mode='obsidian'>
    <Screen title='Support fixture' subtitle='Synthetic data only'>
        <Text style={{ color: '#b2b9c2', fontSize: 13 }}>100 tickets. Open a conversation or New support ticket: the list must disappear. Back to conversations restores the list. Closed feedback first returns409: refresh, review the retained draft, then submit again. Reply containing “uncertain” saves once and disconnects; refresh then retry to test deduplication.</Text>
        <ProfileSupportPanel settings={settings} revision={0} />
    </Screen>
</AppThemeProvider></SafeAreaProvider></GestureHandlerRootView>)
