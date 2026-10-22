import { useEffect, useState } from 'react'
import { Text, TextInput, View } from 'react-native'
import type { AppSettings } from '../types'
import { accountToolKey, loadHostUpdates, pendingUpdateTiming, type HostUpdates, type UpdateHost } from '../lib/account-system-tools'
import { GlassCard, InlineNotice, PillButton, Screen } from '../components/ui'
import { useAppTheme } from '../theme/context'

const date = (value: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Not reported'
export function HostUpdatesScreen({ settings }: { settings: AppSettings }) { return <AccountHostUpdates key={accountToolKey(settings)} settings={settings} /> }
function AccountHostUpdates({ settings }: { settings: AppSettings }) {
    const theme = useAppTheme()
    const [host, setHost] = useState<UpdateHost>('inspur')
    const [data, setData] = useState<HostUpdates | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [revision, setRevision] = useState(0)
    const [view, setView] = useState<'pending' | 'history' | 'installed'>('pending')
    const [query, setQuery] = useState('')
    const [limit, setLimit] = useState(30)
    useEffect(() => {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 15000)
        let current = true
        setLoading(true); setData(null); setError(''); setLimit(30); setQuery('')
        void loadHostUpdates(settings, host, controller.signal).then(value => { if (current) setData(value) })
            .catch(cause => { if (current) setError(controller.signal.aborted ? 'The host took too long to respond. Refresh to try again.' : cause instanceof Error ? cause.message : 'Unable to load host updates.') })
            .finally(() => { if (current) setLoading(false); clearTimeout(timeout) })
        return () => { current = false; controller.abort(); clearTimeout(timeout) }
    }, [host, revision])
    const text = { color: theme.textMuted, fontSize: 14, lineHeight: 21 }
    const heading = { color: theme.text, fontSize: 17, fontWeight: '700' as const }
    const row = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 }
    const pending = data?.pending.filter(item => `${item.name} ${item.version} ${item.security ? 'security' : 'regular'}`.toLowerCase().includes(query.toLowerCase().trim())) || []
    const installed = data?.installed.filter(item => `${item.name} ${item.version}`.toLowerCase().includes(query.toLowerCase().trim())) || []
    const history = data?.history.filter(item => `${item.status} ${item.packages.join(' ')} ${item.error}`.toLowerCase().includes(query.toLowerCase().trim())) || []
    const visibleCount = view === 'pending' ? pending.length : view === 'installed' ? installed.length : history.length
    return <Screen title='Host updates'>
        <View style={row}>{(['inspur', 'ovhcloud'] as const).map(value => <PillButton key={value} small label={value === 'inspur' ? 'Inspur' : 'OVH'} tone={host === value ? 'accent' : 'default'} onPress={() => setHost(value)} />)}<PillButton small label={loading ? 'Checking…' : 'Refresh'} disabled={loading} onPress={() => setRevision(value => value + 1)} /></View>
        {!!error && <InlineNotice message={error} />}
        {loading && <Text style={text}>Loading host update status…</Text>}
        {data && <>
            <GlassCard style={{ gap: 10 }}>
                <Text accessibilityRole='header' style={heading}>{host === 'inspur' ? 'Inspur' : 'OVH'} · {data.status === 'unknown' ? 'Waiting for host check-in' : data.status}</Text>
                <Text style={text}>The server installs updates automatically.</Text>
                <Text style={text}>Checked {date(data.checkedAt)}</Text>
                <Text style={text}>{data.status === 'unknown' ? 'Pending package count has not been verified.' : `${data.pending.length} pending packages · ${data.pending.filter(item => item.security).length} security updates`}</Text>
                {!!data.error && <InlineNotice message={data.error} />}
                <Text style={text}>Last installed {date(data.lastUpdateAt)}</Text>
                {!!data.lastUpdatedPackages.length && <Text selectable style={text}>{data.lastUpdatedPackages.join(', ')}</Text>}
                <Text style={text}>{data.policy.delayHours === null ? 'Update delay policy not reported.' : `Security updates immediately; other updates after ${data.policy.delayHours} hours.`}</Text>
                <Text style={text}>Verification: {data.policy.verification || 'Not reported'}</Text>
            </GlassCard>
            <View style={row}>{(['pending', 'history', 'installed'] as const).map(tab => <PillButton key={tab} small label={`${tab[0].toUpperCase()}${tab.slice(1)} · ${data[tab].length}`} tone={view === tab ? 'accent' : 'default'} onPress={() => { setView(tab); setQuery(''); setLimit(30) }} />)}</View>
            <GlassCard style={{ gap: 12 }}>
                <TextInput accessibilityLabel='Filter updates and history' value={query} onChangeText={value => { setQuery(value); setLimit(30) }} placeholder='Filter packages or status' placeholderTextColor={theme.textSoft} autoCapitalize='none' autoCorrect={false} style={{ minHeight: 44, color: theme.text, borderColor: theme.surfaceBorderSoft, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12 }} />
                {!visibleCount && <Text style={text}>{query ? 'No matching records.' : view === 'pending' ? data.status === 'unknown' ? 'No verified package report yet.' : 'No pending packages reported.' : `No ${view} reported.`}</Text>}
                {view === 'pending' && pending.slice(0, limit).map((item, index) => <View key={`${item.name}:${item.version}:${index}`} style={{ gap: 5 }}><Text selectable style={heading}>{item.name}</Text><Text selectable style={text}>{item.version}</Text><Text style={text}>{pendingUpdateTiming(item, data.policy.delayHours)}</Text><Text selectable style={text}>{[item.repository, item.origin].filter(Boolean).join(' · ')}</Text></View>)}
                {view === 'installed' && installed.slice(0, limit).map((item, index) => <View key={`${item.name}:${index}`} style={{ gap: 5 }}><Text selectable style={heading}>{item.name}</Text><Text selectable style={text}>{item.version || 'Version not reported'}</Text></View>)}
                {view === 'history' && history.slice(0, limit).map((item, index) => <View key={`${item.id}:${index}`} style={{ gap: 5 }}><Text style={heading}>{item.today ? 'Today' : date(item.occurredAt)} · {item.status || 'Unknown'}</Text><Text selectable style={text}>{item.packages.length ? item.packages.join(', ') : 'No installed packages reported.'}</Text>{!!item.error && <InlineNotice message={item.error} />}</View>)}
                {visibleCount > limit && <PillButton small label='Show 30 more' onPress={() => setLimit(value => value + 30)} />}
            </GlassCard>
        </>}
    </Screen>
}
