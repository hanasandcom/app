import { useEffect, useRef, useState } from 'react'
import { Alert, Switch, Text, TextInput, View } from 'react-native'
import type { AppSettings } from '../types'
import { GlassCard, InlineNotice, PillButton, Screen } from '../components/ui'
import { useAppTheme } from '../theme/context'
import { createOrganizationRule, loadOrganizationRule, loadOrganizationRules, previewOrganizationRule, RuleRequestError, rulePreviewWindow, rulesAccountScope, setOrganizationRuleEnabled, updateOrganizationRule, type OrganizationRule, type RuleCategory, type RuleCondition, type RuleDefinition, type RuleDetail, type RuleDraft, type RulePreview, type RulePreviewWindow, type RulesContext } from '../lib/organization-rules'

export function RulesScreen(props: { settings: AppSettings, category: RuleCategory }) {
    const identity = rulesAccountScope(props.settings)
    const account = useRef({ identity, revision: 0 })
    if (account.current.identity !== identity) account.current = { identity, revision: account.current.revision + 1 }
    return <RulesWorkspace key={`${account.current.revision}/${props.category}`} {...props} />
}
const categoryName = { match: 'Match rules', analysis: 'Analysis rules', detection: 'Detection rules' }
function newDraft(category: RuleCategory): RuleDraft {
    return { name: '', explanation: '', severity: 'medium', enabled: true, definition: { stage: category === 'analysis' ? 'analyze' : category === 'detection' ? 'detect' : 'match', action: 'keep', match: 'all', conditions: [{ path: 'event_type', operator: 'equals', value: '' }] } }
}
function draftOf(rule: OrganizationRule): RuleDraft {
    return JSON.parse(JSON.stringify({ name: rule.name, explanation: rule.explanation, severity: rule.severity, enabled: rule.enabled, definition: rule.definition })) as RuleDraft
}
function RulesWorkspace({ settings, category }: { settings: AppSettings, category: RuleCategory }) {
    const theme = useAppTheme()
    const [context, setContext] = useState<RulesContext | null>(null)
    const [detail, setDetail] = useState<RuleDetail | null>(null)
    const [draft, setDraft] = useState<RuleDraft | null>(null)
    const [definitionJson, setDefinitionJson] = useState('')
    const [query, setQuery] = useState('')
    const [page, setPage] = useState(0)
    const [loading, setLoading] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [conflict, setConflict] = useState(false)
    const [preview, setPreview] = useState<RulePreview | null>(null)
    const [previewWindow, setPreviewWindow] = useState<RulePreviewWindow | null>(null)
    const [hours, setHours] = useState<1 | 24 | 168>(24)
    const mounted = useRef(true)
    const operation = useRef(false)
    const sequence = useRef(0)
    const controller = useRef<AbortController | null>(null)
    useEffect(() => {
        mounted.current = true; void loadList()
        return () => { mounted.current = false; sequence.current++; controller.current?.abort() }
    }, [])
    const text = { color: theme.textMuted, fontSize: 14, lineHeight: 21 }
    const heading = { color: theme.text, fontSize: 19, fontWeight: '600' as const }
    const row = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, alignItems: 'center' as const }
    const input = { color: theme.text, backgroundColor: theme.surfaceStrong, padding: 12, borderRadius: 12, fontSize: 15 }
    const editable = !!context?.canManage && (!detail || detail.canEdit && !detail.isHistorical)
        && (draft?.definition.stage !== 'analyze' || context?.canManageRetention === true)
    const filtered = context?.rules.filter(rule => `${rule.name} ${rule.id} ${rule.explanation} ${rule.family || ''}`.toLowerCase().includes(query.trim().toLowerCase())) || []
    const visible = filtered.slice(page * 30, (page + 1) * 30)
    const isBuiltin = detail?.rule.source === 'hanasand'
    const dirty = !!draft && (!detail ? draft.name !== '' || draft.explanation !== '' : JSON.stringify(draft) !== JSON.stringify(draftOf(detail.rule)) || isBuiltin && definitionJson !== JSON.stringify(detail.rule.definition, null, 2))
    function startRead() {
        controller.current?.abort(); controller.current = new AbortController()
        return { request: ++sequence.current, signal: controller.current.signal }
    }
    function current(request: number) { return mounted.current && request === sequence.current }
    function confirm(title: string, message: string, action: () => void, danger = false) {
        Alert.alert(title, message, [{ text: 'Cancel', style: 'cancel' }, { text: 'Continue', style: danger ? 'destructive' : 'default', onPress: () => { if (mounted.current) action() } }])
    }
    async function loadList() {
        const { request, signal } = startRead()
        setLoading(true); setError('')
        try { const result = await loadOrganizationRules(settings, category, signal); if (current(request)) setContext(result) }
        catch (cause) { if (current(request)) setError(message(cause)) }
        finally { if (current(request)) setLoading(false) }
    }
    async function open(id: string) {
        if (!context) return
        const { request, signal } = startRead()
        setLoading(true); setError(''); setPreview(null); setPreviewWindow(null)
        try {
            const result = await loadOrganizationRule(settings, context, id, signal)
            if (!current(request)) return
            setDetail(result); setDraft(draftOf(result.rule)); setDefinitionJson(JSON.stringify(result.rule.definition, null, 2)); setConflict(false)
        } catch (cause) { if (current(request)) setError(message(cause)) }
        finally { if (current(request)) setLoading(false) }
    }
    function closeEditor() {
        const close = () => { sequence.current++; controller.current?.abort(); setDetail(null); setDraft(null); setPreview(null); setError(''); setConflict(false); setLoading(false); void loadList() }
        if (dirty) confirm('Discard unsaved changes?', 'Your changes have not been saved.', close, true)
        else close()
    }
    function change(next: RuleDraft) {
        setDraft(next); setPreview(null); setPreviewWindow(null)
    }
    function definition(next: RuleDefinition) { if (draft) change({ ...draft, definition: next, severity: next.action === 'drop' ? 'low' : draft.severity }) }
    async function write(action: () => Promise<OrganizationRule>) {
        if (operation.current || !mounted.current || !context || conflict) return
        operation.current = true; setBusy(true); setError(''); setNotice('')
        try {
            const result = await action()
            if (!mounted.current) return
            setNotice('Rule saved. It applies to new events; existing events were not reprocessed.')
            // Keep a saved draft visible if refreshing the authoritative detail fails.
            setDraft(draftOf(result)); setDefinitionJson(JSON.stringify(result.definition, null, 2))
            setDetail({ scope: context.scope, organizationId: context.organization.id, canEdit: false, isHistorical: false, rule: { ...result, version: result.version! }, audit: [], nextOffset: null })
            await open(result.id)
        } catch (cause) {
            if (!mounted.current) return
            setError(message(cause))
            if (cause instanceof RuleRequestError && cause.status === 409) setConflict(true)
        } finally { operation.current = false; if (mounted.current) setBusy(false) }
    }
    function preparedDraft(): RuleDraft {
        if (!draft) throw new Error('Open a rule first.')
        if (!isBuiltin) return draft
        let value: unknown
        try { value = JSON.parse(definitionJson) } catch { throw new Error('The rule definition is not valid JSON.') }
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Use a JSON object for the rule definition.')
        return { ...draft, definition: value as RuleDefinition }
    }
    function save() {
        if (!context || !draft || !editable || conflict) return
        let value: RuleDraft
        try { value = preparedDraft() } catch (cause) { setError(message(cause)); return }
        confirm(detail ? 'Save rule changes?' : 'Create enabled rule?', `${context.organization.name}: ${value.definition.action === 'drop' ? 'This Analyze rule can drop eligible future events.' : 'This rule will apply to new events.'} Existing events will not be reprocessed.`, () => { void write(() => detail ? updateOrganizationRule(settings, context, detail, value) : createOrganizationRule(settings, context, value)) }, value.definition.action === 'drop')
    }
    async function checkMatches(next = false) {
        if (!context || !draft || operation.current || loading) return
        const { request, signal } = startRead()
        setLoading(true); setError('')
        try {
            const value = preparedDraft()
            const window = next && previewWindow ? previewWindow : rulePreviewWindow(hours)
            const result = await previewOrganizationRule(settings, context, value.definition, window, next ? preview?.cursor || null : null, signal)
            if (!current(request)) return
            setPreview(result); setPreviewWindow(window)
        } catch (cause) { if (current(request)) setError(message(cause)) }
        finally { if (current(request)) setLoading(false) }
    }
    function field(label: string, value: string, onChange: (value: string) => void, maxLength: number, multiline = false) {
        return <View style={{ gap: 6 }}><Text style={text}>{label}</Text><TextInput accessibilityLabel={label} style={[input, multiline && { minHeight: 90, textAlignVertical: 'top' }]} value={value} onChangeText={onChange} maxLength={maxLength} multiline={multiline} editable={editable && !busy && !loading && !conflict} autoCorrect={false} autoCapitalize='none' /></View>
    }
    return <Screen title='Rules' subtitle={`${categoryName[category]}${context ? ` · ${context.organization.name}` : ''}`}>
        {!!error && <InlineNotice title={conflict ? 'Rule changed remotely' : 'Rules unavailable'} message={error} />}
        {!!notice && <InlineNotice title='Rule saved' message={notice} />}
        {loading && <Text style={text}>Loading…</Text>}
        {!draft && <>
            <View style={row}><PillButton label='Refresh rules' disabled={loading || busy} onPress={() => { void loadList() }} />
                <PillButton label='Create rule' tone='accent' disabled={!context?.canManage || category === 'analysis' && !context.canManageRetention || loading || busy} onPress={() => { setDetail(null); setDraft(newDraft(category)); setConflict(false); setNotice(''); setPreview(null); setError('') }} /></View>
            {context && <>
                {category === 'analysis' && context.canManage && !context.canManageRetention && <Text style={text}>Creating Analyze rules also requires active Hanasand owner or editor access for log retention.</Text>}
                {!context.canManage && <Text style={text}>You can read these rules. An organization owner, admin, or editor can change them.</Text>}
                <TextInput accessibilityLabel='Search rules' placeholder='Search name, ID, or description' placeholderTextColor={theme.textSoft} value={query} onChangeText={value => { setQuery(value); setPage(0) }} style={input} />
                <Text style={text}>{filtered.length} rules</Text>
                {!filtered.length && <Text style={text}>No rules match this view.</Text>}
                {visible.map(item => <GlassCard key={item.id}><Text style={heading}>{item.name}</Text><Text style={text}>{item.explanation}</Text><Text style={text}>{item.enabled ? 'Enabled' : 'Disabled'} · {item.severity} · {item.source || 'Unknown source'} · {item.hitCount == null ? 'Hits unavailable' : `${item.hitCount} hits`}</Text><PillButton label={`Open ${item.name}`} disabled={loading || busy} onPress={() => { setNotice(''); void open(item.id) }} /></GlassCard>)}
                <View style={row}><PillButton label='Previous rules' disabled={page === 0 || loading} onPress={() => setPage(value => value - 1)} /><Text style={text}>Page {page + 1} of {Math.max(1, Math.ceil(filtered.length / 30))}</Text><PillButton label='Next rules' disabled={(page + 1) * 30 >= filtered.length || loading} onPress={() => setPage(value => value + 1)} /></View>
            </>}
        </>}
        {draft && context && <>
            <View style={row}><PillButton label='Back to rules' disabled={busy || loading} onPress={closeEditor} />{detail && <PillButton label='Reload current rule' disabled={busy || loading} onPress={() => confirm('Reload current rule?', 'This discards your local draft and loads the latest version and access.', () => { void open(detail.rule.id) }, true)} />}</View>
            <GlassCard><Text style={heading}>{detail ? detail.rule.name : 'New rule'}</Text><Text style={text}>{detail ? `Version ${detail.rule.version} · ${detail.rule.source || 'Unknown source'}${detail.isHistorical ? ' · Historical, read only' : ''}` : 'New rules are enabled when created.'}</Text>
                {!editable && <Text style={text}>This rule is read only with your current access. Analyze rules also require Hanasand retention access.</Text>}
                {field('Rule name', draft.name, name => change({ ...draft, name }), 120)}
                {field('Description', draft.explanation, explanation => change({ ...draft, explanation }), 500, true)}
                <Text style={text}>Severity</Text><View style={row}>{['low', 'medium', 'high', 'critical'].map(value => <PillButton key={value} small label={`${draft.severity === value ? '✓ ' : ''}${value}`} disabled={!editable || busy || loading || conflict || draft.definition.action === 'drop'} onPress={() => change({ ...draft, severity: value })} />)}</View>
                <Text style={text}>Stage: {draft.definition.stage || 'Match'} · Action: {draft.definition.action === 'drop' ? 'Drop' : 'Store'}</Text>
                {!detail && <View style={row}>{(['match', 'analyze', 'detect'] as const).map(value => <PillButton key={value} small label={value} disabled={!editable || busy || loading || value === 'analyze' && !context.canManageRetention} onPress={() => definition({ ...draft.definition, stage: value, action: 'keep' })} />)}</View>}
                {!isBuiltin && draft.definition.stage === 'analyze' && <View style={row}>{['keep', 'drop'].map(action => <PillButton key={action} label={action === 'keep' ? 'Store events' : 'Drop eligible events'} disabled={!editable || busy || loading || conflict} onPress={() => definition({ ...draft.definition, action })} />)}
                    {draft.definition.action === 'keep' && <PillButton label={`Store scope: ${draft.definition.storeScope || 'all'}`} disabled={!detail || !editable || busy || loading || conflict} onPress={() => definition({ ...draft.definition, storeScope: draft.definition.storeScope === 'custom_drop' ? 'all' : 'custom_drop' })} />}</View>}
                {isBuiltin ? <><Text style={text}>Complete detection definition</Text><Text style={text}>Edit the full definition. Unchanged selectors, parameters, and protection settings are included when saving.</Text><TextInput accessibilityLabel='Complete rule definition JSON' value={definitionJson} onChangeText={value => { setDefinitionJson(value); setPreview(null); setPreviewWindow(null) }} multiline autoCorrect={false} autoCapitalize='none' maxLength={100000} editable={editable && !busy && !loading && !conflict} style={[input, { minHeight: 260, fontFamily: 'monospace', textAlignVertical: 'top' }]} /></>
                    : <><Text style={heading}>All conditions must match</Text>{(draft.definition.conditions || []).map((condition, index) => <View key={index} style={{ gap: 8, paddingVertical: 10 }}>
                        {field(`Condition ${index + 1} field`, condition.path, path => definition({ ...draft.definition, conditions: draft.definition.conditions?.map((item, i) => i === index ? { ...item, path } : item) }), 80)}
                        <View style={row}>{(['equals', 'contains', 'regex'] as const).map(operator => <PillButton key={operator} label={`${condition.operator === operator ? '✓ ' : ''}${operator}`} small disabled={!editable || busy || loading || conflict} onPress={() => definition({ ...draft.definition, conditions: draft.definition.conditions?.map((item, i) => i === index ? { ...item, operator } : item) })} />)}</View>
                        {field(`Condition ${index + 1} value`, condition.value, value => definition({ ...draft.definition, conditions: draft.definition.conditions?.map((item, i) => i === index ? { ...item, value } : item) }), 200)}
                        <View style={row}><Text style={text}>Case sensitive</Text><Switch accessibilityLabel={`Condition ${index + 1} case sensitive`} value={condition.caseSensitive === true} disabled={!editable || busy || loading || conflict} onValueChange={caseSensitive => definition({ ...draft.definition, conditions: draft.definition.conditions?.map((item, i) => i === index ? { ...item, caseSensitive } : item) })} /><PillButton label={`Remove condition ${index + 1}`} small disabled={!editable || busy || loading || conflict || (draft.definition.conditions?.length || 0) <= 1} onPress={() => definition({ ...draft.definition, conditions: draft.definition.conditions?.filter((_, i) => i !== index) })} /></View>
                    </View>)}<PillButton label='Add condition' disabled={!editable || busy || loading || conflict || (draft.definition.conditions?.length || 0) >= 8} onPress={() => definition({ ...draft.definition, conditions: [...draft.definition.conditions || [], { path: 'event_type', operator: 'equals', value: '' } as RuleCondition] })} /></>}
                <PillButton label={detail ? 'Save rule changes' : 'Create enabled rule'} tone='accent' disabled={!editable || busy || loading || conflict} onPress={save} />
                {detail && <PillButton label={detail.rule.enabled ? 'Disable rule' : 'Enable rule'} tone={detail.rule.enabled ? 'danger' : 'default'} disabled={!editable || busy || loading || conflict} onPress={() => confirm(detail.rule.enabled ? 'Disable rule?' : 'Enable rule?', 'This changes handling of future events. The rule and its history are retained; Unsaved editor changes will be discarded.', () => { void write(() => setOrganizationRuleEnabled(settings, context, detail, !detail.rule.enabled)) }, detail.rule.enabled)} />}
            </GlassCard>
            <GlassCard><Text style={heading}>Preview stored matches</Text><Text style={text}>Read-only sample using these field conditions. It does not apply, reprocess, or execute a rule. Built-in thresholds and correlations are not simulated.</Text>
                <View style={row}>{([1, 24, 168] as const).map(value => <PillButton key={value} small label={`${hours === value ? '✓ ' : ''}${value === 1 ? '1 hour' : value === 24 ? '24 hours' : '7 days'}`} disabled={busy || loading} onPress={() => { setHours(value); setPreview(null); setPreviewWindow(null) }} />)}<PillButton label='Check matches' disabled={busy || loading} onPress={() => { void checkMatches() }} /></View>
                {preview && <><Text style={text}>{preview.count} matches in {preview.scanned} checked events{preview.cursor ? ' · More events remain' : ''}. Counts describe this sample, not all history.</Text>
                    {preview.events.slice(0, 10).map(event => <View key={event.id} style={{ gap: 4 }}><Text style={text}>{new Date(event.timestamp).toLocaleString()}</Text><Text selectable style={[text, { fontFamily: 'monospace' }]}>{JSON.stringify(event.normalized, null, 2).slice(0, 3000)}</Text></View>)}
                    <Text style={text}>Showing up to 10 example events from this checked sample.</Text><PillButton label='Check next sample' disabled={!preview.cursor || busy || loading} onPress={() => { void checkMatches(true) }} /></>}
            </GlassCard>
            {detail && <GlassCard><Text style={heading}>Recent changes</Text>{!detail.audit.length && <Text style={text}>No recorded changes.</Text>}{detail.audit.slice(0, 10).map(event => <Text key={event.id} style={text}>{new Date(event.created_at).toLocaleString()} · {event.event_type}</Text>)}{detail.audit.length > 10 || detail.nextOffset !== null ? <Text style={text}>Showing recent changes only. Full history is available on the website.</Text> : null}</GlassCard>}
        </>}
    </Screen>
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : 'Unable to load rules. Please retry.' }
