import { useEffect, useRef, useState } from 'react'
import { AppState, ScrollView, View } from 'react-native'
import { useIsFocused } from '@react-navigation/native'
import * as Crypto from 'expo-crypto'
import type { AppSettings } from '../types'
import { GlassCard, InlineNotice, PillButton, Screen, SectionTitle } from '../components/ui'
import { AiMetricsClients, AiMetricsText } from '../components/AiMetricsClients'
import { AiMetricsQueue } from '../components/AiMetricsQueue'
import { AiMetricsPrompt } from '../components/AiMetricsPrompt'
import { aiMetricsScope, aiPercent, aiSummary, aiValue, AiMetricsError, loadAiContainers, loadAiEconomics, loadAiMetricTargets, type AiContainers, type AiMetricsClient, type AiMetricsEconomics } from '../lib/ai-metrics'
import { aiMetricsLive, AiMetricsPromptError, type AiMetricsLive, type AiTestMessage } from '../lib/ai-metrics-live'

export function AiMetricsScreen({ settings, live = aiMetricsLive, onViewLogs }: {
    settings: AppSettings; live?: AiMetricsLive; onViewLogs?: (containerName: string) => void
}) {
    return <MetricsWorkspace key={aiMetricsScope(settings)} settings={settings} live={live} onViewLogs={onViewLogs} />
}
function MetricsWorkspace({ settings, live, onViewLogs }: { settings: AppSettings; live: AiMetricsLive; onViewLogs?: (containerName: string) => void }) {
    const focused = useIsFocused(), scroll = useRef<ScrollView>(null)
    const [revision, setRevision] = useState(0), [foreground, setForeground] = useState(AppState.currentState === 'active')
    const [clients, setClients] = useState<AiMetricsClient[]>([]), [economics, setEconomics] = useState<AiMetricsEconomics | null>(null), [containers, setContainers] = useState<AiContainers | null>(null)
    const [errors, setErrors] = useState<string[]>([]), [connection, setConnection] = useState('disconnected'), [participants, setParticipants] = useState<number | null>(null)
    const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [needsReview, setNeedsReview] = useState(false)
    const [selected, setSelected] = useState(''), [messages, setMessages] = useState<AiTestMessage[]>([]), [partial, setPartial] = useState(''), [testStatus, setTestStatus] = useState('Ready for a reviewed test.')
    const [displayEpoch, setDisplayEpoch] = useState(0), [lastRead, setLastRead] = useState('')
    const epoch = useRef(0), active = useRef(false), authBlocked = useRef(false), uncertain = useRef(false), pending = useRef(false), reading = useRef(false), snapshot = useRef(false)
    const readController = useRef<AbortController | null>(null), sessionController = useRef<AbortController | null>(null), testController = useRef<AbortController | null>(null)
    const target = useRef(''), history = useRef<AiTestMessage[]>([]), conversation = useRef(''), latestClients = useRef<AiMetricsClient[]>([]), manual = useRef(false)
    function clearTest() {
        target.current = ''; history.current = []; conversation.current = ''
        setSelected(''); setMessages([]); setPartial(''); setTestStatus('Ready for a reviewed test.')
    }
    function invalidate() {
        active.current = false; epoch.current++; setDisplayEpoch(epoch.current)
        if (pending.current) { uncertain.current = true; setNeedsReview(true) }
        readController.current?.abort(); sessionController.current?.abort(); testController.current?.abort()
        snapshot.current = false; reading.current = false; pending.current = false
        setBusy(false); setLoading(false); setClients([]); latestClients.current = []
        setEconomics(null); setContainers(null); setParticipants(null); setConnection('disconnected'); clearTest()
    }
    useEffect(() => {
        const subscription = AppState.addEventListener('change', state => {
            if (state !== 'active') invalidate()
            setForeground(state === 'active')
        })
        return () => { subscription.remove(); active.current = false; epoch.current++; readController.current?.abort(); sessionController.current?.abort(); testController.current?.abort() }
    }, [])
    useEffect(() => {
        if (!focused || !foreground) { invalidate(); return }
        if (authBlocked.current && !manual.current) return
        const explicit = manual.current; manual.current = false
        const current = ++epoch.current, controller = new AbortController()
        active.current = true; sessionController.current = controller; setDisplayEpoch(current)
        function valid() { return active.current && current === epoch.current && !controller.signal.aborted }
        function authFailure(cause: unknown) {
            if (!(cause instanceof AiMetricsError) || ![401, 403].includes(cause.status) || !valid()) return false
            authBlocked.current = true; uncertain.current = true; setNeedsReview(true)
            controller.abort(); readController.current?.abort(); testController.current?.abort()
            snapshot.current = false; setConnection('disconnected'); setClients([]); latestClients.current = []; setEconomics(null); setContainers(null); clearTest()
            setErrors(['AI access could not be verified. Refresh manually before continuing.'])
            return true
        }
        async function refresh() {
            if (!valid() || reading.current) return
            reading.current = true; setLoading(true)
            const read = new AbortController(); readController.current = read
            const abort = () => read.abort(); controller.signal.addEventListener('abort', abort, { once: true })
            try {
                const results = await Promise.allSettled([loadAiEconomics(settings, read.signal), loadAiContainers(settings, read.signal), loadAiMetricTargets(settings, read.signal)])
                if (!valid() || read.signal.aborted) return
                if (results.some(result => result.status === 'rejected' && authFailure(result.reason))) return
                const [economicResult, containerResult, targetResult] = results
                setErrors(results.flatMap(result => result.status === 'rejected' ? [safeError(result.reason)] : []))
                setEconomics(economicResult.status === 'fulfilled' ? economicResult.value : null)
                setContainers(containerResult.status === 'fulfilled' ? containerResult.value : null)
                if (targetResult.status === 'fulfilled' && !snapshot.current) { setClients(targetResult.value); latestClients.current = targetResult.value }
                if (explicit && results.every(result => result.status === 'fulfilled')) { authBlocked.current = false; uncertain.current = false; setNeedsReview(false) }
                setLastRead(new Date().toLocaleTimeString())
            } finally {
                controller.signal.removeEventListener('abort', abort)
                if (current === epoch.current) { reading.current = false; setLoading(false) }
            }
        }
        void refresh()
        void live.observe(settings, controller.signal, {
            snapshot: (values, viewers) => {
                if (!valid()) return
                snapshot.current = true; latestClients.current = values; setClients(values); setParticipants(viewers)
            },
            update: value => {
                if (!valid()) return
                const values = latestClients.current.some(client => client.name === value.name)
                    ? latestClients.current.map(client => client.name === value.name ? value : client)
                    : [...latestClients.current, value].slice(-512)
                latestClients.current = values; setClients(values)
            },
            participants: count => { if (valid()) setParticipants(count) },
            state: value => { if (valid()) { setConnection(value); if (value === 'disconnected') snapshot.current = false } },
            error: cause => { if (valid() && !authFailure(cause)) setErrors(values => [...values.filter(value => !value.startsWith('Live AI')), safeError(cause)]) },
        }).then(stop => { if (!valid()) stop() }).catch(cause => { if (valid() && !authFailure(cause)) { setConnection('disconnected'); setErrors(values => [...values, safeError(cause)]) } })
        const timer = setInterval(() => { if (!authBlocked.current) void refresh() }, 30000)
        return () => { clearInterval(timer); active.current = false; epoch.current++; readController.current?.abort(); controller.abort(); testController.current?.abort() }
    }, [focused, foreground, revision, live])
    function manualRefresh() {
        if (pending.current) return
        invalidate(); manual.current = true; setErrors([]); setRevision(value => value + 1)
    }
    function choose(name: string) {
        if (pending.current || !active.current || authBlocked.current) return
        if (target.current === name) { scroll.current?.scrollTo({ y: 0, animated: false }); return }
        testController.current?.abort(); clearTest(); target.current = name
        conversation.current = Crypto.randomUUID(); setSelected(name)
        setDisplayEpoch(++epoch.current)
        // Target changes invalidate confirmations, but do not invalidate the telemetry session.
        setRevision(value => value + 1)
        scroll.current?.scrollTo({ y: 0, animated: false })
    }
    async function send(prompt: string, reviewed: number, onAccepted: () => void) {
        if (!active.current || reviewed !== epoch.current || pending.current || uncertain.current || authBlocked.current || !snapshot.current || !target.current || settings.impersonationToken || settings.impersonatingUserId || !latestClients.current.some(client => client.name === target.current)) return
        const current = epoch.current, name = target.current, input = [...history.current, { role: 'user' as const, content: prompt.trim() }]
        const cancel = new AbortController(); testController.current = cancel
        pending.current = true; setBusy(true); setPartial(''); setErrors([]); setTestStatus('Connecting and waiting for the selected client…')
        try {
            const content = await live.test(settings, { clientName: name, conversationId: conversation.current, messages: input }, cancel.signal,
                value => { if (active.current && current === epoch.current && !cancel.signal.aborted) setPartial(value) },
                () => {
                    if (active.current && current === epoch.current && !cancel.signal.aborted) {
                        onAccepted()
                        setTestStatus('Selected client is generating…')
                    }
                })
            if (!active.current || current !== epoch.current || cancel.signal.aborted) return
            onAccepted()
            history.current = [...input, { role: 'assistant', content }]; setMessages(history.current); setPartial(''); setTestStatus('Completed.')
        } catch (cause) {
            if (!active.current || current !== epoch.current) return
            uncertain.current = !(cause instanceof AiMetricsPromptError) || cause.submitted
            if (cause instanceof AiMetricsError && [401, 403].includes(cause.status)) authBlocked.current = true
            setNeedsReview(uncertain.current || authBlocked.current); setTestStatus(safeError(cause)); setPartial('')
        } finally { if (current === epoch.current) { pending.current = false; setBusy(false) } }
    }
    function stopTest() {
        if (pending.current) { uncertain.current = true; setNeedsReview(true) }
        testController.current?.abort(); setPartial('')
    }
    function closeTest() { stopTest(); pending.current = false; setBusy(false); clearTest(); setDisplayEpoch(++epoch.current); setRevision(value => value + 1) }
    const summary = aiSummary(clients), testDisabled = !active.current || loading || busy || needsReview || authBlocked.current || connection !== 'connected' || !snapshot.current || Boolean(settings.impersonationToken || settings.impersonatingUserId)
    return <Screen title='AI Metrics' subtitle='Model clients and AI operations' scrollViewRef={scroll}
        right={<PillButton small label='Refresh' disabled={busy || loading} onPress={manualRefresh} />}>
        {errors.map((error, index) => <InlineNotice key={`${error}:${index}`} message={error} />)}
        {needsReview && <InlineNotice message='Refresh and review before another test. A submitted prompt may still be running. No test is retried automatically.' />}
        {selected && <AiMetricsPrompt key={selected} clientName={selected} epoch={displayEpoch} disabled={testDisabled} busy={busy} status={testStatus} messages={messages} partial={partial} onSend={send} onStop={stopTest} onClose={closeTest} />}
        <GlassCard style={{ gap: 12 }}>
            <SectionTitle title='Live model telemetry' eyebrow={connection} body={loading ? 'Refreshing telemetry…' : `Last HTTP refresh: ${lastRead || 'Unavailable'}`} />
            <AiMetricsText>Viewers: {participants ?? 'Unavailable'} · {clients.length} reported clients</AiMetricsText>
            <AiMetricsText>RAM {aiPercent(summary.ram)} · CPU {aiPercent(summary.cpu)} · GPU {aiPercent(summary.gpu)}</AiMetricsText>
            <AiMetricsText>Average throughput {aiValue(summary.tps, ' TPS')}{'\n'}Lanes: {aiValue(summary.active, '', 0)} active · {aiValue(summary.available, '', 0)} available / {aiValue(summary.maximum, '', 0)}</AiMetricsText>
            <AiMetricsText>GPU power {aiValue(summary.watts, ' W')} · Reported monthly GPU energy {aiValue(summary.monthlyKwh, ' kWh', 2)}</AiMetricsText>
            {connection !== 'connected' && <AiMetricsText>Telemetry is disconnected. Refresh to reconnect; model health is not inferred from cached values.</AiMetricsText>}
        </GlassCard>
        {economics ? <AiMetricsQueue economics={economics} /> : <InlineNotice message='Response timing and work queue are unavailable.' />}
        <AiMetricsClients clients={clients} selected={selected} disabled={busy || needsReview || authBlocked.current || Boolean(settings.impersonationToken || settings.impersonatingUserId)} onTest={choose} />
        <GlassCard style={{ gap: 12 }}>
            <SectionTitle title='AI container health' eyebrow={containers?.generatedAt || 'Sample time unavailable'} />
            {!!containers?.unavailable && <InlineNotice message={containers.unavailable} />}
            {containers?.items.map(container => <View key={container.id || container.name} style={{ gap: 8 }}>
                <AiMetricsText>{container.name} · {container.health}{'\n'}{container.image} · {container.status}</AiMetricsText>
                {onViewLogs && <PillButton small label='View logs on website' onPress={() => onViewLogs(container.name)} />}
            </View>)}
            {!containers?.items.length && <AiMetricsText>No AI container telemetry is available.</AiMetricsText>}
        </GlassCard>
    </Screen>
}
function safeError(cause: unknown) { return cause instanceof AiMetricsError ? cause.message : 'AI operations are unavailable. Refresh to try again.' }
