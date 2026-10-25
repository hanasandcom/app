import { useEffect, useRef, useState } from 'react'
import { Alert, AppState, Share, View, type ScrollView } from 'react-native'
import { useIsFocused } from '@react-navigation/native'
import type { AppSettings } from '../types'
import { GlassCard, InlineNotice, PillButton, Screen, SectionTitle } from '../components/ui'
import { LoadTestHistory, LoadTestLaunch, LoadTestReport } from '../components/LoadTestWorkspace'
import { joinLoadTestLive, applyLoadLive, type LoadSocketTransport } from '../lib/load-test-live'
import { canEditLoad, canReadLoadInput, canReconcileLoad, createLoadTest, loadEndpoint, loadOwnAccount, loadPresets, loadScope, loadTestHistory, loadTestQuota, loadTestResult, queuedLoadRerun, rerunLoadTest, validateLoadDraft, LoadTestError, type LoadDraft, type LoadQuota, type LoadReadTicket, type LoadTest } from '../lib/load-tests'

export function LoadTestsScreen({ settings, liveTransport }: { settings: AppSettings; liveTransport?: LoadSocketTransport }) {
    return <LoadTestsWorkspace key={loadScope(settings)} settings={settings} liveTransport={liveTransport} />
}
function LoadTestsWorkspace({ settings, liveTransport }: { settings: AppSettings; liveTransport?: LoadSocketTransport }) {
    const scroll = useRef<ScrollView>(null)
    const focused = useIsFocused(), [foreground, setForeground] = useState(AppState.currentState === 'active')
    const [draft, setDraft] = useState<LoadDraft>({ url: '', timeout: 30, stages: loadPresets[0].stages.map(stage => ({ ...stage })) })
    const [mine, setMine] = useState<LoadTest[] | null>(null), [recent, setRecent] = useState<LoadTest[] | null>(null)
    const [quota, setQuota] = useState<LoadQuota | null>(null), [lane, setLane] = useState<'mine' | 'recent'>('mine')
    const [report, setReport] = useState<LoadTest | null>(null), [query, setQuery] = useState('')
    const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [locked, setLocked] = useState(false), [verified, setVerified] = useState(false)
    const [error, setError] = useState(''), [notice, setNotice] = useState(''), [hostRevision, setHostRevision] = useState(0)
    const [liveStatus, setLiveStatus] = useState('Not listening'), [participants, setParticipants] = useState<number | null>(null)
    const alive = useRef(true), active = useRef(false), pending = useRef(false), lock = useRef(false)
    const epoch = useRef(0), generation = useRef(0), review = useRef(0), operation = useRef(0), serial = useRef(0)
    const reading = useRef<AbortController | null>(null), writing = useRef<AbortController | null>(null), stream = useRef<AbortController | null>(null)
    const selected = useRef(''), latestDraft = useRef(draft)
    latestDraft.current = draft; active.current = focused && foreground
    const inputGeneration = generation.current
    const disabled = loading || busy || locked || !verified || !active.current || !loadOwnAccount(settings)
    function renew() { generation.current++; setHostRevision(value => value + 1) }
    function stopStream() { stream.current?.abort(); stream.current = null; setLiveStatus('Not listening'); setParticipants(null) }
    function hide() {
        active.current = false; epoch.current++; review.current++; operation.current++; serial.current++
        reading.current?.abort(); reading.current = null; stopStream()
        if (writing.current) { lock.current = true; setLocked(true); setError('A load request was interrupted. Its outcome is unknown. Refresh and review history before another request.') }
        writing.current?.abort(); writing.current = null; pending.current = false
        setBusy(false); setLoading(false); setVerified(false); setMine(null); setRecent(null); setQuota(null); setReport(null); selected.current = ''; setQuery('')
        // Endpoint URLs can contain query secrets. Keep only the nonsecret traffic shape when hidden.
        setDraft(value => ({ ...value, url: '' })); renew()
    }
    useEffect(() => {
        alive.current = true
        const subscription = AppState.addEventListener('change', state => { if (state !== 'active') hide(); setForeground(state === 'active') })
        return () => { alive.current = false; active.current = false; epoch.current++; reading.current?.abort(); writing.current?.abort(); stream.current?.abort(); subscription.remove() }
    }, [])
    useEffect(() => {
        if (!focused || !foreground) { hide(); return }
        void refresh(false)
        return () => { active.current = false; epoch.current++; reading.current?.abort(); stream.current?.abort() }
    }, [focused, foreground])
    function readableInput() { return canReadLoadInput({ active: alive.current && active.current, pending: pending.current, reading: !!reading.current, generation: generation.current }, inputGeneration) }
    function editable() { return canEditLoad({ active: alive.current && active.current, pending: pending.current || !!reading.current, locked: lock.current, generation: generation.current }, inputGeneration) }
    async function refresh(manual: boolean) {
        if (!active.current || pending.current || manual && !readableInput()) return
        reading.current?.abort(); stopStream()
        const controller = new AbortController(), own = ++epoch.current
        const ticket: LoadReadTicket | null = manual ? { operation: operation.current, serial: ++serial.current } : null
        if (!manual) serial.current++
        reading.current = controller; review.current++; renew(); setLoading(true); setVerified(false); setError('')
        const id = selected.current
        const current = () => alive.current && active.current && epoch.current === own && reading.current === controller && !controller.signal.aborted
        try {
            const results = await Promise.allSettled([loadTestHistory(settings, 'mine', controller.signal), loadTestHistory(settings, 'recent', controller.signal), loadTestQuota(settings, controller.signal), ...(id ? [loadTestResult(settings, id, controller.signal)] : [])])
            if (!current()) return
            const [mineResult, recentResult, quotaResult, detailResult] = results
            setMine(mineResult.status === 'fulfilled' ? mineResult.value as LoadTest[] : null)
            setRecent(recentResult.status === 'fulfilled' ? recentResult.value as LoadTest[] : null)
            setQuota(quotaResult.status === 'fulfilled' ? quotaResult.value as LoadQuota : null)
            if (detailResult?.status === 'fulfilled') setReport(detailResult.value as LoadTest)
            const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
            setError(failures.map(message).join('\n'))
            const authFailure = failures.some(cause => cause instanceof LoadTestError && [401, 403].includes(cause.status))
            if (authFailure) { lock.current = true; setLocked(true); operation.current++ }
            setVerified(!authFailure && (id ? detailResult?.status === 'fulfilled' : mineResult.status === 'fulfilled'))
            if (!failures.length && canReconcileLoad(ticket, operation.current, serial.current)) {
                serial.current++; lock.current = false; setLocked(false); setNotice('Stored history and result refreshed. Review them before submitting another request.')
            }
        } finally { if (reading.current === controller) { reading.current = null; if (alive.current && epoch.current === own) setLoading(false) } }
    }
    async function open(id: string) {
        if (!readableInput()) return
        reading.current?.abort(); stopStream(); review.current++; renew()
        const controller = new AbortController(), own = ++epoch.current
        reading.current = controller; setLoading(true); setError('')
        try {
            const next = await loadTestResult(settings, id.trim(), controller.signal)
            if (active.current && alive.current && epoch.current === own && !controller.signal.aborted) { selected.current = next.id; setReport(next); setNotice(''); scroll.current?.scrollTo({ y: 0, animated: false }) }
        } catch (cause) {
            if (active.current && epoch.current === own && !controller.signal.aborted) {
                setError(message(cause))
                if (cause instanceof LoadTestError && [401, 403].includes(cause.status)) { operation.current++; serial.current++; lock.current = true; setLocked(true); setVerified(false) }
            }
        }
        finally { if (reading.current === controller) { reading.current = null; if (epoch.current === own) setLoading(false) } }
    }
    function confirmWrite(rerun: boolean) {
        if (disabled || !editable()) return
        let value: LoadDraft
        try { value = rerun ? draft : validateLoadDraft(latestDraft.current) } catch (cause) { setError(message(cause)); return }
        const id = selected.current, target = rerun ? report?.url : value.url, version = ++review.current, captured = generation.current
        if (rerun && (!report || ['queued', 'running'].includes(report.status))) return
        Alert.alert(rerun ? 'Rerun this endpoint check?' : 'Start endpoint load test?',
            `${target}\n${rerun ? 'Uses this saved test’s traffic configuration.' : `${value.stages.map(stage => `${stage.duration}: ${stage.target} users`).join('\n')}\nRequest timeout ${value.timeout} seconds.`}\n\nConfirm you own this service or have permission to generate this traffic. Closing the app does not stop server work.`, [
                { text: 'Cancel', style: 'cancel' }, { text: 'I have permission · Start', onPress: () => {
                    if (!alive.current || !active.current || pending.current || reading.current || lock.current || review.current !== version || generation.current !== captured || selected.current !== id || !loadOwnAccount(settings)) return
                    void write(rerun, value, id)
                } },
            ])
    }
    async function write(rerun: boolean, value: LoadDraft, id: string) {
        const controller = new AbortController(), own = ++epoch.current
        operation.current++; serial.current++; review.current++; renew(); stopStream()
        pending.current = true; writing.current = controller; setBusy(true); setError(''); setNotice('')
        try {
            if (rerun) {
                await rerunLoadTest(settings, id, controller.signal)
                if (!alive.current || !active.current || epoch.current !== own || controller.signal.aborted) return
                setReport(previous => previous?.id === id ? queuedLoadRerun(previous) : previous)
                setNotice('Rerun queued. Refresh to read its stored status, or explicitly join public live output.')
            } else {
                const result = await createLoadTest(settings, value, controller.signal)
                if (!alive.current || !active.current || epoch.current !== own || controller.signal.aborted) return
                selected.current = result.test.id; setReport(result.test); scroll.current?.scrollTo({ y: 0, animated: false }); if (result.quota) setQuota(result.quota)
                setNotice('Check queued. No live stream was joined automatically.')
            }
        } catch (cause) {
            if (!alive.current || !active.current || epoch.current !== own) return
            setError(message(cause))
            if (cause instanceof LoadTestError && cause.quota) setQuota(cause.quota)
            if (!(cause instanceof LoadTestError) || cause.uncertain || [401, 403].includes(cause.status)) {
                operation.current++; serial.current++; lock.current = true; setLocked(true)
            }
        } finally {
            if (writing.current === controller) {
                writing.current = null; pending.current = false
                if (alive.current && epoch.current === own) { renew(); setBusy(false) }
            }
        }
    }
    function reviewLive() {
        if (!report || disabled || !editable()) return
        const id = report.id, version = ++review.current, captured = generation.current
        Alert.alert('Join public live output?', 'This stream is public and does not authenticate your account. Joining also starts the server’s global queued load-test runner. It does not create a new test. No automatic reconnect will occur.', [
            { text: 'Cancel', style: 'cancel' }, { text: 'Join public stream', onPress: () => {
                if (!active.current || !alive.current || lock.current || pending.current || reading.current || review.current !== version || generation.current !== captured || selected.current !== id) return
                stopStream(); const controller = new AbortController(); stream.current = controller
                const current = () => alive.current && active.current && !controller.signal.aborted && stream.current === controller && selected.current === id
                try { joinLoadTestLive(settings, id, controller.signal, {
                    status: value => { if (current()) setLiveStatus(value) },
                    event: event => { if (!current()) return; if (event.kind === 'join') setParticipants(event.participants); else setReport(value => value?.id === id ? applyLoadLive(value, event) : value) },
                    error: value => { if (current()) setError(value) },
                }, liveTransport) } catch (cause) { if (current()) setError(message(cause)) }
            } },
        ])
    }
    return <Screen scrollViewRef={scroll} title='Load testing' subtitle='Account checks · public global results · not organization scoped'
        right={<PillButton key={`refresh:${hostRevision}`} small label='Refresh stored results' disabled={loading || busy} onPress={() => { if (readableInput()) void refresh(true) }} />}>
        <InlineNotice message={error} /><InlineNotice message={notice} />
        {locked && <InlineNotice message='Requests are locked. Refresh manually and review stored results before another submission. No request is retried automatically.' />}
        {(settings.impersonationToken || settings.impersonatingUserId) && <InlineNotice message='Read-only while impersonating. Load generation and live queue joins require your own account.' />}
        {loading && <InlineNotice message='Loading stored checks…' />}
        {focused && foreground && (report ? <LoadTestReport key={report.id} test={report} disabled={disabled} busy={loading || busy} liveStatus={liveStatus} participants={participants}
            onBack={() => { if (!pending.current && !reading.current) { stopStream(); selected.current = ''; setReport(null); review.current++; renew(); scroll.current?.scrollTo({ y: 0, animated: false }) } }}
            onRerun={() => confirmWrite(true)} onJoin={reviewLive} onStop={stopStream}
            onShare={() => { if (!alive.current || !active.current || selected.current !== report.id) return; try { const url = loadEndpoint(settings.siteBaseUrl, `test/${encodeURIComponent(report.id)}`); void Share.share({ message: url }).catch(() => setError('The result link could not be shared.')) } catch (cause) { setError(message(cause)) } }} /> : <>
            <LoadTestLaunch draft={draft} quota={quota} disabled={disabled} hostRevision={hostRevision} onReview={() => confirmWrite(false)}
                onDraft={(value, structural) => { if (!editable() || disabled) return; latestDraft.current = value; setDraft(value); review.current++; if (structural) renew() }} />
            <LoadTestHistory rows={lane === 'mine' ? mine : recent} lane={lane} disabled={loading || busy} hostRevision={hostRevision}
                onLane={setLane} onSelect={id => void open(id)} query={query} onLookup={() => void open(query)}
                onQuery={value => { if (!readableInput()) return; setQuery(value); review.current++ }} />
        </>)}
        {!active.current && <GlassCard><SectionTitle eyebrow='Inactive' title='Checks paused' body='Return to this screen to load stored results. No public stream joins automatically.' /></GlassCard>}
        <View />
    </Screen>
}
function message(cause: unknown) { return cause instanceof LoadTestError ? cause.message : 'Checks are unavailable. Refresh to try again.' }
