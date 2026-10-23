import { useEffect, useRef, useState } from 'react'
import { Alert, AppState, Text, View, type ScrollView } from 'react-native'
import { useIsFocused } from '@react-navigation/native'
import { randomUUID } from 'expo-crypto'
import type { AppSettings } from '../types'
import type { SupportMessage } from '../lib/profile-api'
import { ProfileSupportPanel } from '../components/ProfileSupportPanel'
import { SupportAccountEditor } from '../components/SupportAccountEditor'
import { SupportDeskFilters, SupportDeskInput } from '../components/SupportDeskFilters'
import { GlassCard, InlineNotice, PillButton, Screen, SectionTitle } from '../components/ui'
import { useAppTheme } from '../theme/context'
import {
    canEditDeskInput, deskInputKey, changeDeskAccount, deskFilterQuery, emptyDeskFilters, loadDeskMessages, loadSupportDesk,
    replyToDeskTicket, setDeskTicketStatus, supportDeskScope, validateSupportAccountChange,
    visibleDeskTickets, type DeskFilters, type DeskTicket, type SupportDesk
} from '../lib/support-desk'
import { startSupportLive, type SupportLiveAdapter, type SupportLiveStatus } from '../lib/support-live'

export function SupportDeskScreen({ settings, liveAdapter }: { settings: AppSettings; liveAdapter?: SupportLiveAdapter }) {
    return <SupportDeskWorkspace key={supportDeskScope(settings)} settings={settings} liveAdapter={liveAdapter} />
}
function SupportDeskWorkspace({ settings, liveAdapter }: { settings: AppSettings; liveAdapter?: SupportLiveAdapter }) {
    const theme = useAppTheme(), focused = useIsFocused(), scroll = useRef<ScrollView>(null)
    const [foreground, setForeground] = useState(AppState.currentState === 'active')
    const [desk, setDesk] = useState<SupportDesk | null>(null), [messages, setMessages] = useState<SupportMessage[]>([])
    const [filters, setFilters] = useState<DeskFilters>({ ...emptyDeskFilters }), [filterOpen, setFilterOpen] = useState(false)
    const [selected, setSelected] = useState(''), [draft, setDraft] = useState(''), [accountOpen, setAccountOpen] = useState(false)
    const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [verified, setVerified] = useState(false)
    const [error, setError] = useState(''), [notice, setNotice] = useState(''), [uncertain, setUncertain] = useState(false)
    const [connection, setConnection] = useState<SupportLiveStatus>('Connecting'), [reconnect, setReconnect] = useState(0)
    const [accountClear, setAccountClear] = useState(0), [customerRevision, setCustomerRevision] = useState(0)
    const live = useRef(true), visible = useRef(false), epoch = useRef(0), review = useRef(0), locked = useRef(false)
    const reading = useRef<AbortController | null>(null), writing = useRef<AbortController | null>(null), queued = useRef(false)
    const selectedId = useRef(''), applied = useRef<DeskFilters>({ ...emptyDeskFilters })
    const drafts = useRef<Record<string, string>>({}), requestId = useRef<{ ticket: string; body: string; id: string } | null>(null)
    const sync = useRef<() => void>(() => {}), inputAllowed = useRef(false), inputEpoch = useRef(0)
    visible.current = focused && foreground
    const ticket = desk?.tickets.find(row => row.id === selected)
    const writable = verified && desk?.isSupport === true && !settings.impersonationToken
        && !settings.impersonatingUserId && !busy && !loading && !uncertain && visible.current
    inputAllowed.current = writable
    const inputGeneration = inputEpoch.current
    function editAllowed(id: string) {
        return canEditDeskInput({ alive: live.current, visible: visible.current, allowed: inputAllowed.current,
            reading: !!reading.current, writing: !!writing.current, locked: locked.current, ticket: id, selected: selectedId.current, generation: inputEpoch.current, capturedGeneration: inputGeneration })
    }
    const meta = { color: theme.textMuted, fontSize: 13, lineHeight: 20 }
    const row = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 }
    function hide() {
        epoch.current++; review.current++; inputEpoch.current++; queued.current = false
        reading.current?.abort(); reading.current = null
        if (writing.current) {
            locked.current = true; setUncertain(true)
            setError('A change was interrupted. Its outcome is unknown. Refresh and review before another change.')
            writing.current.abort(); writing.current = null
        }
        setVerified(false); setLoading(false); setBusy(false); setAccountOpen(false); setAccountClear(value => value + 1)
    }
    useEffect(() => {
        const subscription = AppState.addEventListener('change', state => {
            if (state !== 'active') { visible.current = false; hide() }
            setForeground(state === 'active')
        })
        return () => subscription.remove()
    }, [])
    useEffect(() => {
        live.current = true
        return () => { live.current = false; epoch.current++; review.current++; reading.current?.abort(); writing.current?.abort() }
    }, [])
    useEffect(() => {
        if (!focused || !foreground) { hide(); return }
        void load(false)
        return () => { review.current++; reading.current?.abort() }
    }, [focused, foreground])
    sync.current = () => { setCustomerRevision(value => value + 1); void load(false) }
    const liveEnabled = desk?.realtime === true
    useEffect(() => {
        if (!focused || !foreground || !liveEnabled) return
        const controller = new AbortController()
        let stop = () => {}
        try { stop = startSupportLive(settings, { status: setConnection, changed: () => sync.current() }, controller.signal, liveAdapter) }
        catch { setConnection('Live updates unavailable') }
        return () => { controller.abort(); stop() }
    }, [focused, foreground, liveEnabled, reconnect, liveAdapter])
    async function load(explicit: boolean, target = selectedId.current) {
        if (!live.current || !visible.current) return
        if (writing.current || reading.current) { if (!explicit) queued.current = true; return }
        const controller = new AbortController(), own = ++epoch.current
        reading.current = controller; review.current++; inputEpoch.current++; setLoading(true); setVerified(false)
        const current = () => live.current && visible.current && epoch.current === own && !controller.signal.aborted
        try {
            const next = await loadSupportDesk(settings, applied.current, controller.signal)
            if (!current()) return
            const id = next.isSupport && target ? next.tickets.find(item => item.id === target)?.id || '' : ''
            const rows = id ? await loadDeskMessages(settings, id, controller.signal) : []
            if (!current()) return
            setDesk(next); setMessages(rows); selectedId.current = id; setSelected(id)
            inputEpoch.current++; setDraft(drafts.current[id] || ''); setVerified(true)
            if (explicit) { locked.current = false; setUncertain(false); setError(''); setReconnect(value => value + 1) }
            else if (!locked.current) setError('')
        } catch (cause) { if (current()) setError(message(cause)) }
        finally {
            if (reading.current === controller) {
                reading.current = null
                if (current()) { setLoading(false); if (queued.current) { queued.current = false; void load(false) } }
            }
        }
    }
    function select(next: DeskTicket) {
        if (busy || loading) return
        inputEpoch.current++; drafts.current[selectedId.current] = draft
        selectedId.current = next.id; setSelected(next.id); setDraft(drafts.current[next.id] || '')
        setMessages([]); setAccountOpen(false); setNotice(''); review.current++
        scroll.current?.scrollTo({ y: 0, animated: false }); void load(false, next.id)
    }
    function confirm(title: string, body: string, action: (signal: AbortSignal) => Promise<string>) {
        if (!writable || !ticket) return
        const version = ++review.current, target = ticket.id
        Alert.alert(title, body, [{ text: 'Cancel', style: 'cancel' }, {
            text: 'Confirm', style: 'destructive', onPress: () => {
                if (review.current !== version || selectedId.current !== target || !visible.current || locked.current) return
                void mutate(action)
            }
        }])
    }
    async function mutate(action: (signal: AbortSignal) => Promise<string>) {
        if (!visible.current || writing.current || reading.current || locked.current || !desk?.isSupport
            || settings.impersonationToken || settings.impersonatingUserId) return
        const controller = new AbortController(), own = ++epoch.current
        writing.current = controller; review.current++; inputEpoch.current++; setBusy(true); setError(''); setNotice(''); setAccountClear(value => value + 1)
        const current = () => live.current && visible.current && epoch.current === own && !controller.signal.aborted
        let succeeded = false
        try {
            const result = await action(controller.signal)
            if (!current()) return
            succeeded = true; setNotice(result)
        } catch (cause) {
            if (current()) { locked.current = true; setUncertain(true); setVerified(false); setError(message(cause)) }
        } finally {
            if (writing.current === controller) {
                writing.current = null; inputEpoch.current++
                if (current()) { setAccountClear(value => value + 1); setBusy(false); if (succeeded) void load(false) }
            }
        }
    }
    function reply() {
        if (!ticket || !desk) return
        const body = draft.trim(), target = ticket
        if (!requestId.current || requestId.current.ticket !== target.id || requestId.current.body !== body)
            requestId.current = { ticket: target.id, body, id: randomUUID() }
        const id = requestId.current.id
        confirm('Send support reply?', `Send this reply to ${target.user_name || 'the selected customer'} in “${target.subject}”?`, async signal => {
            await replyToDeskTicket(settings, desk, target, body, id, signal)
            if (!signal.aborted) { drafts.current[target.id] = ''; setDraft('') }
            return 'Reply sent.'
        })
    }
    function status() {
        if (!ticket || !desk) return
        const target = ticket, next = target.status === 'closed' ? 'open' : 'closed'
        confirm(next === 'closed' ? 'Resolve conversation?' : 'Reopen conversation?',
            `${next === 'closed' ? 'Resolve' : 'Reopen'} “${target.subject}” for ${target.user_name || 'this customer'}?`, async signal => {
                await setDeskTicketStatus(settings, desk, target, next, signal)
                return next === 'closed' ? 'Conversation resolved.' : 'Conversation reopened.'
            })
    }
    function account(field: 'password' | 'email', value: string) {
        if (!ticket || !desk) return
        try { validateSupportAccountChange(field, value) } catch (cause) { setError(message(cause)); return }
        const target = ticket
        confirm(`Change customer ${field}?`, `Change ${field} for ${target.user_name || target.user_id} in “${target.subject}”?`
            + (field === 'password' ? ' Existing customer sessions will be revoked.' : ` New address: ${value}`), async signal => {
            await changeDeskAccount(settings, desk, target, field, value, signal)
            return field === 'password' ? 'Password changed. Existing customer sessions were revoked.' : 'Customer email address changed.'
        })
    }
    return <Screen title='Support' subtitle={desk?.isSupport ? 'Customer conversations · global queue' : 'Conversations with the support team'} scrollViewRef={scroll}
        right={<PillButton small label='Refresh' disabled={loading || busy} onPress={() => void load(true)} />}>
        <InlineNotice message={error} /><InlineNotice message={notice} tone='success' />
        {uncertain && <InlineNotice message='Refresh and review the conversation before another change. Server work may continue after this screen closes.' />}
        {!visible.current && <Text style={meta}>Support is paused while this screen is inactive.</Text>}
        {loading && <Text accessibilityRole='progressbar' style={meta}>Loading Support…</Text>}
        {visible.current && <Text style={meta}>{liveEnabled ? connection : desk ? 'Live updates are not active for this queue.' : 'Support connection has not been verified.'}</Text>}
        {desk?.isSupport === false && <View style={{ display: visible.current ? 'flex' : 'none' }}>
            <ProfileSupportPanel settings={settings} revision={customerRevision} />
        </View>}
        {desk?.isSupport && visible.current && <>
            <View style={row}><PillButton small label={filterOpen ? 'Hide filters' : 'Find conversations'} onPress={() => { review.current++; setFilterOpen(value => !value) }} />
                <Text style={meta}>{visibleDeskTickets(desk.tickets, applied.current.status).length} matching · {desk.tickets.length} loaded · latest 100 maximum</Text>
            </View>
            {filterOpen && <SupportDeskFilters filters={filters} disabled={busy || loading}
                onChange={value => { review.current++; setFilters(value) }} onApply={() => {
                    try { deskFilterQuery(filters); applied.current = { ...filters }; setFilterOpen(false); void load(false) }
                    catch (cause) { setError(message(cause)) }
                }} />}
            {ticket && <GlassCard style={{ gap: 12 }}>
                <PillButton small label='Back to queue' disabled={busy || loading} onPress={() => { review.current++; setSelected(''); selectedId.current = ''; setAccountOpen(false) }} />
                <SectionTitle eyebrow={ticket.status === 'closed' ? 'Resolved' : 'Open'} title={ticket.subject} body={ticket.user_name || ticket.user_id || 'Visitor'} />
                <Text style={meta}>Updated {date(ticket.updated_at)} · Channel: {ticket.channel || 'Not supplied'}</Text>
                {ticket.feedback_rating != null && <Text style={meta}>Customer feedback: {ticket.feedback_rating}/5{ticket.feedback_comment ? ` · ${ticket.feedback_comment}` : ''}</Text>}
                <PillButton label={ticket.status === 'closed' ? 'Reopen conversation' : 'Resolve conversation'} disabled={!writable} onPress={status} />
                {messages.map(item => <View key={item.id} style={{ gap: 5, paddingVertical: 8, borderTopWidth: 1, borderColor: theme.surfaceBorderSoft }}>
                    <Text style={{ color: theme.text, fontWeight: '700' }}>{item.sender_name}</Text>
                    <Text selectable style={{ color: theme.text, lineHeight: 22 }}>{item.body}</Text>
                    <Text style={meta}>{date(item.created_at)}</Text>
                </View>)}
                {!messages.length && !loading && <Text style={meta}>No messages returned.</Text>}
                <SupportDeskInput key={deskInputKey(ticket.id, accountClear)} label='Reply to customer' value={draft} multiline maxLength={10000}
                    editable={writable && ticket.status !== 'closed'} onChangeText={value => {
                        if (!editAllowed(ticket.id) || ticket.status === 'closed') return
                        review.current++; drafts.current[ticket.id] = value; setDraft(value)
                    }} />
                <PillButton label='Review and send reply' tone='accent' disabled={!writable || ticket.status === 'closed' || !draft.trim()} onPress={reply} />
                {ticket.user_id && ticket.channel === 'human' && <PillButton label='Customer account changes' disabled={!writable}
                    onPress={() => { review.current++; setAccountOpen(value => !value) }} />}
            </GlassCard>}
            {accountOpen && ticket?.user_id && <SupportAccountEditor key={deskInputKey(ticket.id, accountClear)} active={visible.current}
                disabled={!writable} clearRevision={accountClear} onDirty={() => {
                    if (!editAllowed(ticket.id)) return false
                    review.current++; return true
                }} onReview={account} />}
            {!ticket && visibleDeskTickets(desk.tickets, applied.current.status).map(item => <GlassCard key={item.id} style={{ gap: 8 }}>
                <Text style={{ color: theme.text, fontWeight: '700' }}>{item.subject}</Text>
                <Text style={meta}>{item.user_name || item.user_id || 'Visitor'} · {item.status} · {date(item.updated_at)}</Text>
                {!!item.last_message && <Text numberOfLines={2} style={meta}>{item.last_message}</Text>}
                <PillButton small label={`Open conversation: ${item.subject}`} disabled={busy || loading} onPress={() => select(item)} />
            </GlassCard>)}
            {!ticket && !visibleDeskTickets(desk.tickets, applied.current.status).length && <Text style={meta}>No conversations match these filters.</Text>}
        </>}
    </Screen>
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : 'Support is unavailable. Refresh to try again.' }
function date(value: string) { return Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Date unavailable' }
