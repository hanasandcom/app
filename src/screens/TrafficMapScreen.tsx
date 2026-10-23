import { useEffect, useRef, useState } from 'react'
import { AppState, Text, View } from 'react-native'
import { useIsFocused } from '@react-navigation/native'
import type { AppSettings } from '../types'
import { GlassCard, InlineNotice, PillButton, Screen, SectionTitle } from '../components/ui'
import { TrafficMap, type TrafficPing } from '../components/TrafficMap'
import { useAppTheme } from '../theme/context'
import { countryCentroids, locatedTrafficCountries } from '../data/traffic-geography'
import { loadTrafficDomains, loadTrafficMetrics, loadTrafficRecords, trafficAccountKey, type TrafficMetrics, type TrafficRecord } from '../lib/traffic'
import { openTrafficStream, TrafficStreamError, trafficStreamingFetch } from '../lib/traffic-stream'

type Status = 'Connecting' | 'Live' | 'Reconnecting' | 'Polling snapshots' | 'Access refresh required'
export function TrafficMapScreen({ settings, streamTransport = trafficStreamingFetch }: { settings: AppSettings; streamTransport?: typeof fetch }) {
    return <TrafficMapWorkspace key={trafficAccountKey(settings)} settings={settings} streamTransport={streamTransport} />
}
function TrafficMapWorkspace({ settings, streamTransport }: { settings: AppSettings; streamTransport: typeof fetch }) {
    const theme = useAppTheme(), focused = useIsFocused(), generation = useRef(0), running = useRef<AbortController | null>(null)
    const [foreground, setForeground] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive')
    const [domain, setDomain] = useState(''), [domains, setDomains] = useState<string[]>([]), [showDomains, setShowDomains] = useState(false), [revision, setRevision] = useState(0), [blocked, setBlocked] = useState(false)
    const [snapshot, setSnapshot] = useState<{ domain: string; records: TrafficRecord[]; total: number; at: number } | null>(null), [metrics, setMetrics] = useState<TrafficMetrics | null>(null)
    const [error, setError] = useState(''), [streamNotice, setStreamNotice] = useState(''), [status, setStatus] = useState<Status>('Connecting'), [loading, setLoading] = useState(true)
    const [selected, setSelected] = useState('NO'), [record, setRecord] = useState<TrafficRecord | null>(null), [pings, setPings] = useState<TrafficPing[]>([]), [now, setNow] = useState(Date.now()), [lastBatch, setLastBatch] = useState<{ count: number; at: number } | null>(null)
    const cursor = useRef(''), sequence = useRef(0)
    const meta = { color: theme.textMuted, fontSize: 13, lineHeight: 20 }
    useEffect(() => {
        const subscription = AppState.addEventListener('change', value => { if (value !== 'active') { generation.current++; running.current?.abort() }; setForeground(value === 'active') })
        return () => subscription.remove()
    }, [])
    useEffect(() => {
        if (!foreground || !focused || blocked) { running.current?.abort(); return }
        const controller = new AbortController(), own = ++generation.current; running.current = controller
        let streamTimer: ReturnType<typeof setTimeout>, snapshotTimer: ReturnType<typeof setTimeout>, failures = 0
        const active = () => !controller.signal.aborted && own === generation.current
        cursor.current = ''; setSnapshot(null); setMetrics(null); setRecord(null); setPings([]); setLastBatch(null); setLoading(true); setError(''); setStreamNotice('')
        async function snapshots() {
            const results = await Promise.allSettled([loadTrafficDomains(settings, controller.signal), loadTrafficMetrics(settings, domain, controller.signal), loadTrafficRecords(settings, { domain, limit: 200, page: 1 }, controller.signal)])
            if (!active()) return
            const [choices, summary, records] = results
            if (choices.status === 'fulfilled') setDomains(choices.value)
            if (summary.status === 'fulfilled') setMetrics(summary.value)
            if (records.status === 'fulfilled') {
                setSnapshot({ domain, records: records.value.result, total: records.value.total, at: Date.now() })
                const safeIds = records.value.result.map(item => Number(item.id)).filter(Number.isSafeInteger)
                const newest = Math.max(0, ...safeIds); if (newest > Number(cursor.current || 0)) cursor.current = String(newest)
            }
            const failures = results.filter(result => result.status === 'rejected').map(result => result.status === 'rejected' ? message(result.reason) : '')
            setError(failures.join(' ')); setLoading(false)
            if (failures.some(value => /Sign in again|Traffic access is unavailable/.test(value))) { setBlocked(true); setStatus('Access refresh required'); return }
            snapshotTimer = setTimeout(() => { if (active()) void snapshots() }, 15000)
        }
        async function connect() {
            if (!active()) return
            setStatus(failures ? 'Reconnecting' : 'Connecting')
            try {
                await openTrafficStream(settings, { domain, ...(cursor.current ? { after: cursor.current } : {}) }, {
                    onReady: () => { if (active()) { setStatus('Live'); setStreamNotice('') } },
                    onBatch: batch => {
                        if (!active()) return
                        const at = Date.now(), known = batch.filter(item => countryCentroids[item.iso])
                        cursor.current = String(Math.max(Number(cursor.current || 0), ...batch.map(item => Number(item.max_id))))
                        setLastBatch({ count: batch.reduce((sum, item) => sum + item.count, 0), at })
                        setPings(previous => [...previous.filter(item => at - item.at < 2200), ...known.map(item => ({ id: ++sequence.current, iso: item.iso, count: item.count, at }))].slice(-40))
                    },
                }, controller.signal, streamTransport)
            } catch (cause) {
                if (!active()) return
                if (cause instanceof TrafficStreamError && [401, 403].includes(cause.status)) { setBlocked(true); setStatus('Access refresh required'); setStreamNotice(cause.message); return }
                failures++; setStreamNotice('Live feed disconnected. Recent request snapshots remain available.')
                if (failures >= 5) { setStatus('Polling snapshots'); return }
                setStatus('Reconnecting'); streamTimer = setTimeout(() => { if (active()) void connect() }, Math.min(15000, 1000 * 2 ** failures))
            }
        }
        void snapshots(); void connect()
        return () => { controller.abort(); generation.current++; clearTimeout(streamTimer); clearTimeout(snapshotTimer) }
    }, [settings, streamTransport, domain, revision, focused, foreground, blocked])
    useEffect(() => {
        if (!foreground || !focused) return
        const timer = setInterval(() => { const time = Date.now(); setNow(time); setPings(previous => previous.filter(item => time - item.at < 2200)) }, 200)
        return () => clearInterval(timer)
    }, [foreground, focused])
    const current = snapshot?.domain === domain ? snapshot : null, records = current?.records || [], countries = locatedTrafficCountries(records), located = countries.reduce((sum, item) => sum + item.count, 0)
    const selectedCountry = countries.some(item => item.iso === selected) ? selected : countries[0]?.iso || selected
    const country = countries.find(item => item.iso === selectedCountry), selectedRecords = records.filter(item => item.country_iso === selectedCountry)
    return <Screen title='Live traffic map' subtitle='Global traffic · not scoped to the selected workspace' right={<PillButton small label='Refresh' onPress={() => { setBlocked(false); setRevision(value => value + 1) }} />}>
        <InlineNotice message={error} /><InlineNotice message={streamNotice} />
        <Text accessibilityLiveRegion='polite' style={{ color: theme.text, fontWeight: '700' }}>{!foreground || !focused ? 'Paused while this page is inactive' : status}</Text>
        {blocked && <Text style={meta}>Automatic reconnect and snapshot requests are paused. Refresh after checking account access.</Text>}
        <PillButton label={`Domain: ${domain || 'All domains'}`} onPress={() => setShowDomains(value => !value)} />
        {showDomains && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{['', ...domains].map(value => <PillButton small key={value} label={value || 'All domains'} onPress={() => { setDomain(value); setShowDomains(false); setSelected('NO'); setRecord(null); setSnapshot(null); setMetrics(null) }} />)}</View>}
        {loading && <Text accessibilityRole='progressbar' style={meta}>Loading recent requests and statistics…</Text>}
        <GlassCard style={{ gap: 12 }}><Text style={meta}>{current ? `${records.length} latest requests loaded · ${located} located · ${current.total.toLocaleString()} retained requests in this domain filter. Snapshot ${new Date(current.at).toLocaleTimeString()}.` : 'Recent request snapshot is unavailable.'}</Text>
            <Text style={meta}>{lastBatch ? `Latest live batch: ${lastBatch.count} requests · ${new Date(lastBatch.at).toLocaleTimeString()}` : 'No live request batch received yet.'}</Text>
            <TrafficMap key={domain} countries={countries} selected={selectedCountry} onSelect={iso => { setSelected(iso); setRecord(null) }} pings={pings} now={now} />
        </GlassCard>
        <GlassCard style={{ gap: 10 }}><SectionTitle eyebrow='Country focus' title={selectedCountry} body='Counts and shares refer only to located requests in the latest loaded 200-request window.' />
            <Text style={meta}>{!current ? 'Country counts unavailable.' : <>{country?.count || 0} requests · {located ? ((country?.count || 0) / located * 100).toFixed(1) : '0.0'}% of located requests{country ? ` · Last seen ${new Date(country.lastSeen).toLocaleString()}` : ''}</>}</Text>
            {!!current && !selectedRecords.length && <Text style={meta}>No located requests for this country in the current snapshot.</Text>}
            {selectedRecords.slice(0, 10).map(item => <PillButton small key={item.id} label={`${item.method} ${item.status} · ${item.domain}${item.path}`} onPress={() => setRecord(item)} />)}
            {selectedRecords.length > 10 && <Text style={meta}>Showing the latest 10 matching requests.</Text>}
            {record && <View style={{ gap: 6 }}><PillButton small label='Close request detail' onPress={() => setRecord(null)} />{[`${record.method} ${record.status}`, `${record.domain}${record.path}`, `${record.request_time} ms · ${new Date(record.timestamp).toLocaleString()}`, record.user_agent, record.referer || 'No referrer recorded'].map((value, index) => <Text selectable key={index} style={meta}>{value}</Text>)}</View>}
        </GlassCard>
        {metrics ? <GlassCard style={{ gap: 6 }}><SectionTitle eyebrow='Retained traffic' title={`${metrics.total_requests.toLocaleString()} requests`} /><Text style={meta}>Average response: {metrics.total_requests ? `${metrics.avg_request_time} ms` : 'No requests'} · 4xx/5xx share: {(metrics.error_rate * 100).toFixed(1)}%</Text><Text style={meta}>Statistics sampled: {metrics.sampled_at ? new Date(metrics.sampled_at).toLocaleString() : 'Not supplied'}</Text></GlassCard> : !loading && <Text style={meta}>Traffic statistics unavailable.</Text>}
    </Screen>
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : 'Traffic snapshots are unavailable. Refresh to try again.' }
