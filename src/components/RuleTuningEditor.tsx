import { useEffect, useRef, useState } from 'react'
import { Alert, Text, TextInput, View } from 'react-native'
import type { AppSettings } from '../types'
import type { OrganizationRule, RuleCondition, RuleDraft } from '../lib/organization-rules'
import { validateRuleConditions } from '../lib/organization-rules'
import { canEditTuningInput, createTuningRule, previewTuningRule, tuningSignature, tuningNativeHostKey, tuningWindow, TuningError, type TuningAccess, type TuningPreview, type TuningRange } from '../lib/rule-tuning'
import { GlassCard, InlineNotice, PillButton, SectionTitle } from './ui'
import { useAppTheme } from '../theme/context'

export function useTuningHostBoundary(signal: AbortSignal, scope: string) {
    const [revision, setRevision] = useState(0)
    const context = useRef({ signal, scope, revision: 0 })
    if (context.current.signal !== signal || context.current.scope !== scope) {
        context.current = { signal, scope, revision: context.current.revision + 1 }
    }
    return { hostKey: tuningNativeHostKey(context.current.revision, revision), renewHosts: () => setRevision(value => value + 1) }
}
export function TuningText({ children }: { children: React.ReactNode }) {
    const theme = useAppTheme()
    return <Text selectable style={{ color: theme.textMuted, fontSize: 13, lineHeight: 20 }}>{children}</Text>
}
export function TuningInput({ label, value, onChange, disabled, multiline = false, maxLength, nativeKey = '0' }: {
    label: string; value: string; onChange: (value: string) => void; disabled: boolean; multiline?: boolean; maxLength?: number; nativeKey?: string
}) {
    const theme = useAppTheme()
    return <View style={{ gap: 6 }}>
        <TuningText>{label}</TuningText>
        <TextInput key={`text:${nativeKey}`} accessibilityLabel={label} value={value} onChangeText={onChange} editable={!disabled} multiline={multiline} maxLength={maxLength}
            autoCorrect={false} autoCapitalize='none' autoComplete='off' spellCheck={false}
            style={{ color: theme.text, borderColor: theme.surfaceBorderSoft, borderWidth: 1, borderRadius: 10, padding: 12, minHeight: multiline ? 80 : 44 }} />
    </View>
}
export function TuningChoices<T extends string>({ label, options, value, onChange, disabled, nativeKey = '0' }: {
    label: string; options: readonly T[]; value: T; onChange: (value: T) => void; disabled: boolean; nativeKey?: string
}) {
    return <View style={{ gap: 6 }}>
        <TuningText>{label}</TuningText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{options.map(option => <PillButton key={`${option}:${nativeKey}`} small label={option}
            tone={value === option ? 'accent' : 'default'} disabled={disabled} onPress={() => onChange(option)} />)}</View>
    </View>
}
export function TuningPreviewResults({ preview, conditions }: { preview: TuningPreview; conditions: RuleCondition[] }) {
    const [page, setPage] = useState(0)
    const current = Math.min(page, Math.max(0, Math.ceil(preview.events.length / 20) - 1))
    const paths = [...new Set([...conditions.map(row => row.path), 'source.ip', 'source.country', 'http.path', 'http.method', 'host', 'user.id', 'device.id', 'outcome'])]
    function field(event: TuningPreview['events'][number], path: string) {
        const value = path.split('.').reduce<unknown>((row, key) => row && typeof row === 'object' && Object.hasOwn(row, key) ? (row as Record<string, unknown>)[key] : undefined, event.normalized)
        return value == null ? '' : typeof value === 'object' ? JSON.stringify(value).slice(0, 500) : String(value).slice(0, 500)
    }
    return <View style={{ gap: 10 }}>
        <TuningText>{preview.count.toLocaleString()} matching events · {preview.scanned.toLocaleString()} checked · {preview.bytes.toLocaleString()} matching row bytes{preview.cursor ? '\nMore candidates remain; these are results from the checked sample.' : '\nNo further candidates in this fixed time window.'}</TuningText>
        {preview.events.slice(current * 20, current * 20 + 20).map(event => <View key={event.id} style={{ gap: 3 }}>
            <TuningText>{new Date(event.timestamp).toLocaleString()} · {String(event.normalized.service || event.normalized.event_type || 'Stored log')}</TuningText>
            {typeof event.normalized.message === 'string' && <TuningText>{event.normalized.message}</TuningText>}
            {paths.map(path => field(event, path) ? <TuningText key={path}>{path}: {field(event, path)}</TuningText> : null)}
        </View>)}
        <TuningText>Preview uses a fixed time window. New records may arrive before a reprocessing run starts.</TuningText>
        <TuningText>Matching event page {current + 1} of {Math.max(1, Math.ceil(preview.events.length / 20))} · {preview.events.length} retained preview rows (maximum 2,000).</TuningText>
        <View style={{ flexDirection: 'row', gap: 8 }}>
            <PillButton small label='Previous matching events' disabled={!current} onPress={() => setPage(current - 1)} />
            <PillButton small label='Next matching events' disabled={(current + 1) * 20 >= preview.events.length} onPress={() => setPage(current + 1)} />
        </View>
    </View>
}
export const tuningRanges: readonly TuningRange[] = ['1', '24', '168', 'all']
export function RuleTuningEditor({ settings, access, initial, signal, disabled, onCreated, onBusy, onDenied, onUncertain, onClose }: {
    settings: AppSettings; access: TuningAccess; initial: RuleDraft; signal: AbortSignal; disabled: boolean
    onCreated: (rule: OrganizationRule) => void; onBusy: (busy: boolean) => void; onDenied: () => void; onUncertain: () => void; onClose: () => void
}) {
    const { hostKey, renewHosts } = useTuningHostBoundary(signal, access.scope)
    const [draft, setDraft] = useState(initial), [json, setJson] = useState<string | null>(null)
    const [range, setRange] = useState<TuningRange>('all'), [preview, setPreview] = useState<TuningPreview | null>(null)
    const [window, setWindow] = useState<ReturnType<typeof tuningWindow> | null>(null)
    const [busy, setBusy] = useState(false), [error, setError] = useState('')
    const mounted = useRef(true), pending = useRef(false), epoch = useRef(0), inputGeneration = useRef(0)
    const current = useRef({ draft, disabled, json, range }); current.current = { draft, disabled, json, range }
    useEffect(() => {
        mounted.current = true
        return () => { mounted.current = false; epoch.current++ }
    }, [])
    const unavailable = disabled || busy || signal.aborted
    const renderedGeneration = inputGeneration.current
    function canEdit() {
        return canEditTuningInput({ generation: inputGeneration.current, active: mounted.current && !signal.aborted,
            pending: pending.current, disabled: current.current.disabled || unavailable }, renderedGeneration)
    }
    function editJson(value: string | null) {
        if (!canEdit()) return
        epoch.current++
        if (value === null || current.current.json === null) { inputGeneration.current++; renewHosts() }
        current.current = { ...current.current, json: value }
        setJson(value); setPreview(null); setWindow(null)
    }
    function changeRange(value: TuningRange) {
        if (!canEdit()) return
        epoch.current++; inputGeneration.current++; renewHosts()
        current.current = { ...current.current, range: value }
        setRange(value); setWindow(null); setPreview(null)
    }
    function change(next: RuleDraft) {
        if (!canEdit()) return
        epoch.current++; setDraft(next); current.current = { ...current.current, draft: next }
        setPreview(null); setWindow(null); setError('')
    }
    function changeConditions(conditions: RuleCondition[]) {
        if (!canEdit() || current.current.json !== null) return
        change({ ...draft, definition: { ...draft.definition, conditions } })
        inputGeneration.current++; renewHosts()
    }
    function condition(index: number, patch: Partial<RuleCondition>) {
        if (current.current.json !== null) return
        change({ ...draft, definition: { ...draft.definition, conditions: draft.definition.conditions!.map((item, i) => i === index ? { ...item, ...patch } : item) } })
    }
    async function check(more = false) {
        if (!canEdit() || json !== null) return
        const version = ++epoch.current, fixed = more && window ? window : tuningWindow(range)
        renewHosts(); inputGeneration.current++; pending.current = true; setBusy(true); onBusy(true); setError('')
        try {
            const next = await previewTuningRule(settings, access, draft, fixed, more ? preview?.cursor || null : null, signal)
            if (version !== epoch.current || !mounted.current || signal.aborted) return
            setWindow(fixed)
            setPreview(more && preview ? { ...next, count: next.count + preview.count, scanned: next.scanned + preview.scanned, bytes: next.bytes + preview.bytes,
                events: [...preview.events, ...next.events.filter(row => !preview.events.some(old => old.id === row.id))].slice(-2000) } : next)
        } catch (cause) {
            if (version === epoch.current && mounted.current && !signal.aborted) {
                setError(message(cause)); setPreview(null); setWindow(null)
                if (cause instanceof TuningError && [401, 403].includes(cause.status)) onDenied()
            }
        }
        finally { pending.current = false; onBusy(false); if (mounted.current) { renewHosts(); setBusy(false) } }
    }
    function review() {
        if (!canEdit() || json !== null) return
        try { tuningSignature(draft) } catch (cause) { setError(message(cause)); return }
        const snapshot = JSON.stringify(draft), version = epoch.current
        Alert.alert('Create rule in Hanasand?', `${draft.name}\n${draft.definition.stage} · ${draft.definition.action}\n${draft.definition.conditions?.length} conditions\n\nThis changes how future events are handled. Existing logs are unchanged until a separate reprocessing confirmation.`, [
            { text: 'Cancel', style: 'cancel' }, { text: 'Create rule', onPress: () => {
                if (signal.aborted || !mounted.current || current.current.disabled || current.current.json !== null || pending.current || version !== epoch.current || JSON.stringify(current.current.draft) !== snapshot) return
                renewHosts(); inputGeneration.current++; pending.current = true; setBusy(true); onBusy(true); setError('')
                void createTuningRule(settings, access, draft, signal).then(rule => {
                    if (!mounted.current || signal.aborted) return
                    if (epoch.current === version) onCreated(rule)
                    else onUncertain()
                }).catch(cause => {
                    if (!mounted.current || signal.aborted) return
                    setError(message(cause))
                    if (cause instanceof TuningError && [401, 403].includes(cause.status)) onDenied()
                    if (!(cause instanceof TuningError) || cause.uncertain) onUncertain()
                }).finally(() => { pending.current = false; onBusy(false); if (mounted.current) { renewHosts(); setBusy(false) } })
            } },
        ])
    }
    return <GlassCard style={{ gap: 12 }}>
        <SectionTitle title='Create rule' eyebrow='Fixed workspace · Hanasand' body='Review the exact conditions. A Drop rule affects stored-log retention.' />
        <InlineNotice message={error} />
        <TuningInput nativeKey={hostKey} label='Rule name' value={draft.name} onChange={name => change({ ...draft, name })} disabled={unavailable} maxLength={120} />
        <TuningInput nativeKey={hostKey} label='Description' value={draft.explanation} onChange={explanation => change({ ...draft, explanation })} disabled={unavailable} multiline maxLength={500} />
        <TuningChoices nativeKey={hostKey} label='Stage' options={['match', 'analyze', 'detect']} value={draft.definition.stage || 'analyze'} disabled={unavailable} onChange={stage => change({ ...draft, definition: { ...draft.definition, stage, action: stage === 'analyze' ? draft.definition.action : 'keep' } })} />
        <TuningChoices nativeKey={hostKey} label='Action' options={draft.definition.stage === 'analyze' ? ['keep', 'drop'] : ['keep']} value={draft.definition.action || 'keep'} disabled={unavailable} onChange={action => change({ ...draft, definition: { ...draft.definition, action } })} />
        <TuningChoices nativeKey={hostKey} label='Severity' options={['low', 'medium', 'high', 'critical']} value={draft.definition.action === 'drop' ? 'low' : draft.severity} disabled={unavailable || draft.definition.action === 'drop'} onChange={severity => change({ ...draft, severity })} />
        {(draft.definition.conditions || []).map((item, index) => <View key={index} style={{ gap: 8 }}>
            <TuningInput nativeKey={hostKey} label={`Condition ${index + 1} field`} value={item.path} disabled={unavailable || json !== null} onChange={path => condition(index, { path })} maxLength={80} />
            <TuningChoices nativeKey={hostKey} label='Operator' options={['equals', 'contains', 'regex']} value={item.operator} disabled={unavailable || json !== null} onChange={operator => condition(index, { operator })} />
            <TuningInput nativeKey={hostKey} label={`Condition ${index + 1} value`} value={item.value} disabled={unavailable || json !== null} onChange={value => condition(index, { value })} maxLength={200} />
            <PillButton key={`case:${hostKey}`} small label={`Match case: ${item.caseSensitive ? 'yes' : 'no'}`} disabled={unavailable || json !== null} onPress={() => condition(index, { caseSensitive: !item.caseSensitive })} />
            <PillButton key={`remove:${hostKey}`} small label={`Remove condition ${index + 1}`} disabled={unavailable || json !== null || draft.definition.conditions!.length <= 1} onPress={() => changeConditions(draft.definition.conditions!.filter((_, i) => i !== index))} />
        </View>)}
        <PillButton key={'Add condition:' + hostKey} label='Add condition' disabled={unavailable || json !== null || draft.definition.conditions!.length >= 8} onPress={() => changeConditions([...draft.definition.conditions!, { path: 'event_type', operator: 'equals', value: '' }])} />
        {json === null ? <PillButton key={'Edit conditions as JSON:' + hostKey} label='Edit conditions as JSON' disabled={unavailable} onPress={() => editJson(JSON.stringify(draft.definition.conditions, null, 2))} /> : <>
            <TuningInput nativeKey={hostKey} label='Conditions JSON' value={json} onChange={editJson} disabled={unavailable} multiline />
            <PillButton key={'Apply JSON:' + hostKey} label='Apply JSON' disabled={unavailable} onPress={() => {
                if (!canEdit()) return
                try { const conditions = validateRuleConditions(JSON.parse(json)); change({ ...draft, definition: { ...draft.definition, conditions } }); inputGeneration.current++; renewHosts(); setJson(null) }
                catch (cause) { setError(message(cause)) }
            }} />
            <PillButton key={'Cancel JSON edits:' + hostKey} label='Cancel JSON edits' disabled={unavailable} onPress={() => editJson(null)} />
        </>}
        <TuningChoices nativeKey={hostKey} label='Preview range · hours or all stored logs' options={tuningRanges} value={range} disabled={unavailable} onChange={changeRange} />
        <PillButton key={'Check matches:' + hostKey} label='Check matches' disabled={unavailable || json !== null} onPress={() => void check()} />
        {preview && <>
            <TuningPreviewResults preview={preview} conditions={draft.definition.conditions || []} />
            <PillButton key={'Check more events:' + hostKey} label='Check more events' disabled={unavailable || !preview.cursor} onPress={() => void check(true)} />
        </>}
        <PillButton key={`create:${hostKey}`} label={busy ? 'Working…' : 'Review and create rule'} disabled={unavailable || json !== null} onPress={review} />
        <PillButton key={'Close editor:' + hostKey} label='Close editor' disabled={busy} onPress={() => {
            if (mounted.current && !signal.aborted && !pending.current && inputGeneration.current === renderedGeneration) onClose()
        }} />
    </GlassCard>
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : 'The rule operation failed. Refresh and review before continuing.' }
