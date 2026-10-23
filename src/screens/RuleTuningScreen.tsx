import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, ScrollView, View } from 'react-native'
import { useIsFocused } from '@react-navigation/native'
import type { AppSettings } from '../types'
import type { OrganizationRule, RuleDraft } from '../lib/organization-rules'
import { acknowledgeTuningRead, initialTuningReadState, invalidateTuningReconciliation, prepareTuningRead, requestTuningReconciliation, loadTuningAccess, loadTuningSnapshot, listTuningRules, loadSavedTuningRule, refreshTuningSummary, sortTuningLogs, tuningPreset, tuningScope, TuningError, type TuningAccess, type TuningSnapshot, type TuningSort } from '../lib/rule-tuning'
import { GlassCard, InlineNotice, PillButton, Screen, SectionTitle } from '../components/ui'
import { RuleTuningEditor, TuningChoices, TuningInput, TuningText } from '../components/RuleTuningEditor'
import { RuleReprocessPanel } from '../components/RuleReprocessPanel'

export function RuleTuningScreen({ settings }: { settings: AppSettings }) {
    return <TuningWorkspace key={tuningScope(settings)} settings={settings} />
}
function TuningWorkspace({ settings }: { settings: AppSettings }) {
    const focused = useIsFocused(), scroll = useRef<ScrollView>(null)
    const [foreground, setForeground] = useState(AppState.currentState === 'active'), [revision, setRevision] = useState(0)
    const [access, setAccess] = useState<TuningAccess | null>(null), [snapshot, setSnapshot] = useState<TuningSnapshot | null>(null)
    const [savedRules, setSavedRules] = useState<Array<{ id: string; name: string; enabled: boolean }>>([]), [rule, setRule] = useState<OrganizationRule | null>(null)
    const [initial, setInitial] = useState<RuleDraft | null>(null), [editorKey, setEditorKey] = useState(0)
    const [sort, setSort] = useState<TuningSort>('event_count'), [descending, setDescending] = useState(true), [page, setPage] = useState(0)
    const [ruleQuery, setRuleQuery] = useState(''), [rulePage, setRulePage] = useState(0)
    const [error, setError] = useState(''), [notice, setNotice] = useState(''), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [blocked, setBlocked] = useState(false)
    const [sessionSignal, setSessionSignal] = useState<AbortSignal | null>(null)
    const active = useRef(false), epoch = useRef(0), pending = useRef(false), authBlocked = useRef(false)
    const reconciliation = useRef(initialTuningReadState()), snapshotRef = useRef<TuningSnapshot | null>(null)
    const controller = useRef<AbortController | null>(null), mutation = useRef<AbortController | null>(null)
    useEffect(() => {
        const listener = AppState.addEventListener('change', state => {
            if (state !== 'active') {
                active.current = false; epoch.current++; controller.current?.abort(); mutation.current?.abort()
                reconciliation.current = invalidateTuningReconciliation(reconciliation.current); snapshotRef.current = null
                setInitial(null); setRule(null); setSavedRules([]); setSnapshot(null); setAccess(null)
                if (pending.current) setBlocked(true)
                setLoading(false); setBusy(false)
            }
            setForeground(state === 'active')
        })
        return () => listener.remove()
    }, [])
    useEffect(() => {
        if (!focused || !foreground) {
            active.current = false; epoch.current++; controller.current?.abort(); mutation.current?.abort()
            if (pending.current) setBlocked(true)
            setLoading(false); setBusy(false)
            reconciliation.current = invalidateTuningReconciliation(reconciliation.current); snapshotRef.current = null
            setInitial(null); setRule(null); setSnapshot(null); setSavedRules([]); setAccess(null)
            return
        }
        if (authBlocked.current && !reconciliation.current.pending) return
        const current = ++epoch.current, abort = new AbortController()
        controller.current = abort; active.current = true; setSessionSignal(abort.signal)
        let timer: ReturnType<typeof setTimeout> | undefined
        async function read() {
            if (abort.signal.aborted || !active.current || current !== epoch.current) return
            if (pending.current) { timer = setTimeout(() => void read(), 10000); return }
            const readPlan = prepareTuningRead(reconciliation.current, snapshotRef.current !== null)
            reconciliation.current = readPlan.state
            if (readPlan.loading) setLoading(true)
            try {
                const verified = await loadTuningAccess(settings, abort.signal)
                if (!verified.canRead) throw new TuningError('Active Hanasand membership is required.', 403)
                const [data, rules] = await Promise.all([loadTuningSnapshot(settings, verified, abort.signal), listTuningRules(settings, verified, abort.signal)])
                if (abort.signal.aborted || !active.current || current !== epoch.current) return
                snapshotRef.current = data
                setAccess(verified); setSnapshot(data); setSavedRules(rules); setError('')
                const acknowledgement = acknowledgeTuningRead(reconciliation.current, readPlan.ticket)
                reconciliation.current = acknowledgement.state
                if (acknowledgement.accepted) { setBlocked(false); authBlocked.current = false }
                timer = setTimeout(() => void read(), data.pending || data.refreshing ? 15000 : 10000)
            } catch (cause) {
                if (!abort.signal.aborted && active.current && current === epoch.current) {
                    setError(message(cause)); setBlocked(true)
                    reconciliation.current = invalidateTuningReconciliation(reconciliation.current)
                    if (cause instanceof TuningError && [401, 403].includes(cause.status)) { authBlocked.current = true; setBlocked(true) }
                }
            } finally { if (current === epoch.current && !abort.signal.aborted) setLoading(false) }
        }
        void read()
        return () => { active.current = false; epoch.current++; clearTimeout(timer); abort.abort(); mutation.current?.abort() }
    }, [focused, foreground, revision, settings])
    function refresh() {
        if (pending.current) return
        reconciliation.current = requestTuningReconciliation(reconciliation.current)
        controller.current?.abort(); epoch.current++; setRevision(value => value + 1)
    }
    function denied() { reconciliation.current = invalidateTuningReconciliation(reconciliation.current); authBlocked.current = true; setBlocked(true); setError('Access could not be verified. Refresh manually before continuing.') }
    function uncertain() { reconciliation.current = invalidateTuningReconciliation(reconciliation.current); setBlocked(true); setNotice('An operation may already have been saved. Refresh and review saved rules and job status before any further action.') }
    function childBusy(value: boolean) {
        if (value) reconciliation.current = invalidateTuningReconciliation(reconciliation.current)
        pending.current = value; setBusy(value)
    }
    const complete = useCallback(() => { setNotice('A reprocessing run completed. Review its results, then refresh the summary.') }, [])
    async function refreshSummary() {
        if (!access || blocked || pending.current || !active.current || !sessionSignal) return
        const current = epoch.current, abort = new AbortController(); mutation.current = abort
        const cancel = () => abort.abort(); sessionSignal.addEventListener('abort', cancel, { once: true })
        childBusy(true)
        try {
            await refreshTuningSummary(settings, access, abort.signal)
            if (active.current && !abort.signal.aborted && current === epoch.current) { setNotice('Summary refresh queued. The stored snapshot remains visible while it updates.') }
        } catch (cause) {
            if (active.current && current === epoch.current) { setError(message(cause)); if (cause instanceof TuningError && [401, 403].includes(cause.status)) denied(); if (!(cause instanceof TuningError) || cause.uncertain) uncertain() }
        } finally {
            pending.current = false; sessionSignal.removeEventListener('abort', cancel)
            if (current === epoch.current) { setBusy(false); setRevision(value => value + 1) }
        }
    }
    async function selectSaved(id: string) {
        if (!access || !sessionSignal || pending.current || !active.current) return
        const current = epoch.current
        childBusy(true)
        try {
            const value = await loadSavedTuningRule(settings, access, id, sessionSignal)
            if (active.current && current === epoch.current && !sessionSignal.aborted) { setRule(value); setInitial(null); scroll.current?.scrollTo({ y: 0, animated: false }) }
        } catch (cause) {
            if (active.current && current === epoch.current) { setError(message(cause)); if (cause instanceof TuningError && [401, 403].includes(cause.status)) denied() }
        }
        finally { pending.current = false; if (current === epoch.current) setBusy(false) }
    }
    const disabled = !access?.canWrite || blocked || busy || loading || !active.current
    const filteredRules = savedRules.filter(item => item.name.toLowerCase().includes(ruleQuery.trim().toLowerCase()))
    const currentRulePage = Math.min(rulePage, Math.max(0, Math.ceil(filteredRules.length / 10) - 1))
    const patterns = sortTuningLogs(snapshot?.logs || [], sort, descending), currentPage = Math.min(page, Math.max(0, Math.ceil(patterns.length / 10) - 1))
    return <Screen title='Rule tuning' subtitle='Stored logs · fixed workspace Hanasand' scrollViewRef={scroll}
        right={<PillButton small label='Refresh' disabled={busy || loading} onPress={refresh} />}>
        <InlineNotice message={error} /><InlineNotice message={notice} />
        {blocked && <InlineNotice message='Changes are locked. Refresh manually and review saved rules and job status. No operation is retried automatically.' />}
        {access && !access.canWrite && <InlineNotice message='Read-only view. Changes require verified active Hanasand editing access in your own account.' />}
        {focused && foreground && initial && access && sessionSignal && <RuleTuningEditor key={editorKey} settings={settings} access={access} initial={initial} signal={sessionSignal} disabled={disabled}
            onCreated={value => { setRule(value); setInitial(null); setNotice('Rule saved. Existing logs have not been reprocessed.'); scroll.current?.scrollTo({ y: 0, animated: false }) }}
            onBusy={childBusy} onDenied={denied} onUncertain={uncertain} onClose={() => setInitial(null)} />}
        {focused && foreground && rule && access && sessionSignal && <>
            <GlassCard style={{ gap: 10 }}>
                <SectionTitle title='Saved rule' eyebrow={`Version ${rule.version}`} body={rule.name} />
                <TuningText>{rule.definition.stage} · {rule.definition.action} · {rule.enabled ? 'Enabled' : 'Disabled'}</TuningText>
                <PillButton label='Close saved rule' disabled={busy} onPress={() => { if (active.current && !pending.current) setRule(null) }} />
            </GlassCard>
            {rule.enabled && rule.definition.stage === 'analyze' && rule.definition.action === 'drop' && <RuleReprocessPanel key={`${rule.id}:${rule.version}`} settings={settings} access={access} rule={rule} signal={sessionSignal} disabled={disabled} onBusy={childBusy} onDenied={denied} onUncertain={uncertain} onComplete={complete} />}
        </>}
        <GlassCard style={{ gap: 12 }}>
            <SectionTitle title='Stored log patterns' eyebrow='Sampled summary' body='The 100 largest patterns grouped by message, IP and user agent. Counts and row sizes are estimates from a 1% page sample.' />
            <TuningText>{loading ? 'Loading summary…' : snapshot?.pending ? 'Preparing the summary in the background…' : snapshot?.refreshing ? 'Refreshing in the background…' : 'Stored snapshot'}{snapshot?.generatedAt ? `\nSnapshot: ${new Date(snapshot.generatedAt).toLocaleString()}` : ''}</TuningText>
            <TuningText>{snapshot ? `${snapshot.logs.reduce((total, row) => total + Number(row.storage_bytes), 0).toLocaleString()} estimated row bytes across these patterns. Indexes and free space are excluded.` : 'Pattern estimates are unavailable.'}</TuningText>
            <PillButton label='Refresh summary' disabled={disabled} onPress={() => void refreshSummary()} />
            <TuningChoices label='Sort by' options={['message', 'ip', 'user_agent', 'event_count', 'storage_bytes'] as const} value={sort} disabled={busy} onChange={value => { setSort(value); setPage(0) }} />
            <PillButton label={descending ? 'Descending' : 'Ascending'} disabled={busy} onPress={() => setDescending(value => !value)} />
            {patterns.slice(currentPage * 10, currentPage * 10 + 10).map((row, index) => <View key={JSON.stringify([row.message, row.ip, row.user_agent])} style={{ gap: 8 }}>
                <TuningText>{currentPage * 10 + index + 1}. {row.message}</TuningText>
                <TuningText>IP: {row.ip || 'Not recorded'}{'\n'}User agent: {row.user_agent || 'Not recorded'}{'\n'}Estimated count: {row.event_count} · 24h: {row.last_24h_count}{'\n'}Last seen in sample: {row.last_triggered ? new Date(row.last_triggered).toLocaleString() : 'Not recorded'}{'\n'}Estimated row bytes: {row.storage_bytes}</TuningText>
                <PillButton label='Tune this pattern' disabled={disabled || !tunable(row)} onPress={() => {
                    if (disabled || pending.current || !active.current || controller.current?.signal.aborted) return
                    try { setInitial(tuningPreset(row)); setEditorKey(value => value + 1); setRule(null); scroll.current?.scrollTo({ y: 0, animated: false }) }
                    catch (cause) { setError(message(cause)) }
                }} />
            </View>)}
            {!patterns.length && snapshot && <TuningText>No stored log patterns.</TuningText>}
            <View style={{ flexDirection: 'row', gap: 8 }}>
                <PillButton small label='Previous patterns' disabled={!currentPage} onPress={() => setPage(value => Math.max(0, value - 1))} />
                <TuningText>Page {currentPage + 1} of {Math.max(1, Math.ceil(patterns.length / 10))}</TuningText>
                <PillButton small label='Next patterns' disabled={(currentPage + 1) * 10 >= patterns.length} onPress={() => setPage(currentPage + 1)} />
            </View>
        </GlassCard>
        <GlassCard style={{ gap: 10 }}>
            <SectionTitle title='Saved custom rules' eyebrow='Reconcile saved state' body='Review saved custom rules before recreating a rule whose save outcome was uncertain. Enabled Analyze drop rules can reprocess stored logs.' />
            <TuningInput label='Search saved rules' value={ruleQuery} onChange={value => { setRuleQuery(value); setRulePage(0) }} disabled={busy} />
            {filteredRules.slice(currentRulePage * 10, currentRulePage * 10 + 10).map(item => <PillButton key={item.id} label={`${item.name}${item.enabled ? '' : ' · Disabled'}`} disabled={busy || loading} onPress={() => void selectSaved(item.id)} />)}
            {!filteredRules.length && <TuningText>No matching saved rules loaded.</TuningText>}
            <View style={{ flexDirection: 'row', gap: 8 }}>
                <PillButton small label='Previous saved rules' disabled={!currentRulePage} onPress={() => setRulePage(currentRulePage - 1)} />
                <PillButton small label='Next saved rules' disabled={(currentRulePage + 1) * 10 >= filteredRules.length} onPress={() => setRulePage(currentRulePage + 1)} />
            </View>
        </GlassCard>
    </Screen>
}
function tunable(row: Parameters<typeof tuningPreset>[0]) { try { tuningPreset(row); return true } catch { return false } }
function message(cause: unknown) { return cause instanceof Error ? cause.message : 'Rule tuning is unavailable. Refresh and review before continuing.' }
