import { useEffect, useRef, useState } from 'react'
import { Alert, Text, TextInput, View, type TextInputProps } from 'react-native'
import { randomUUID } from 'expo-crypto'
import type { AppSettings } from '../types'
import { AccountRequestError, fetchAccountSupportTickets, fetchSupportMessages, sendSupportFeedback, sendSupportMessage, supportTicketAccess, type SupportMessage, type SupportTicket } from '../lib/profile-api'
import { GlassCard, InlineNotice, PillButton, SectionTitle } from './ui'
import { useAppTheme } from '../theme/context'
import { getThemePalette, spacing } from '../theme/tokens'

/** Mounted with the account/session/service scope as its key by ProfileScreen. */
export function ProfileSupportPanel({ settings, revision }: { settings: AppSettings; revision: number }) {
    const theme = getThemePalette(settings.themeMode)
    const styles = { row: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm }, item: { gap: spacing.sm, borderTopWidth: 1, borderColor: theme.surfaceBorderSoft, paddingTop: spacing.md }, meta: { color: theme.textMuted, fontSize: 13, lineHeight: 19 }, title: { color: theme.text, fontSize: 15, fontWeight: '700' as const } }
    const [tickets, setTickets] = useState<SupportTicket[]>([])
    const [ticketId, setTicketId] = useState('')
    const [messageSnapshot, setMessageSnapshot] = useState<{ ticket: string; rows: SupportMessage[] }>({ ticket: '', rows: [] })
    const messages = messageSnapshot.ticket === ticketId ? messageSnapshot.rows : []
    const [subject, setSubject] = useState(''), [draft, setDraft] = useState('')
    const [rating, setRating] = useState(0), [comment, setComment] = useState('')
    const [feedbackVersion, setFeedbackVersion] = useState<number | null>(null)
    const [conflict, setConflict] = useState(false)
    const [uncertain, setUncertain] = useState<'create' | 'reply' | 'feedback' | null>(null)
    const [loading, setLoading] = useState(true), [messagesLoading, setMessagesLoading] = useState(false)
    const [error, setError] = useState(''), [messagesError, setMessagesError] = useState(''), [notice, setNotice] = useState('')
    const [busy, setBusy] = useState(false), [reload, setReload] = useState(0)
    const mounted = useRef(true), replyRequest = useRef<{ ticket: string; body: string; id: string } | null>(null)
    const explicitRefresh = useRef(false), submitting = useRef(false), selectedId = useRef('')
    const ticket = tickets.find(row => row.id === ticketId)
    const access = supportTicketAccess(settings, ticket)
    useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
    useEffect(() => {
        const controller = new AbortController()
        setLoading(true); setError('')
        void fetchAccountSupportTickets(settings, controller.signal).then(rows => {
            if (controller.signal.aborted) return
            setTickets(rows)
            if (explicitRefresh.current) {
                const fresh = rows.find(row => row.id === selectedId.current)
                setFeedbackVersion(fresh?.resolution_version ?? null); setConflict(false)
                setUncertain(value => value === 'create' ? value : null); explicitRefresh.current = false
            }
        }).catch(cause => { if (!controller.signal.aborted) setError(explain(cause)) })
            .finally(() => { if (!controller.signal.aborted) setLoading(false) })
        return () => controller.abort()
        // A new account/session/service mounts a new panel. Selection does not reload the list.
    }, [revision, reload])
    useEffect(() => {
        const controller = new AbortController()
        setMessageSnapshot({ ticket: '', rows: [] }); setMessagesError(''); setMessagesLoading(!!ticketId)
        if (ticketId) void fetchSupportMessages(settings, ticketId, controller.signal).then(rows => { if (!controller.signal.aborted) setMessageSnapshot({ ticket: ticketId, rows }) })
            .catch(cause => { if (!controller.signal.aborted) setMessagesError(explain(cause)) })
            .finally(() => { if (!controller.signal.aborted) setMessagesLoading(false) })
        return () => controller.abort()
    }, [ticketId, revision, reload])
    function select(row?: SupportTicket) {
        selectedId.current = row?.id || ''; setTicketId(selectedId.current); setDraft(''); setSubject(''); setRating(0); setComment('')
        setFeedbackVersion(row?.resolution_version ?? null); setConflict(false); setUncertain(null); setError(''); setNotice(''); replyRequest.current = null
    }
    function newTicket() {
        if (uncertain === 'create') Alert.alert('Start another ticket?', 'The previous request may already have created a ticket. Refresh and check your conversations first.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Start another ticket', onPress: () => select() }])
        else select()
    }
    function refresh() { explicitRefresh.current = true; setReload(value => value + 1) }
    async function submit(feedback = false) {
        if (submitting.current || loading || error || !access.ownAccount) return
        if (feedback && (!ticket || !access.canFeedback || conflict || uncertain || feedbackVersion === null)) return
        if (!feedback && (uncertain || messagesLoading || messagesError || ticketId && !access.canReply)) return
        submitting.current = true; setBusy(true); setError(''); setNotice('')
        try {
            if (feedback && ticket) {
                await sendSupportFeedback(settings, { ...ticket, resolution_version: feedbackVersion! }, rating, comment)
                if (!mounted.current) return
                setNotice('Feedback saved.'); setRating(0); setComment('')
            } else {
                const text = draft.trim()
                if (ticketId && (replyRequest.current?.ticket !== ticketId || replyRequest.current.body !== text)) replyRequest.current = { ticket: ticketId, body: text, id: randomUUID() }
                const result = await sendSupportMessage(settings, ticketId, subject.trim(), text, ticketId ? replyRequest.current?.id : undefined)
                if (!mounted.current) return
                setDraft(''); replyRequest.current = null
                if (result.id) { selectedId.current = result.id; setTicketId(result.id) }
                setNotice('Message sent.')
            }
            setReload(value => value + 1)
        } catch (cause) {
            if (!mounted.current) return
            setError(explain(cause))
            if (cause instanceof AccountRequestError && cause.status === 409) setConflict(true)
            else if (!(cause instanceof AccountRequestError) || cause.status >= 500) setUncertain(feedback ? 'feedback' : ticketId ? 'reply' : 'create')
        } finally { submitting.current = false; if (mounted.current) setBusy(false) }
    }
    return <GlassCard style={{ gap: spacing.md }}>
        <SectionTitle eyebrow='Account' title='Support conversations' />
        <View style={styles.row}><PillButton label='New support ticket' disabled={busy} onPress={newTicket} /><PillButton label='Refresh conversations' disabled={loading || busy} onPress={refresh} /></View>
        <InlineNotice message={error || messagesError} />
        <InlineNotice message={notice} tone='success' />
        {!access.ownAccount && <Text style={styles.meta}>Return to your own account to send messages or feedback.</Text>}
        {!!uncertain && <Text style={styles.meta}>This request may have been saved. Refresh and review the conversation before sending again. Your draft is kept.</Text>}
        {conflict && <Text style={styles.meta}>The conversation changed. Refresh and review it before submitting. Your draft is kept.</Text>}
        {loading && <Text accessibilityRole='progressbar' style={styles.meta}>Loading conversations…</Text>}
        {!loading && !error && !tickets.length && <Text style={styles.meta}>No support tickets yet.</Text>}
        {tickets.map(row => <View key={row.id} style={styles.item}>
            <Text style={styles.title}>{row.subject}</Text><Text style={styles.meta}>{row.status} · {date(row.updated_at)}</Text>
            <Text style={styles.meta}>{row.last_message || 'No messages yet'}</Text>
            <PillButton small label={ticketId === row.id ? 'Selected conversation' : 'Read conversation'} disabled={busy || ticketId === row.id} tone={ticketId === row.id ? 'accent' : 'default'} onPress={() => select(row)} />
        </View>)}
        <View style={styles.item}>
            <SectionTitle eyebrow='Support' title={ticketId ? ticket?.subject || 'Conversation' : 'New ticket'} />
            {messagesLoading && <Text accessibilityRole='progressbar' style={styles.meta}>Loading conversation…</Text>}
            {messages.map(row => <View key={row.id} style={styles.item}><Text style={styles.title}>{row.sender_name || (row.sender_id === settings.userId ? 'You' : 'Support')}</Text><Text selectable style={styles.meta}>{row.body}</Text><Text style={styles.meta}>{date(row.created_at)}</Text></View>)}
            {ticket?.status === 'closed' ? <>
                <Text style={styles.meta}>This conversation is resolved. Start a new ticket if you need more help.</Text>
                {ticket.feedback_rating ? <Text style={styles.meta}>Your feedback: {ticket.feedback_rating}/5{ticket.feedback_comment ? ` · ${ticket.feedback_comment}` : ''}</Text> : access.canFeedback && <>
                    <Text style={styles.title}>How was your support experience?</Text>
                    <View style={styles.row}>{[1, 2, 3, 4, 5].map(star => <PillButton key={star} small label={`${star} ${star === 1 ? 'star' : 'stars'}`} tone={rating === star ? 'accent' : 'default'} disabled={busy || conflict || !!uncertain} onPress={() => setRating(star)} />)}</View>
                    {rating > 0 && rating <= 3 && <SupportInput label='What could we improve? (optional)' value={comment} onChangeText={setComment} maxLength={2000} multiline editable={!busy && !conflict && !uncertain} />}
                    <PillButton label='Send feedback' tone='accent' disabled={busy || loading || !!error || !rating || conflict || !!uncertain || feedbackVersion === null} onPress={() => void submit(true)} />
                </>}
            </> : <>
                {!ticketId && <SupportInput label='Subject' value={subject} onChangeText={setSubject} maxLength={160} editable={!busy && !uncertain && access.ownAccount} />}
                <SupportInput label='Message' value={draft} onChangeText={setDraft} maxLength={10000} multiline editable={!busy && !uncertain && access.ownAccount && (!ticketId || access.canReply)} />
                <PillButton label={ticketId ? 'Send reply' : 'Create ticket'} tone='accent' disabled={busy || loading || !!error || messagesLoading || !!messagesError || !!uncertain || !access.ownAccount || !!ticketId && !access.canReply || !draft.trim() || !ticketId && !subject.trim()} onPress={() => void submit()} />
            </>}
        </View>
    </GlassCard>
}
function explain(error: unknown) { return error instanceof Error ? error.message : 'Unable to complete this request.' }
function date(value: string) { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? 'Not recorded' : parsed.toLocaleString() }

function SupportInput({ label, ...props }: TextInputProps & { label: string }) {
    const theme = useAppTheme()
    return <View style={{ gap: 8 }}><Text style={{ color: theme.textMuted, fontSize: 13 }}>{label}</Text><TextInput {...props}
        accessibilityLabel={label} placeholderTextColor={theme.textSoft}
        style={{ color: theme.text, backgroundColor: theme.ambientNeutral, borderColor: theme.surfaceBorderSoft, borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 15, minHeight: props.multiline ? 88 : 44, textAlignVertical: props.multiline ? 'top' : 'center' }} /></View>
}
