import { useEffect, useRef, useState } from 'react'
import { Alert, Linking, Text, TextInput, View } from 'react-native'
import type { AppSettings } from '../types'
import { GlassCard, InlineNotice, PillButton, Screen } from '../components/ui'
import { useAppTheme } from '../theme/context'
import { deliveryStages, deliveryStatuses, intelligenceAccountKey, loadActorProfiles, loadDeliveryHealth, mergeIntelligencePage, recordDeliveryEvidence, sortActorActivity, validateReportEvidence } from '../lib/intelligence'
import type { ActorProfile, DeliveryFilter, DeliveryRecord, DeliverySnapshot, ReportEvidence } from '../lib/intelligence'

export type IntelligenceMode = 'profiles' | 'activity' | 'timeliness'
export function IntelligenceScreen({ settings, mode, title }: { settings: AppSettings; mode: IntelligenceMode; title?: string }) {
    return mode === 'profiles' || mode === 'activity'
        ? <Profiles key={intelligenceAccountKey(settings)} settings={settings} title={title || (mode === 'activity' ? 'Latest Activity' : 'Actor Profiles')} activity={mode === 'activity'} />
        : <DeliveryHealth key={intelligenceAccountKey(settings)} settings={settings} />
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : 'The intelligence request failed. Try again.' }
function date(value: string) { const parsed = new Date(value); return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : value || 'Not reported' }
function label(value: string) { return value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replace(/Seconds$/, '').trim() }
function duration(value: number | null | undefined) { if (value === undefined || value === null) return '—'; if (value < 60) return `${value.toFixed(1)}s`; return value < 3600 ? `${(value / 60).toFixed(1)}m` : `${(value / 3600).toFixed(1)}h` }
function Body({ children }: { children: React.ReactNode }) { const theme = useAppTheme(); return <Text selectable style={{ color: theme.textMuted, fontSize: 14, lineHeight: 21 }}>{children}</Text> }
function Heading({ children }: { children: React.ReactNode }) { const theme = useAppTheme(); return <Text accessibilityRole='header' style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>{children}</Text> }
function Input({ name, value, onChange, placeholder, disabled = false }: { name: string; value: string; onChange: (value: string) => void; placeholder?: string; disabled?: boolean }) {
    const theme = useAppTheme()
    return <View style={{ gap: 6 }}><Text style={{ color: theme.textMuted, fontSize: 13, fontWeight: '600' }}>{name}</Text><TextInput accessibilityLabel={name} value={value} editable={!disabled} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={theme.textSoft} autoCapitalize='none' autoCorrect={false} style={{ minHeight: 46, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.surfaceBorderSoft, color: theme.text }} /></View>
}
function SourceLink({ url, title }: { url: string | null; title: string }) {
    return url ? <PillButton small label={title} onPress={() => { void Linking.openURL(url).catch(() => Alert.alert('Unable to open reference', 'Try again when a browser is available.')) }} /> : null
}
function Profiles({ settings, title, activity = false }: { settings: AppSettings; title: string; activity?: boolean }) {
    const [draft, setDraft] = useState(''), [query, setQuery] = useState('')
    return <Screen title={title}>
        {activity && <Body>Actors are ordered by most recently observed evidence.</Body>}
        <GlassCard style={{ gap: 12 }}><Input name={activity ? 'Find recent actor activity' : 'Find actor profiles'} value={draft} onChange={setDraft} placeholder='Actor name or alias' /><PillButton label={activity ? 'Search activity' : 'Search profiles'} onPress={() => setQuery(draft.trim())} /></GlassCard>
        <ProfileResults key={query} settings={settings} query={query} activity={activity} />
    </Screen>
}
function ProfileResults({ settings, query, activity = false }: { settings: AppSettings; query: string; activity?: boolean }) {
    const [items, setItems] = useState<ActorProfile[]>([]), [total, setTotal] = useState<number | null>(null)
    const [page, setPage] = useState(1), [nextPage, setNextPage] = useState<number | null>(null), [revision, setRevision] = useState(0)
    const [error, setError] = useState(''), [loading, setLoading] = useState(false), [selected, setSelected] = useState('')
    useEffect(() => {
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000)
        let active = true
        setLoading(true); setError('')
        if (page === 1) { setItems([]); setTotal(null); setNextPage(null); setSelected('') }
        void loadActorProfiles(settings, { query, page }, controller.signal).then(data => {
            if (active) { setItems(current => { const merged = page === 1 ? data.items : mergeIntelligencePage(current, data.items); return activity ? sortActorActivity(merged) : merged }); setTotal(data.total); setNextPage(data.nextPage) }
        }).catch(cause => { if (active) setError(controller.signal.aborted ? 'Profiles took too long to load. Retry to continue.' : message(cause)) })
            .finally(() => { if (active) setLoading(false); clearTimeout(timer) })
        return () => { active = false; controller.abort(); clearTimeout(timer) }
    }, [query, page, revision, settings.authToken])
    return <>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><PillButton small label={loading ? 'Loading…' : 'Refresh'} disabled={loading} onPress={() => { setPage(1); setRevision(value => value + 1) }} />{error && page > 1 ? <PillButton small label='Retry page' disabled={loading} onPress={() => setRevision(value => value + 1)} /> : null}</View>
        {!!error && <InlineNotice message={error} />}
        {total !== null && <Body>{items.length} of {total} {activity ? 'actors' : 'matching profiles'}</Body>}
        {!loading && !error && !items.length && <Body>{activity ? 'No recent actor activity was found.' : 'No actor profiles match this search.'}</Body>}
        {items.map(profile => <GlassCard key={profile.id} style={{ gap: 10 }}>
            <Heading>{profile.name || profile.normalizedName || profile.id}</Heading>
            {activity && <Body>Last observed: {date(profile.lastSeenAt)}</Body>}
            <Body>{profile.actorType || 'Type not reported'} · {profile.reviewState || 'Review state not reported'}</Body>
            <Body>{profile.evidenceCount === null ? 'Evidence count not reported' : `${profile.evidenceCount} evidence records`}{profile.confidence === null ? '' : ` · ${Math.round(profile.confidence * 100)}% confidence`}</Body>
            <PillButton small label={selected === profile.id ? 'Close profile' : 'View profile'} onPress={() => setSelected(current => current === profile.id ? '' : profile.id)} />
            {selected === profile.id && <>
                <Body>Aliases: {profile.aliases.join(', ') || 'None reported'}</Body><Body>First seen: {date(profile.firstSeenAt)}</Body><Body>Last seen: {date(profile.lastSeenAt)}</Body><Body>Updated: {date(profile.updatedAt)}</Body>
                <Body>Profile ID: {profile.id}</Body><Body>Source IDs: {profile.sourceIds.join(', ') || 'None reported'}</Body><Body>Capture IDs: {profile.captureIds.join(', ') || 'None reported'}</Body>
            </>}
        </GlassCard>)}
        {nextPage !== null && !error && <PillButton label={loading ? 'Loading…' : 'Load next 50 profiles'} disabled={loading} onPress={() => setPage(nextPage)} />}
    </>
}
function DeliveryHealth({ settings }: { settings: AppSettings }) {
    const [query, setQuery] = useState(''), [tenant, setTenant] = useState(settings.selectedOrganizationId === 'personal' ? '' : settings.selectedOrganizationId || '')
    const [filter, setFilter] = useState<DeliveryFilter>({ scope: 'global', tenantId: '', status: '', query: '' })
    const [scope, setScope] = useState<'global' | 'tenant'>('global')
    return <Screen title='Delivery Health'>
        <GlassCard style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>{(['global', 'tenant'] as const).map(value => <PillButton small key={value} label={value === 'global' ? 'Global records' : 'Specific tenant'} tone={scope === value ? 'accent' : 'default'} onPress={() => setScope(value)} />)}</View>
            {scope === 'tenant' && <Input name='Tenant or organization ID' value={tenant} onChange={setTenant} />}
            <Input name='Search delivery records' value={query} onChange={setQuery} placeholder='Actor, source, incident, capture or anomaly' />
            <PillButton label='Apply filters' onPress={() => setFilter(current => ({ ...current, scope, tenantId: scope === 'tenant' ? tenant.trim() : '', query: query.trim() }))} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{deliveryStatuses.map(status => <PillButton small key={status.value} label={status.label} tone={filter.status === status.value ? 'accent' : 'default'} onPress={() => setFilter(current => ({ ...current, status: status.value }))} />)}</View>
        </GlassCard>
        <DeliveryResults key={JSON.stringify(filter)} settings={settings} filter={filter} />
    </Screen>
}
function DeliveryResults({ settings, filter }: { settings: AppSettings; filter: DeliveryFilter }) {
    const [snapshot, setSnapshot] = useState<DeliverySnapshot | null>(null)
    const [cursor, setCursor] = useState<string | null>(null), [revision, setRevision] = useState(0)
    const [error, setError] = useState(''), [notice, setNotice] = useState(''), [loading, setLoading] = useState(false), [selected, setSelected] = useState(''), [metrics, setMetrics] = useState(false)
    useEffect(() => {
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000)
        let active = true
        setLoading(true); setError('')
        if (cursor === null) { setSnapshot(null); setSelected('') }
        void loadDeliveryHealth(settings, filter, cursor, controller.signal).then(data => {
            if (active) setSnapshot(current => cursor === null || !current ? data : { ...data, items: mergeIntelligencePage(current.items, data.items) })
        }).catch(cause => { if (active) setError(controller.signal.aborted ? 'Delivery health took too long to respond. Retry to continue.' : message(cause)) })
            .finally(() => { if (active) setLoading(false); clearTimeout(timer) })
        return () => { active = false; controller.abort(); clearTimeout(timer) }
    }, [cursor, revision, filter, settings.authToken])
    function refresh() { setCursor(null); setRevision(value => value + 1) }
    const summary = snapshot?.summary
    const summaryLabels = [['recordCount', 'Retained'], ['unresolvedReferenceCount', 'Needs first report'], ['anomalyCount', 'Anomalies'], ['awaitingAlertCount', 'Awaiting alert'], ['awaitingDeliveryCount', 'Awaiting delivery'], ['completeCount', 'Complete'], ['excludedMetricRecordCount', 'Excluded from metrics']]
    return <>
        <Body>Scope: {filter.scope === 'tenant' ? filter.tenantId : 'Global records'} · {deliveryStatuses.find(status => status.value === filter.status)?.label}</Body>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><PillButton small label={loading ? 'Loading…' : 'Refresh records'} disabled={loading} onPress={refresh} />{error && cursor !== null ? <PillButton small label='Retry page' disabled={loading} onPress={() => setRevision(value => value + 1)} /> : null}</View>
        {!!error && <InlineNotice message={error} />}{!!notice && <InlineNotice message={notice} />}
        {snapshot && <>
            <GlassCard style={{ gap: 10 }}><Heading>Delivery overview</Heading><Body>Snapshot: {date(snapshot.generatedAt)}</Body><Body>{snapshot.items.length} of {snapshot.total} matching records</Body>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{summaryLabels.map(([key, title]) => <View key={key} style={{ minWidth: '44%', gap: 2 }}><Body>{title}: {summary?.[key] ?? '—'}</Body></View>)}</View>
                {[['observedCoverage', 'Observed'], ['reviewedCoverage', 'Reviewed'], ['reportToAlertCoverage', 'Report → alert'], ['reportToDeliveredCoverage', 'Report → delivered']].map(([key, title]) => <Body key={key}>{title}: {summary?.[key] === undefined ? '—' : `${Math.round(summary[key] * 100)}%`}</Body>)}
                <PillButton small label={metrics ? 'Hide metrics and quality' : 'View metrics and quality'} onPress={() => setMetrics(value => !value)} />
                {metrics && <DeliveryMetrics snapshot={snapshot} />}
            </GlassCard>
            {!snapshot.items.length && <Body>No retained records match this scope and queue.</Body>}
            {snapshot.items.map(item => <GlassCard key={item.id} style={{ gap: 10 }}>
                <Heading>{item.actorName || item.title || item.incidentId}</Heading><Body>{item.title || item.incidentId}</Body><Body>{item.sourceName || item.sourceId} · {deliveryStatuses.find(status => status.value === item.status)?.label}</Body>
                {!!item.anomalies.length && <InlineNotice message={item.anomalies.join(', ')} />}
                <PillButton small label={selected === item.id ? 'Close evidence path' : 'Inspect evidence path'} onPress={() => setSelected(value => value === item.id ? '' : item.id)} />
                {selected === item.id && <RecordDetail key={item.id} item={item} settings={settings} filter={filter} onSaved={created => { setNotice(created ? 'Public first-report evidence recorded.' : 'This evidence was already recorded.'); refresh() }} />}
            </GlassCard>)}
            {snapshot.nextCursor !== null && !error && <PillButton label={loading ? 'Loading…' : 'Load next 50 records'} disabled={loading} onPress={() => setCursor(snapshot.nextCursor)} />}
        </>}
    </>
}
function DeliveryMetrics({ snapshot }: { snapshot: DeliverySnapshot }) {
    return <View style={{ gap: 14 }}>
        <Heading>Measured intervals</Heading><Body>Median · p95 · p99 · sample size. Unproven or anomalous timestamps are excluded from distributions.</Body>
        {snapshot.metrics.stages.map(metric => <Body key={metric.name}>{label(metric.name)}: {duration(metric.medianSeconds)} · {duration(metric.p95Seconds)} · {duration(metric.p99Seconds)} · n={metric.sampleSize ?? '—'}</Body>)}
        {(['sources', 'actors'] as const).map(group => <View key={group} style={{ gap: 6 }}><Heading>{group === 'sources' ? 'Source families' : 'Actors'} · report → delivered</Heading>{snapshot.metrics[group].length ? snapshot.metrics[group].map(row => <Body key={row.name}>{row.name}: {duration(row.delivered.medianSeconds)} · {duration(row.delivered.p95Seconds)} · {duration(row.delivered.p99Seconds)} · n={row.delivered.sampleSize ?? '—'}</Body>) : <Body>No eligible measurements.</Body>}</View>)}
        <Heading>Measured data quality</Heading>{snapshot.quality.fields.map(field => <Body key={field.name}>{label(field.name)}: {field.coverage === null ? '—' : `${Math.round(field.coverage * 100)}%`} · {field.missingCount ?? '—'} missing</Body>)}
        {snapshot.quality.issues.map(issue => <Body key={issue.name}>{issue.name}: {issue.count ?? '—'}</Body>)}
        {snapshot.quality.sourceClasses.map(group => <View key={group.name} style={{ gap: 4 }}><Body>{group.name}: {group.recordCount ?? '—'} records</Body><Body>Missing: {Object.entries(group.missing).map(([name, count]) => `${label(name)} ${count}`).join(', ') || 'None reported'}</Body><Body>Issues: {Object.entries(group.issues).map(([name, count]) => `${name} ${count}`).join(', ') || 'None reported'}</Body></View>)}
    </View>
}
function RecordDetail({ item, settings, filter, onSaved }: { item: DeliveryRecord; settings: AppSettings; filter: DeliveryFilter; onSaved: (created: boolean) => void }) {
    const emptyForm: ReportEvidence = { role: 'actor', timestamp: '', referenceUrl: '', referenceTitle: '', evidencePath: '' }
    const [form, setForm] = useState(emptyForm), [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
    const attempt = useRef(0), controller = useRef<AbortController | null>(null)
    useEffect(() => () => { attempt.current += 1; controller.current?.abort() }, [])
    async function save() {
        if (busy) return
        try { validateReportEvidence(item.id, form) } catch (cause) { setError(message(cause)); return }
        const id = ++attempt.current, request = new AbortController(), timeout = setTimeout(() => request.abort(), 20000)
        controller.current = request
        setBusy(true); setError('')
        try { const response = await recordDeliveryEvidence(settings, filter, item.id, form, request.signal); if (attempt.current === id) onSaved(response.created) }
        catch (cause) { if (attempt.current === id) setError(request.signal.aborted ? 'No confirmation received. Refresh the record before retrying.' : message(cause)) }
        finally { clearTimeout(timeout); if (attempt.current === id) setBusy(false) }
    }
    return <View style={{ gap: 12 }}>
        {!!item.summary && <Body>{item.summary}</Body>}{item.sources.map((source, index) => <SourceLink key={index} url={source.url} title={source.title || 'Open source'} />)}
        {item.exclusion && <InlineNotice message={`Rejected: ${item.exclusion.reason} · ${item.exclusion.reviewedBy} · ${date(item.exclusion.reviewedAt)}`} />}
        {!item.stages.first_report && <Body>Report lookup: {item.recovery.status || 'Queued'}{item.recovery.attempts === null ? '' : ` · ${item.recovery.attempts} attempts`}{item.recovery.reason ? ` · ${item.recovery.reason}` : ''}{item.recovery.nextAttemptAt ? ` · Next: ${date(item.recovery.nextAttemptAt)}` : ''}</Body>}
        <Heading>Persisted event path</Heading>
        {deliveryStages.map(stage => <View key={stage} style={{ gap: 3 }}><Body>{item.provenance[stage].event === 'server_first_seen' ? 'First seen on Hanasand' : label(stage)}: {item.stages[stage] ? date(item.stages[stage]) : 'Not recorded'}</Body>{!!item.provenance[stage].evidencePath && <Body>Source field: {item.provenance[stage].evidencePath}</Body>}<SourceLink url={item.provenance[stage].referenceUrl} title='Open stage reference' /></View>)}
        <Heading>Measured intervals</Heading>{Object.entries(item.latencies).map(([name, value]) => <Body key={name}>{label(name)}: {duration(value)}</Body>)}
        <Body>Incident: {item.incidentId} · Capture: {item.captureId} · Source: {item.sourceId}</Body>
        <Heading>First-report references</Heading>{!item.references.length && <Body>No verified public first-report evidence recorded.</Body>}
        {item.references.map((reference, index) => <View key={index} style={{ gap: 4 }}><Body>{reference.role}: {date(reference.timestamp)} · {reference.evidencePath}</Body><Body>{reference.referenceTitle}</Body><SourceLink url={reference.referenceUrl} title='Open public reference' /></View>)}
        <PillButton small label={open ? 'Close evidence form' : 'Add public first-report evidence'} disabled={busy} onPress={() => setOpen(value => !value)} />
        {open && <View style={{ gap: 12 }}>
            <Body>Use the timestamp exactly as published by the actor, victim, or publisher and identify the source field.</Body>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{(['actor', 'victim', 'publisher'] as const).map(role => <PillButton small key={role} label={role} tone={form.role === role ? 'accent' : 'default'} disabled={busy} onPress={() => setForm(value => ({ ...value, role }))} />)}</View>
            {(['timestamp', 'referenceUrl', 'evidencePath', 'referenceTitle'] as const).map(field => <Input key={field} name={{ timestamp: 'Timestamp with timezone', referenceUrl: 'Public reference URL', evidencePath: 'Source-field path', referenceTitle: 'Reference title (optional)' }[field]} value={form[field]} disabled={busy} onChange={value => setForm(current => ({ ...current, [field]: value }))} placeholder={{ timestamp: '2026-07-22T10:00:00Z', referenceUrl: 'https://…', evidencePath: 'article.time[datetime]', referenceTitle: '' }[field]} />)}
            {!!error && <InlineNotice message={error} />}
            <PillButton label={busy ? 'Recording…' : 'Record public evidence'} tone='accent' disabled={busy} onPress={() => void save()} />
        </View>}
    </View>
}
