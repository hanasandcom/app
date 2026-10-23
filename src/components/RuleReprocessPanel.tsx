import { useEffect, useRef, useState } from 'react'
import { Alert, View } from 'react-native'
import type { AppSettings } from '../types'
import type { OrganizationRule, RuleDraft } from '../lib/organization-rules'
import { canConfirmReprocessing, canEditTuningInput, cancelRuleReprocessing, loadRuleReprocessing, lockReprocessReview, previewTuningRule, startRuleReprocessing, tuningWindow, TuningError, type ReprocessState, type TuningAccess, type TuningPreview, type TuningRange, type TuningWindow } from '../lib/rule-tuning'
import { GlassCard, InlineNotice, PillButton, SectionTitle } from './ui'
import { TuningChoices, TuningPreviewResults, TuningText, tuningRanges } from './RuleTuningEditor'

export function RuleReprocessPanel({ settings, access, rule, signal, disabled, onBusy, onDenied, onUncertain, onComplete }: {
    settings: AppSettings; access: TuningAccess; rule: OrganizationRule; signal: AbortSignal; disabled: boolean
    onBusy: (busy: boolean) => void; onDenied: () => void; onUncertain: () => void; onComplete: () => void
}) {
    const [state, setState] = useState<ReprocessState | null>(null), [error, setError] = useState('')
    const [range, setRange] = useState<TuningRange>('all'), [preview, setPreview] = useState<TuningPreview | null>(null), [window, setWindow] = useState<TuningWindow | null>(null)
    const [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0), [acknowledged, setAcknowledged] = useState(false), [locked, setLocked] = useState(false)
    const mounted = useRef(true), pending = useRef(false), epoch = useRef(0), inputGeneration = useRef(0), completed = useRef('')
    const jobId = state?.jobs.find(row => ['queued', 'running'].includes(row.status))?.id || null
    const latest = useRef({ disabled, range, locked, acknowledged, previewKey: preview?.key || null, jobId })
    latest.current = { disabled, range, locked, acknowledged, previewKey: preview?.key || null, jobId }
    const draft: RuleDraft = { name: rule.name, explanation: rule.explanation, severity: rule.severity, enabled: rule.enabled, definition: rule.definition }
    useEffect(() => {
        mounted.current = true
        const controller = new AbortController(), abort = () => controller.abort()
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
        let timer: ReturnType<typeof setTimeout> | undefined
        async function read() {
            if (pending.current) { timer = setTimeout(() => void read(), 10000); return }
            try {
                const value = await loadRuleReprocessing(settings, access, rule, controller.signal)
                if (controller.signal.aborted || !mounted.current) return
                epoch.current++; inputGeneration.current++; setState(value); setError(''); setLocked(false)
                latest.current = { ...latest.current, locked: false, jobId: value.jobs.find(row => ['queued', 'running'].includes(row.status))?.id || null }
                const finished = value.jobs.find(job => job.status === 'completed')
                if (finished && completed.current !== finished.id) { completed.current = finished.id; onComplete() }
                if (value.jobs.some(job => ['queued', 'running'].includes(job.status))) timer = setTimeout(() => void read(), 10000)
            } catch (cause) {
                if (!controller.signal.aborted && mounted.current) {
                    const invalidated = lockReprocessReview(reviewState())
                    epoch.current = invalidated.epoch; inputGeneration.current++
                    latest.current = { ...latest.current, locked: invalidated.locked, acknowledged: invalidated.acknowledged, previewKey: invalidated.previewKey }
                    setError(message(cause)); setLocked(true); setPreview(null); setAcknowledged(false)
                    if (cause instanceof TuningError && [401, 403].includes(cause.status)) onDenied()
                }
            }
        }
        void read()
        return () => { mounted.current = false; epoch.current++; controller.abort(); signal.removeEventListener('abort', abort); clearTimeout(timer) }
    }, [rule.id, rule.version, signal, refresh])
    const job = state?.jobs.find(row => ['queued', 'running'].includes(row.status)), unavailable = disabled || busy || locked || signal.aborted
    const renderedGeneration = inputGeneration.current
    function canEdit() {
        return canEditTuningInput({ generation: inputGeneration.current, active: mounted.current && !signal.aborted,
            pending: pending.current, disabled: latest.current.disabled || latest.current.locked || unavailable }, renderedGeneration)
    }
    function reviewState() {
        return { ...latest.current, epoch: epoch.current, active: mounted.current && !signal.aborted,
            pending: pending.current, version: rule.version || '' }
    }
    function changeRange(value: TuningRange) {
        if (!canEdit() || latest.current.jobId) return
        epoch.current++
        latest.current = { ...latest.current, range: value, acknowledged: false, previewKey: null }
        setRange(value); setPreview(null); setWindow(null); setAcknowledged(false)
    }
    function acknowledge() {
        if (!canEdit() || !latest.current.previewKey) return
        epoch.current++
        latest.current = { ...latest.current, acknowledged: !latest.current.acknowledged }
        setAcknowledged(latest.current.acknowledged)
    }
    async function check(more = false) {
        if (!canEdit()) return
        const current = ++epoch.current, fixed = more && window ? window : tuningWindow(range)
        inputGeneration.current++; pending.current = true; setBusy(true); onBusy(true); setError(''); setAcknowledged(false)
        try {
            const value = await previewTuningRule(settings, access, draft, fixed, more ? preview?.cursor || null : null, signal, rule.version)
            if (!mounted.current || signal.aborted || current !== epoch.current) return
            setWindow(fixed)
            setPreview(more && preview ? { ...value, count: preview.count + value.count, scanned: preview.scanned + value.scanned, bytes: preview.bytes + value.bytes,
                events: [...preview.events, ...value.events.filter(row => !preview.events.some(old => old.id === row.id))].slice(-2000) } : value)
        } catch (cause) {
            if (mounted.current && !signal.aborted && current === epoch.current) {
                setError(message(cause)); setPreview(null); setWindow(null); setAcknowledged(false)
                latest.current = { ...latest.current, acknowledged: false, previewKey: null }
                if (cause instanceof TuningError && [401, 403].includes(cause.status)) onDenied()
            }
        }
        finally { pending.current = false; onBusy(false); if (mounted.current) setBusy(false) }
    }
    function review(cancel = false) {
        if (!canEdit() || !state || cancel && !job || !cancel && (job || !acknowledged || !preview || !window)) return
        const current = epoch.current, reviewed = reviewState(), activeJob = job
        Alert.alert(cancel ? 'Stop reprocessing?' : 'Permanently remove matching logs?', cancel
            ? 'The active run will be stopped. Records already removed cannot be restored by stopping.'
            : `Hanasand · ${rule.name} · saved version ${rule.version}\nRange: ${range === 'all' ? 'All stored logs' : `Last ${range} hours`}\n\nMatching Low records and stored originals will be permanently deleted. Store rules and security findings are preserved.`, [
            { text: 'Keep current state', style: 'cancel' }, { text: cancel ? 'Stop run' : 'Apply saved rule', style: 'destructive', onPress: () => {
                if (!canConfirmReprocessing(reviewState(), reviewed, cancel)) return
                inputGeneration.current++; pending.current = true; setBusy(true); onBusy(true); setError('')
                const action = cancel && activeJob ? cancelRuleReprocessing(settings, access, rule, activeJob, signal)
                    : startRuleReprocessing(settings, access, rule, window!, preview!, signal)
                void action.then(result => {
                    if (!mounted.current || signal.aborted) return
                    if (current !== epoch.current) { setLocked(true); onUncertain(); return }
                    setState(value => ({ jobs: [result, ...(value?.jobs || []).filter(old => old.id !== result.id)], existing: value?.existing || null }))
                    setPreview(null); setWindow(null); setAcknowledged(false); setRefresh(value => value + 1)
                }).catch(cause => {
                    if (!mounted.current || signal.aborted) return
                    setError(message(cause)); setPreview(null); setAcknowledged(false)
                    if (cause instanceof TuningError && [401, 403].includes(cause.status)) onDenied()
                    if (!(cause instanceof TuningError) || cause.uncertain) { setLocked(true); onUncertain() }
                }).finally(() => { pending.current = false; onBusy(false); if (mounted.current) setBusy(false) })
            } },
        ])
    }
    return <GlassCard style={{ gap: 12 }}>
        <SectionTitle title='Existing logs' eyebrow={`Saved version ${rule.version}`} body='Reprocessing is a separate destructive operation on stored logs.' />
        <TuningText>{rule.name}</TuningText>
        <InlineNotice message={error} />
        <PillButton label='Refresh job status' disabled={busy} onPress={() => {
            if (!mounted.current || signal.aborted || pending.current || inputGeneration.current !== renderedGeneration) return
            epoch.current++; inputGeneration.current++; setRefresh(value => value + 1)
        }} />
        <TuningText>{state?.existing ? `${state.existing.count.toLocaleString()} matching logs in the preview · ${state.existing.bytes.toLocaleString()} row bytes` : 'Existing match estimate unavailable.'}</TuningText>
        <TuningChoices label='Range · hours or all stored logs' options={tuningRanges} value={range} disabled={unavailable || !!job} onChange={changeRange} />
        <PillButton label='Check saved-rule matches' disabled={unavailable || !!job || !state} onPress={() => void check()} />
        {preview && <>
            <TuningPreviewResults preview={preview} conditions={rule.definition.conditions || []} />
            <PillButton label='Check more saved-rule matches' disabled={unavailable || !preview.cursor} onPress={() => void check(true)} />
            <PillButton label={acknowledged ? 'Deletion acknowledged' : 'Acknowledge permanent deletion of matching Low logs and originals'} disabled={unavailable}
                onPress={acknowledge} />
        </>}
        <PillButton label='Review apply to existing logs' tone='danger' disabled={unavailable || !acknowledged || !preview || !state || !!job} onPress={() => review()} />
        {job && <PillButton label='Review stop reprocessing' tone='danger' disabled={unavailable} onPress={() => review(true)} />}
        {!state?.jobs.length && <TuningText>No recorded runs.</TuningText>}
        {state?.jobs.map(item => <View key={item.id} style={{ gap: 4 }}>
            <TuningText>{item.status} · version {item.rule_version} · {new Date(item.created_at).toLocaleString()}</TuningText>
            <TuningText>{item.scanned} checked · {item.matched} matched · {item.removed_events} events removed · {item.removed_sources} originals removed · {item.protected} protected matches kept</TuningText>
            {!!item.error && <TuningText>Run reported an error. Refresh and review its status.</TuningText>}
            <TuningText>Updated {new Date(item.updated_at).toLocaleString()}</TuningText>
        </View>)}
    </GlassCard>
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : 'Reprocessing is unavailable. Refresh and review its status.' }
