import { useEffect, useRef, useState } from 'react'
import { Alert, AppState, Text, TextInput, View } from 'react-native'
import { useIsFocused } from '@react-navigation/native'
import type { AppSettings } from '../types'
import { GlassCard, InlineNotice, PillButton, Screen, SectionTitle } from '../components/ui'
import { DeliveryAttempt } from '../components/DeliveryAttempt'
import { useAppTheme } from '../theme/context'
import {
    deliveryCaseRef, deliveryHistoryScope, deliveryRetryTarget, DeliveryHistoryError, filterDeliveryAlerts,
    loadDeliveryHistory, orderDeliveryAttempts, performDeliveryAction, selectedDeliveryAttempts,
    type DeliveryAction, type DeliveryCaseRef, type DeliveryHistoryPage,
} from '../lib/delivery-history'

type Props = { settings: AppSettings; onConfigure: () => void; onOpenCase: (ref: DeliveryCaseRef) => void }
export function DeliveryHistoryScreen(props: Props) {
    return <WorkspaceDelivery key={deliveryHistoryScope(props.settings)} {...props} />
}
function WorkspaceDelivery({ settings, onConfigure, onOpenCase }: Props) {
    const theme = useAppTheme(), focused = useIsFocused()
    const [foreground, setForeground] = useState(AppState.currentState === 'active')
    const [page, setPage] = useState<DeliveryHistoryPage | null>(null)
    const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false)
    const [error, setError] = useState(''), [notice, setNotice] = useState('')
    const [revision, setRevision] = useState(0), [selectedId, setSelectedId] = useState('')
    const [pickerOpen, setPickerOpen] = useState(false)
    const [query, setQuery] = useState(''), [reviewOnly, setReviewOnly] = useState(false)
    const [pickerPage, setPickerPage] = useState(0), [historyPage, setHistoryPage] = useState(0)
    const [mustRefresh, setMustRefresh] = useState(false)
    const mounted = useRef(true), active = useRef(false), saving = useRef(false), review = useRef(false), epoch = useRef(0)
    const request = useRef<AbortController | null>(null), write = useRef<AbortController | null>(null)
    const allowReconcile = useRef(true)
    const selection = useRef(selectedId); selection.current = selectedId
    const personal = !settings.selectedOrganizationId || settings.selectedOrganizationId === 'personal' || settings.selectedOrganizationId === settings.userId
    const row = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 }
    const meta = { color: theme.textMuted, fontSize: 13, lineHeight: 20 }
    useEffect(() => {
        mounted.current = true
        const listener = AppState.addEventListener('change', state => {
            if (state !== 'active') {
                active.current = false; epoch.current++; request.current?.abort(); write.current?.abort()
                if (saving.current) { review.current = true; setMustRefresh(true) }
                setPage(null)
            }
            setForeground(state === 'active')
        })
        return () => { mounted.current = false; active.current = false; epoch.current++; request.current?.abort(); write.current?.abort(); listener.remove() }
    }, [])
    useEffect(() => {
        active.current = focused && foreground
        if (!active.current || personal) return
        const current = ++epoch.current, controller = new AbortController()
        request.current = controller
        setLoading(true); setError('')
        void loadDeliveryHistory(settings, controller.signal).then(value => {
            if (controller.signal.aborted || current !== epoch.current || !active.current) return
            setPage(value)
            setSelectedId(id => value.alerts.some(row => row.id === id) ? id : value.alerts[0]?.id || '')
            if (allowReconcile.current) { review.current = false; setMustRefresh(false) }
        }).catch(cause => {
            if (!controller.signal.aborted && current === epoch.current) { setError(message(cause)); setPage(null) }
        }).finally(() => { if (!controller.signal.aborted && current === epoch.current) setLoading(false) })
        return () => {
            active.current = false; epoch.current++; controller.abort(); write.current?.abort()
            if (saving.current) { review.current = true; setMustRefresh(true) }
        }
        // Account, session, API and workspace changes remount this component.
    }, [focused, foreground, personal, revision, settings])
    const disabled = loading || busy || mustRefresh || !active.current
    const selected = page?.alerts.find(row => row.id === selectedId)
    const attempts = page ? selectedDeliveryAttempts(page, selectedId) : []
    const lastSuccess = attempts.find(row => row.status === 'delivered' && !row.dryRun)
    const lastFailure = attempts.find(row => row.status === 'failed')
    const filtered = filterDeliveryAlerts(page?.alerts || [], query, reviewOnly)
    const currentPickerPage = Math.min(pickerPage, Math.max(0, Math.ceil(filtered.length / 20) - 1))
    const currentHistoryPage = Math.min(historyPage, Math.max(0, Math.ceil(attempts.length / 10) - 1))
    function refresh() {
        if (saving.current) return
        allowReconcile.current = true
        epoch.current++; request.current?.abort(); setRevision(value => value + 1)
    }
    async function perform(action: DeliveryAction, deliveryId?: string) {
        if (!page || saving.current || review.current || disabled || !active.current) return
        const alertId = action === 'retry' ? deliveryRetryTarget(page, deliveryId)?.alertId : selected?.id
        if (!alertId) return
        saving.current = true; allowReconcile.current = false; setBusy(true); setError(''); setNotice('')
        const current = epoch.current, controller = new AbortController()
        write.current = controller
        try {
            const result = await performDeliveryAction(settings, page, action, alertId, deliveryId, controller.signal)
            if (current !== epoch.current || !mounted.current || !active.current) return
            setNotice(result.message)
            setPage(value => value && { ...value, attempts: orderDeliveryAttempts([...result.attempts, ...value.attempts.filter(row => !result.attempts.some(receipt => receipt.id === row.id))]) })
            // Every write requires a fresh read of server permission/retry state before another action.
            review.current = true; setMustRefresh(true)
        } catch (cause) {
            if (current !== epoch.current || !mounted.current) return
            setError(message(cause)); review.current = true; setMustRefresh(true)
        } finally {
            saving.current = false
            if (mounted.current) {
                setBusy(false)
                if (current !== epoch.current) { review.current = true; setMustRefresh(true) }
            }
        }
    }
    function confirm(action: DeliveryAction, deliveryId?: string) {
        if (disabled || review.current || saving.current || !page || !active.current) return
        const target = action === 'retry' ? deliveryRetryTarget(page, deliveryId) : selected
        if (!target) return
        const current = epoch.current, selectedAtConfirmation = selection.current
        const copy = action === 'test' ? 'This records a dry-run delivery test without sending to an external destination.'
            : action === 'retry' ? 'This retries the selected attempt and may send its message to a configured destination.'
                : 'This sends the selected finding to its configured destinations.'
        Alert.alert(action === 'test' ? 'Test delivery?' : action === 'retry' ? 'Retry delivery?' : 'Send finding?', copy, [
            { text: 'Cancel', style: 'cancel' },
            { text: action === 'test' ? 'Run dry-run test' : action === 'retry' ? 'Retry delivery' : 'Send finding', onPress: () => {
                if (current === epoch.current && selection.current === selectedAtConfirmation && active.current) void perform(action, deliveryId)
            } },
        ])
    }
    function choose(id: string) {
        if (saving.current) return
        epoch.current++; setSelectedId(id); setHistoryPage(0); setPickerOpen(false); setNotice('')
    }
    const caseRef = page ? deliveryCaseRef(page, selectedId) : undefined
    return <Screen title='Delivery history' subtitle='Organization customer delivery'
        right={<PillButton small label='Refresh' disabled={loading || busy || personal} onPress={refresh} />}>
        <InlineNotice message={error} />
        <InlineNotice message={notice} />
        {personal ? <GlassCard style={{ gap: 10 }}>
            <SectionTitle eyebrow='Workspace' title='Choose an organization' body='Select an organization workspace to review customer delivery and its destinations.' />
        </GlassCard> : <>
            <PillButton label='Configure destinations' disabled={busy} onPress={() => { if (active.current && !saving.current) onConfigure() }} />
            {loading && <Text accessibilityRole='progressbar' style={meta}>Loading delivery history…</Text>}
            {!!page?.notice && <Text style={meta}>{page.notice}</Text>}
            {mustRefresh && <InlineNotice message='Refresh and review the latest history before another action. A previous request may already have been recorded.' />}
            {!!page && <>
                <PillButton label={pickerOpen ? 'Close finding picker' : 'Choose finding'} disabled={busy} onPress={() => setPickerOpen(value => !value)} />
                {(pickerOpen || !selected) && <>
                    <Input label='Search findings' value={query} onChangeText={value => { setQuery(value); setPickerPage(0) }} />
                    <View style={row}>
                        <PillButton small label='All findings' tone={!reviewOnly ? 'accent' : 'default'} onPress={() => { setReviewOnly(false); setPickerPage(0) }} />
                        <PillButton small label='Needs review' tone={reviewOnly ? 'accent' : 'default'} onPress={() => { setReviewOnly(true); setPickerPage(0) }} />
                    </View>
                    <Text style={meta}>{filtered.length} loaded findings · {page.attempts.length} retained attempts (latest 100 maximum)</Text>
                    {!filtered.length && <Text style={meta}>No findings match this view.</Text>}
                    <View style={{ gap: 8 }}>{filtered.slice(currentPickerPage * 20, (currentPickerPage + 1) * 20).map(alert => <PillButton key={alert.id}
                        label={`${alert.title}${alert.actor ? ` · ${alert.actor}` : ''}`} tone={selectedId === alert.id ? 'accent' : 'default'} disabled={busy || loading} onPress={() => choose(alert.id)} />)}</View>
                    <Pages page={currentPickerPage} total={filtered.length} size={20} disabled={busy} onChange={setPickerPage} />
                </>}
                <Text style={meta}>{page.attempts.length} retained attempts (latest 100 maximum)</Text>
                {selected && <GlassCard style={{ gap: 10 }}>
                    <SectionTitle eyebrow='Selected finding' title={selected.title} body={`${selected.actor || 'Actor not recorded'} · ${selected.reviewState || 'Review state not recorded'}`} />
                    <Text style={meta}>Last attempt: {attempts[0]?.status || 'No delivery yet'}</Text>
                    <Text style={meta}>Last success: {lastSuccess ? time(lastSuccess.attemptedAt) : 'Not recorded'}</Text>
                    <Text style={meta}>Needs review: {lastFailure ? time(lastFailure.attemptedAt) : 'No failed attempt'}</Text>
                    <View style={row}>
                        <PillButton label='Test delivery' disabled={disabled || !page.canTest} onPress={() => confirm('test')} />
                        <PillButton label='Send finding' disabled={disabled || !page.canSend} onPress={() => confirm('send')} />
                        {caseRef && <PillButton label='Open case on website' disabled={busy} onPress={() => { if (active.current && !saving.current) onOpenCase(caseRef) }} />}
                    </View>
                </GlassCard>}
                {!attempts.length && <Text style={meta}>{selected ? 'No delivery attempt yet for this finding.' : 'No delivery attempts available.'}</Text>}
                {attempts.slice(currentHistoryPage * 10, (currentHistoryPage + 1) * 10).map(attempt => <DeliveryAttempt key={attempt.id} attempt={attempt} disabled={disabled || !page.canRetry} onRetry={() => confirm('retry', attempt.id)} />)}
                <Pages page={currentHistoryPage} total={attempts.length} size={10} disabled={busy} onChange={setHistoryPage} />
            </>}
        </>}
    </Screen>
}
function Input({ label, value, onChangeText }: { label: string; value: string; onChangeText: (value: string) => void }) {
    const theme = useAppTheme()
    return <View style={{ gap: 8 }}>
        <Text style={{ color: theme.textMuted }}>{label}</Text>
        <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} autoCorrect={false} autoCapitalize='none'
            maxLength={120} style={{ color: theme.text, borderColor: theme.surfaceBorder, borderWidth: 1, borderRadius: 12, padding: 12 }} />
    </View>
}
function Pages({ page, total, size, disabled, onChange }: { page: number; total: number; size: number; disabled: boolean; onChange: (page: number) => void }) {
    if (total <= size) return null
    return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <PillButton small label='Previous' disabled={disabled || page === 0} onPress={() => onChange(page - 1)} />
        <PillButton small label='Next' disabled={disabled || (page + 1) * size >= total} onPress={() => onChange(page + 1)} />
        <Text>{page * size + 1}–{Math.min((page + 1) * size, total)} of {total}</Text>
    </View>
}
function time(value: string) { return Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Time not recorded' }
function message(cause: unknown) { return cause instanceof DeliveryHistoryError ? cause.message : 'Delivery could not be loaded. Refresh to try again.' }
