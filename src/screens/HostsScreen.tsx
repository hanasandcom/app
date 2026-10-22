import { useEffect, useState } from 'react'
import { Text, TextInput, View } from 'react-native'
import type { AppSettings } from '../types'
import { accountToolKey, loadHostAccess } from '../lib/account-system-tools'
import { GlassCard, InlineNotice, PillButton, Screen } from '../components/ui'
import { useAppTheme } from '../theme/context'

export function HostsScreen({ settings, onManageSshKeys }: { settings: AppSettings; onManageSshKeys?: () => void }) { return <AccountHosts key={accountToolKey(settings)} settings={settings} onManageSshKeys={onManageSshKeys} /> }
function AccountHosts({ settings, onManageSshKeys }: { settings: AppSettings; onManageSshKeys?: () => void }) {
    const theme = useAppTheme()
    const [data, setData] = useState<Awaited<ReturnType<typeof loadHostAccess>> | null>(null)
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const [revision, setRevision] = useState(0)
    const [expanded, setExpanded] = useState('')
    const [query, setQuery] = useState('')
    const [limit, setLimit] = useState(30)
    useEffect(() => {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 15000)
        let current = true
        setLoading(true); setData(null); setError(''); setExpanded('')
        void loadHostAccess(settings, controller.signal).then(value => { if (current) setData(value) })
            .catch(cause => { if (current) setError(controller.signal.aborted ? 'The host took too long to respond. Refresh to try again.' : cause instanceof Error ? cause.message : 'Unable to load host access.') })
            .finally(() => { if (current) setLoading(false); clearTimeout(timeout) })
        return () => { current = false; controller.abort(); clearTimeout(timeout) }
    }, [revision])
    const text = { color: theme.textMuted, fontSize: 14, lineHeight: 21 }
    const heading = { color: theme.text, fontSize: 18, fontWeight: '700' as const }
    const users = data?.users.filter(user => `${user.name} ${user.username}`.toLowerCase().includes(query.toLowerCase().trim())) || []
    return <Screen title='Hosts'>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><PillButton small label={loading ? 'Loading…' : 'Refresh'} disabled={loading} onPress={() => setRevision(value => value + 1)} />{onManageSshKeys && <PillButton small label='Manage my SSH keys' onPress={onManageSshKeys} />}</View>
        {!!error && <InlineNotice message={error} />}
        {loading && <Text style={text}>Loading hosts and SSH access…</Text>}
        {data && !data.hosts.length && <Text style={text}>No hosts were reported.</Text>}
        {data?.hosts.map(host => <GlassCard key={host.id} style={{ gap: 12 }}>
            <Text accessibilityRole='header' style={heading}>{host.name}</Text>
            <Text style={{ ...text, color: host.status === 'online' ? theme.success : host.status === 'offline' ? theme.danger : theme.textMuted }}>{host.status === 'unknown' ? 'Status not reported' : host.status === 'online' ? 'Online' : 'Offline'}</Text>
            <Text selectable style={text}>Address: {host.address || 'Not reported'}</Text><Text selectable style={text}>SSH user: {host.username || 'Not reported'}</Text><Text selectable style={text}>Hostname: {host.hostname || 'Not reported'}</Text><Text selectable style={text}>Operating system: {host.operatingSystem || 'Not reported'}</Text>
            <PillButton small label={expanded === host.id ? 'Hide SSH access' : 'Review SSH access'} onPress={() => { setExpanded(current => current === host.id ? '' : host.id); setQuery(''); setLimit(30) }} />
            {expanded === host.id && <>
                <Text style={heading}>Users with SSH keys</Text>
                <TextInput accessibilityLabel='Find SSH access user' value={query} onChangeText={value => { setQuery(value); setLimit(30) }} placeholder='Name or username' placeholderTextColor={theme.textSoft} autoCapitalize='none' autoCorrect={false} style={{ minHeight: 44, color: theme.text, borderWidth: 1, borderColor: theme.surfaceBorderSoft, borderRadius: 12, paddingHorizontal: 12 }} />
                {!users.length && <Text style={text}>{query ? 'No matching users.' : 'No users with recognized SSH keys were reported.'}</Text>}
                {users.slice(0, limit).map(user => <View key={user.id} style={{ gap: 4 }}><Text style={{ color: theme.text, fontWeight: '600' }}>{user.name} · @{user.username}{user.id === settings.userId ? ' · This account' : ''}</Text><Text style={text}>{user.keyCount === null ? 'Key count not reported' : `${user.keyCount} ${user.keyCount === 1 ? 'key' : 'keys'}`}</Text></View>)}
                {users.length > limit && <PillButton small label='Show 30 more' onPress={() => setLimit(value => value + 30)} />}
            </>}
        </GlassCard>)}
    </Screen>
}
