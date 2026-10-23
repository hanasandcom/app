import { useEffect, useRef, useState } from 'react'
import { AppState, Text, TextInput, View, type ScrollView } from 'react-native'
import { useIsFocused } from '@react-navigation/native'
import Svg, { Path } from 'react-native-svg'
import type { AppSettings } from '../types'
import { GlassCard, InlineNotice, PillButton, Screen, SectionTitle } from '../components/ui'
import { useAppTheme } from '../theme/context'
import { filterTrafficPage, loadTrafficDomains, loadTrafficMetrics, loadTrafficRecords, trafficAccountKey, type TrafficMetric, type TrafficMetrics, type TrafficRecord, type TrafficRecords } from '../lib/traffic'

type Mode = 'overview' | 'recent'
type Snapshot = { key: string; loading: boolean; domains: string[] | null; metrics: TrafficMetrics | null; records: TrafficRecords | null; errors: string[] }
export function TrafficScreen({ settings, mode }: { settings: AppSettings; mode: Mode }) { return <TrafficWorkspace key={`${trafficAccountKey(settings)}:${mode}`} settings={settings} mode={mode} /> }
function TrafficWorkspace({ settings, mode }: { settings: AppSettings; mode: Mode }) {
    const theme = useAppTheme(), focused = useIsFocused(), scroll = useRef<ScrollView>(null)
    const [foreground, setForeground] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive')
    const [view, setView] = useState(mode), [domain, setDomain] = useState(''), [page, setPage] = useState(1), [revision, setRevision] = useState(0)
    const [domainsOpen, setDomainsOpen] = useState(false), [domainQuery, setDomainQuery] = useState('')
    const [showDetailedStats, setShowDetailedStats] = useState(false)
    const [query, setQuery] = useState(''), [method, setMethod] = useState(''), [status, setStatus] = useState(''), [selected, setSelected] = useState<TrafficRecord | null>(null)
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
    const read = useRef<AbortController | null>(null), epoch = useRef(0)
    const key = JSON.stringify([view, domain, page]), current = snapshot?.key === key ? snapshot : null
    const meta = { color: theme.textMuted, fontSize: 13, lineHeight: 20 }, row = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 }
    const loading = !current || current.loading, records = current?.records
    useEffect(() => {
        const subscription = AppState.addEventListener('change', state => {
            if (state !== 'active') { epoch.current++; read.current?.abort() }
            setForeground(state === 'active')
        })
        return () => subscription.remove()
    }, [])
    useEffect(() => {
        if (!focused || !foreground) { epoch.current++; read.current?.abort(); return }
        const controller = new AbortController(), generation = ++epoch.current
        read.current = controller
        setSnapshot(previous => ({ key, loading: true, domains: previous?.domains || null, metrics: previous?.key === key ? previous.metrics : null, records: previous?.key === key ? previous.records : null, errors: [] }))
        void Promise.allSettled([loadTrafficDomains(settings, controller.signal), view === 'overview' ? loadTrafficMetrics(settings, domain, controller.signal) : Promise.resolve(null), loadTrafficRecords(settings, { domain, limit: view === 'overview' ? 12 : 50, page }, controller.signal)]).then(([domains, metrics, result]) => {
            if (controller.signal.aborted || generation !== epoch.current) return
            setSnapshot(previous => ({ key, loading: false, domains: domains.status === 'fulfilled' ? domains.value : previous?.domains || null,
                metrics: metrics.status === 'fulfilled' ? metrics.value : previous?.key === key ? previous.metrics : null,
                records: result.status === 'fulfilled' ? result.value : previous?.key === key ? previous.records : null,
                errors: [domains, metrics, result].flatMap((entry, index) => entry.status === 'rejected' ? [`${['Domains', 'Statistics', 'Requests'][index]}: ${message(entry.reason)}`] : []), }))
        })
        return () => { controller.abort(); epoch.current++ }
    }, [focused, foreground, key, revision, view, domain, page, settings])
    useEffect(() => {
        if (!focused || !foreground || loading || page !== 1 || selected) return
        const timer = setTimeout(() => setRevision(value => value + 1), 30000)
        return () => clearTimeout(timer)
    }, [focused, foreground, loading, page, selected, key, revision])
    function top() { scroll.current?.scrollTo({ y: 0, animated: false }) }
    function resetFilters() { setPage(1); setSelected(null); setQuery(''); setMethod(''); setStatus(''); setShowDetailedStats(false); top() }
    function refresh() { setSelected(null); setRevision(value => value + 1); top() }
    const metrics = current?.metrics, visible = filterTrafficPage(records?.result || [], query, method, status)
    return <Screen title={view === 'overview' ? 'Traffic overview' : 'Recent traffic'} subtitle='Global traffic · not limited to the selected workspace' scrollViewRef={scroll}
        right={<PillButton small label='Refresh' disabled={loading} onPress={refresh} />}>
        {selected ? <>
            <PillButton label='Back to requests' onPress={() => { setSelected(null); top() }} />
            <GlassCard style={{ gap: 10 }}><SectionTitle eyebrow='Request' title={`${selected.method || 'Unknown method'} · ${selected.status || 'Unknown status'}`} body={`${selected.domain}${selected.path}`} />
                {Object.entries({ Date: formatDate(selected.timestamp), Duration: `${selected.request_time} ms`, Country: selected.country_iso || 'Not recorded', 'User agent': selected.user_agent || 'Not recorded', Referrer: selected.referer || 'Not recorded', 'Record ID': selected.id }).map(([label, value]) => <View key={label}><Text style={meta}>{label}</Text><Text selectable style={{ color: theme.text, lineHeight: 21 }}>{value}</Text></View>)}
            </GlassCard>
        </> : <>
            <View style={row}>{(['overview', 'recent'] as const).map(value => <PillButton key={value} label={value === 'overview' ? 'Overview' : 'Recent requests'} tone={view === value ? 'accent' : 'default'} onPress={() => { setView(value); resetFilters() }} />)}</View>
            <PillButton label={`Domain: ${domain || 'All domains'}`} onPress={() => setDomainsOpen(value => !value)} />
            {domainsOpen && <GlassCard style={{ gap: 10 }}><Input label='Find a domain' value={domainQuery} onChangeText={setDomainQuery} /><View style={row}>
                <PillButton small label='All domains' onPress={() => { setDomain(''); setDomainsOpen(false); resetFilters() }} />
                {(current?.domains || []).filter(value => value.toLowerCase().includes(domainQuery.toLowerCase())).map(value => <PillButton small key={value} label={value} onPress={() => { setDomain(value); setDomainsOpen(false); resetFilters() }} />)}
            </View>{current?.domains === null && <Text style={meta}>Domain choices unavailable. Refresh to try again.</Text>}</GlassCard>}
            {page === 1 && !selected && <Text style={meta}>Updates every 30 seconds while this page is open.</Text>}
            {loading && <Text accessibilityRole='progressbar' style={meta}>Loading traffic… Cold statistics can take up to a minute.</Text>}
            {current?.errors.map(error => <InlineNotice key={error} message={error} />)}
            {!!current?.errors.length && (metrics || records) && <Text style={meta}>Available data is shown below. A failed refresh may leave the previous snapshot visible.</Text>}
            {view === 'overview' && metrics && <>
                <GlassCard style={{ gap: 10 }}><SectionTitle eyebrow='Traffic' title={metrics.total_requests.toLocaleString()} body='Tracked requests across retained traffic history' />
                    <Text style={meta}>Response time: {metrics.total_requests ? `${metrics.avg_request_time.toLocaleString()} ms` : 'No requests'}</Text><Text style={meta}>4xx/5xx share: {(metrics.error_rate * 100).toFixed(1)}%</Text><Text style={meta}>Sampled: {metrics.sampled_at ? formatDate(metrics.sampled_at) : 'Not supplied'}</Text>
                </GlassCard>
                <Trend entries={metrics.requests_over_time} showPoints={showDetailedStats} />
                <PillButton small label={showDetailedStats ? 'Hide detailed statistics' : 'Show detailed statistics'} onPress={() => setShowDetailedStats(value => !value)} />
                {showDetailedStats && <GlassCard style={{ gap: 16 }}>
                    <BreakdownRows title='Methods' entries={metrics.top_methods} />
                    <BreakdownRows title='Status codes' entries={metrics.top_status_codes} />
                    <BreakdownRows title='Domains' entries={metrics.top_domains} />
                    <BreakdownRows title='Top paths' entries={metrics.top_paths} />
                    <BreakdownRows title='Top error paths' entries={metrics.top_error_paths} />
                    <BreakdownRows title='Slow paths' unit='ms' entries={metrics.top_slow_paths.map(value => ({ key: value.key, count: value.avg_time }))} />
                    <BreakdownRows title='Operating systems' entries={metrics.top_os} />
                    <BreakdownRows title='Browsers / user agents' entries={metrics.top_browsers} />
                </GlassCard>}
            </>}
            {view === 'overview' && !loading && !metrics && <Text style={meta}>Traffic statistics are unavailable.</Text>}
            {view === 'recent' && <GlassCard style={{ gap: 10 }}><SectionTitle eyebrow='Loaded page only' title='Filter these requests' />
                <Input label='Search this page' value={query} onChangeText={setQuery} /><View style={row}>{['', ...new Set(records?.result.map(record => record.method) || [])].map(value => <PillButton key={value} small label={value || 'All methods'} tone={method === value ? 'accent' : 'default'} onPress={() => setMethod(value)} />)}</View>
                <View style={row}>{['', '2', '3', '4', '5'].map(value => <PillButton key={value} small label={value ? `${value}xx` : 'All statuses'} tone={status === value ? 'accent' : 'default'} onPress={() => setStatus(value)} />)}</View>
            </GlassCard>}
            <SectionTitle eyebrow='Requests' title={view === 'overview' ? 'Latest requests' : `Page ${page}`} body={records ? `${records.result.length} loaded · ${records.total.toLocaleString()} total${view === 'recent' ? ` · ${visible.length} match page filters` : ''}` : 'Request count unavailable'} />
            {visible.map(record => <GlassCard key={record.id} style={{ gap: 8 }}><Text style={{ color: theme.text, fontWeight: '700' }}>{record.method || 'Unknown method'} · {record.status || 'Unknown status'} · {record.request_time} ms</Text><Text selectable style={meta}>{record.domain}{record.path}</Text><Text style={meta}>{formatDate(record.timestamp)}</Text><PillButton small label='View request' onPress={() => { setSelected(record); top() }} /></GlassCard>)}
            {!loading && records && !visible.length && <Text style={meta}>{records.result.length ? 'No requests on this page match the filters.' : 'No requests were returned for this domain and page.'}</Text>}
            {view === 'recent' && <View style={row}><PillButton label='Previous page' disabled={loading || page === 1} onPress={() => { setPage(value => value - 1); setQuery(''); top() }} /><PillButton label='Next page' disabled={loading || !records || page * records.limit >= records.total || !records.result.length} onPress={() => { setPage(value => value + 1); setQuery(''); top() }} /></View>}
        </>}
    </Screen>
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : 'Unavailable. Refresh to try again.' }
function formatDate(value: string) { return new Date(value).toLocaleString() }
function Input({ label, value, onChangeText }: { label: string; value: string; onChangeText: (value: string) => void }) {
    const theme = useAppTheme()
    return <View style={{ gap: 6 }}><Text style={{ color: theme.textMuted, fontSize: 13 }}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} maxLength={200} autoCorrect={false} autoCapitalize='none' style={{ color: theme.text, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.surfaceBorderSoft }} /></View>
}
function BreakdownRows({ title, entries, unit = 'requests' }: { title: string; entries: TrafficMetric[]; unit?: string }) {
    const theme = useAppTheme(), max = Math.max(1, ...entries.map(value => value.count))
    return <View style={{ gap: 10 }}><Text style={{ color: theme.text, fontSize: 15, fontWeight: '700' }}>{title}</Text>{!entries.length && <Text style={{ color: theme.textMuted }}>No recorded breakdown.</Text>}{entries.map((entry, index) => <View key={`${entry.key}:${index}`} style={{ gap: 5 }}><Text selectable style={{ color: theme.text }}>{entry.key}: {entry.count.toLocaleString()} {unit}</Text><View style={{ height: 5, backgroundColor: theme.surfaceBorderSoft, borderRadius: 4 }}><View style={{ width: `${Math.max(1, entry.count / max * 100)}%`, height: 5, backgroundColor: theme.textMuted, borderRadius: 4 }} /></View></View>)}</View>
}
function Trend({ entries, showPoints }: { entries: TrafficMetric[]; showPoints: boolean }) {
    const theme = useAppTheme(), max = Math.max(1, ...entries.map(value => value.count))
    const path = entries.map((value, index) => `${index ? 'L' : 'M'}${entries.length < 2 ? 150 : index / (entries.length - 1) * 300},${85 - value.count / max * 75}`).join(' ')
    return <GlassCard style={{ gap: 10 }}><SectionTitle eyebrow='Hourly' title='Requests in the last 24 hours' />{entries.length ? <><Svg width='100%' height={90} viewBox='0 0 300 90' accessibilityLabel='Hourly request trend'><Path d={path} stroke={theme.textMuted} strokeWidth={2} fill='none' /></Svg>{showPoints ? entries.map((value, index) => <Text key={`${value.key}:${index}`} style={{ color: theme.textMuted, fontSize: 12 }}>{formatDate(value.key)} · {value.count.toLocaleString()} requests</Text>) : <Text style={{ color: theme.textMuted, fontSize: 12 }}>{entries.length} hourly readings</Text>}</> : <Text style={{ color: theme.textMuted }}>No hourly observations recorded.</Text>}</GlassCard>
}
