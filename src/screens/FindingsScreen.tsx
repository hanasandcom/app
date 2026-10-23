import { useEffect, useRef, useState } from 'react'
import { AppState, Text, TextInput, View, type ScrollView } from 'react-native'
import { useIsFocused } from '@react-navigation/native'
import type { AppSettings } from '../types'
import { GlassCard, InlineNotice, PillButton, Screen, SectionTitle } from '../components/ui'
import { FindingEvidence, time } from '../components/FindingEvidence'
import { useAppTheme } from '../theme/context'
import { filterFindings, findingCaseRef, findingsScope, loadFindings, type FindingCaseRef, type FindingsPage } from '../lib/findings'

type Props = { settings: AppSettings; onOpenCase: (ref: FindingCaseRef) => void; onOpenActor: (name: string) => void; onOpenMonitoredActors: (organizationId: string) => void }
export function FindingsScreen(props: Props) { return <WorkspaceFindings key={findingsScope(props.settings)} {...props} /> }
function WorkspaceFindings({ settings, onOpenCase, onOpenActor, onOpenMonitoredActors }: Props) {
    const theme = useAppTheme(), focused = useIsFocused(), scroll = useRef<ScrollView>(null)
    const [foreground, setForeground] = useState(AppState.currentState === 'active')
    const [page, setPage] = useState<FindingsPage | null>(null), [cursor, setCursor] = useState<string | null>(null)
    const [prior, setPrior] = useState<Array<string | null>>([]), [revision, setRevision] = useState(0)
    const [query, setQuery] = useState(''), [reviewOnly, setReviewOnly] = useState(false), [localPage, setLocalPage] = useState(0)
    const [selectedId, setSelectedId] = useState(''), [loading, setLoading] = useState(false), [error, setError] = useState('')
    const active = useRef(false), mounted = useRef(true), epoch = useRef(0), read = useRef<AbortController | null>(null)
    const row = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 }
    const meta = { color: theme.textMuted, fontSize: 13, lineHeight: 20 }
    useEffect(() => {
        mounted.current = true
        const subscription = AppState.addEventListener('change', state => {
            if (state !== 'active') { active.current = false; epoch.current++; read.current?.abort(); setPage(null); setSelectedId('') }
            setForeground(state === 'active')
        })
        return () => { mounted.current = false; active.current = false; epoch.current++; read.current?.abort(); subscription.remove() }
    }, [])
    useEffect(() => {
        active.current = focused && foreground
        if (!active.current) { setPage(null); setSelectedId(''); return }
        const current = ++epoch.current, controller = new AbortController()
        read.current = controller; setLoading(true); setError(''); setPage(null); setSelectedId(''); setLocalPage(0)
        void loadFindings(settings, cursor, controller.signal).then(value => {
            if (!controller.signal.aborted && current === epoch.current && active.current) setPage(value)
        }).catch(cause => {
            if (!controller.signal.aborted && current === epoch.current) setError(cause instanceof Error ? cause.message : 'Findings is unavailable. Refresh to try again.')
        }).finally(() => { if (mounted.current && current === epoch.current && !controller.signal.aborted) setLoading(false) })
        return () => { active.current = false; epoch.current++; controller.abort() }
        // Account, service, session, impersonation and workspace changes remount this component.
    }, [focused, foreground, cursor, revision, settings])
    function top() { scroll.current?.scrollTo({ y: 0, animated: false }) }
    function refresh() {
        epoch.current++; read.current?.abort(); setPrior([]); setCursor(null); setRevision(value => value + 1); top()
    }
    function next() {
        if (!page?.nextCursor || loading || !active.current || prior.length >= 200) return
        if (prior.includes(page.nextCursor)) { setError('The next page repeated an earlier cursor. Refresh to start again.'); return }
        setPrior(value => [...value, cursor]); setCursor(page.nextCursor); top()
    }
    function previous() {
        if (loading || !prior.length || !active.current) return
        setCursor(prior[prior.length - 1]); setPrior(value => value.slice(0, -1)); top()
    }
    const filtered = filterFindings(page?.items || [], query, reviewOnly)
    const current = Math.min(localPage, Math.max(0, Math.ceil(filtered.length / 20) - 1))
    const selected = page?.items.find(item => item.id === selectedId)
    const caseRef = selected ? findingCaseRef(selected) : undefined
    const available = !!page && page.scope === findingsScope(settings) && active.current && !loading
    return <Screen title='Findings' subtitle={!settings.selectedOrganizationId || settings.selectedOrganizationId === 'personal' ? 'Personal monitoring' : 'Organization monitoring'} scrollViewRef={scroll}
        right={<PillButton small label='Refresh' disabled={loading} onPress={refresh} />}>
        <InlineNotice message={error} />
        {loading && <Text accessibilityRole='progressbar' style={meta}>Loading findings…</Text>}
        {selected ? <>
            <PillButton label='Back to findings' onPress={() => { setSelectedId(''); top() }} />
            <GlassCard style={{ gap: 10 }}>
                <SectionTitle eyebrow={`${selected.severity || 'Severity not recorded'} · ${selected.reviewState.replaceAll('_', ' ') || 'Review state not recorded'}`} title={selected.title} body={`Matched ${selected.matchedTerm}`} />
                <Text selectable style={{ color: theme.text, lineHeight: 22 }}>{selected.summary}</Text>
                <Text style={meta}>{selected.observation} · {time(selected.observedAt)}</Text>
                <Text selectable style={{ color: theme.text, lineHeight: 22 }}>{selected.recommendedAction || 'No recommended action was recorded.'}</Text>
                <View style={row}>
                    {selected.actor && <PillButton label='Search actor' disabled={!available} onPress={() => { if (available && active.current) onOpenActor(selected.actor) }} />}
                    {caseRef ? <PillButton label='Open case' disabled={!available} onPress={() => { if (available && active.current) onOpenCase(caseRef) }} /> : <Text style={meta}>No case yet</Text>}
                </View>
            </GlassCard>
            <FindingEvidence key={selected.id} items={selected.evidence} />
        </> : <>
            <View style={{ gap: 6 }}>
                <Text style={meta}>Search loaded findings</Text>
                <TextInput accessibilityLabel='Search loaded findings' value={query} maxLength={120} onChangeText={value => { setQuery(value); setLocalPage(0) }}
                    autoCorrect={false} autoCapitalize='none' placeholder='Company, domain, or actor' placeholderTextColor={theme.textSoft}
                    style={{ color: theme.text, borderWidth: 1, borderColor: theme.surfaceBorderSoft, borderRadius: 12, padding: 12 }} />
            </View>
            <View style={row}>
                <PillButton small label='All findings' tone={!reviewOnly ? 'accent' : 'default'} onPress={() => { setReviewOnly(false); setLocalPage(0) }} />
                <PillButton small label='Needs review' tone={reviewOnly ? 'accent' : 'default'} onPress={() => { setReviewOnly(true); setLocalPage(0) }} />
            </View>
            {page && <Text style={meta}>{filtered.length} match in {page.items.length} loaded findings · {page.total} server records before local filters</Text>}
            {page && !filtered.length && <Text style={meta}>{page.items.length ? 'No loaded findings match this filter.' : page.nextCursor ? 'No findings on this server page. Continue to the next page.' : 'No recent findings.'}</Text>}
            {filtered.slice(current * 20, (current + 1) * 20).map(item => <GlassCard key={item.id} style={{ gap: 10 }}>
                <SectionTitle eyebrow={`${item.severity || 'Unspecified'} · ${item.reviewState.replaceAll('_', ' ') || 'Not recorded'}`} title={item.title} body={`Matched ${item.matchedTerm}`} />
                <Text selectable style={{ color: theme.text, lineHeight: 22 }}>{item.summary}</Text>
                <Text style={meta}>{item.observation} · {time(item.observedAt)} · {item.evidence.length} evidence records</Text>
                <PillButton label={`Investigate ${item.title}`} disabled={!available} onPress={() => { if (available && active.current) { setSelectedId(item.id); top() } }} />
            </GlassCard>)}
            {filtered.length > 20 && <View style={row}>
                <PillButton small label='Previous loaded results' disabled={current === 0} onPress={() => { setLocalPage(current - 1); top() }} />
                <PillButton small label='Next loaded results' disabled={(current + 1) * 20 >= filtered.length} onPress={() => { setLocalPage(current + 1); top() }} />
                <Text style={meta}>{current * 20 + 1}–{Math.min((current + 1) * 20, filtered.length)} of {filtered.length} loaded matches</Text>
            </View>}
            {page && <View style={row}>
                <PillButton label='Previous server page' disabled={loading || !prior.length} onPress={previous} />
                <PillButton label='Next server page' disabled={loading || !page.nextCursor || prior.length >= 200} onPress={next} />
                {prior.length >= 200 && <Text style={meta}>Reached the 200-page browsing limit. Refresh to start again.</Text>}
            </View>}
            <PillButton label='Monitored actors on website' disabled={!available || !page?.organizationId} onPress={() => { if (available && active.current && page?.organizationId) onOpenMonitoredActors(page.organizationId) }} />
        </>}
    </Screen>
}
