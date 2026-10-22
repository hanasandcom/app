import { useEffect, useMemo, useState } from 'react'
import { useIsFocused } from '@react-navigation/native'
import { Alert, Platform, ScrollView, Text, View } from 'react-native'
import type { AppSettings } from '../types'
import { deleteHanasandAccount, fetchProfileStats, type MobileProfileStats } from '../lib/api'
import {
    addAccountSshKey, fetchAccountIdentity, fetchAccountPasskeys, fetchAccountSessions, fetchAccountSshKeys,
    fetchAccountSupportTickets, fetchSupportMessages, sendSupportMessage, nativePasskeysSupported, registerAccountPasskey, removeAccountPasskey,
    removeAccountSshKey, renameAccountPasskey, revokeAccountSession, revokeOtherAccountSessions, updateAccountIdentity,
    type AccountIdentity, type AccountPasskey, type AccountSession, type AccountSshKey, type SupportTicket, type SupportMessage,
} from '../lib/profile-api'
import { GlassCard, InlineNotice, LabeledInput, PillButton, Screen, SectionTitle } from '../components/ui'
import { getThemePalette, spacing, type ThemePalette } from '../theme/tokens'

const sections = ['Profile', 'Security', 'Sessions', 'SSH keys', 'Support'] as const
type Section = typeof sections[number]

export function ProfileScreen({ settings, onLogout, onDeleted, initialSection }: {
    initialSection?: Section; settings: AppSettings; onLogout: () => Promise<void>; onDeleted: () => Promise<void>
}) {
    const theme = getThemePalette(settings.themeMode)
    const styles = useMemo(() => createStyles(theme), [theme])
    const [section, setSection] = useState<Section>(initialSection || 'Profile')
    const focused = useIsFocused()
    useEffect(() => { if (focused && initialSection) setSection(initialSection) }, [focused, initialSection])
    const [busy, setBusy] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [revision, setRevision] = useState(0)
    const [identity, setIdentity] = useState<AccountIdentity | null>(null)
    const [name, setName] = useState('')
    const [username, setUsername] = useState('')
    const [stats, setStats] = useState<MobileProfileStats | null>(null)
    const [statsError, setStatsError] = useState('')
    const [passkeys, setPasskeys] = useState<AccountPasskey[]>([])
    const [sessions, setSessions] = useState<AccountSession[]>([])
    const [keys, setKeys] = useState<AccountSshKey[]>([])
    const [tickets, setTickets] = useState<SupportTicket[]>([])
    const [ticketId, setTicketId] = useState('')
    const [ticketMessages, setTicketMessages] = useState<SupportMessage[]>([])
    const [supportSubject, setSupportSubject] = useState('')
    const [supportMessage, setSupportMessage] = useState('')
    const [messagesLoading, setMessagesLoading] = useState(false)
    const [messagesError, setMessagesError] = useState('')
    const [keyName, setKeyName] = useState('')
    const [publicKey, setPublicKey] = useState('')
    const [addingKey, setAddingKey] = useState(false)
    const [editingPasskey, setEditingPasskey] = useState('')
    const [passkeyLabel, setPasskeyLabel] = useState('')
    const [passkeysSupported] = useState(nativePasskeysSupported)

    useEffect(() => {
        let active = true
        setLoading(true)
        setError('')
        const load = async () => {
            if (section === 'Profile') {
                await Promise.all([
                    fetchAccountIdentity(settings).then(value => {
                        if (active) { setIdentity(value); setName(value.name || ''); setUsername(value.username || value.id) }
                    }),
                    fetchProfileStats(settings).then(value => { if (active) { setStats(value); setStatsError('') } })
                        .catch(cause => { if (active) { setStats(null); setStatsError(message(cause)) } }),
                ])
            } else if (section === 'Security') {
                const value = await fetchAccountPasskeys(settings)
                if (active) setPasskeys(value)
            } else if (section === 'Sessions') {
                const value = await fetchAccountSessions(settings)
                if (active) setSessions(value)
            } else if (section === 'SSH keys') {
                const value = await fetchAccountSshKeys(settings)
                if (active) setKeys(value)
            } else {
                const value = await fetchAccountSupportTickets(settings)
                if (active) setTickets(value)
            }
        }
        void load().catch(cause => { if (active) setError(message(cause)) }).finally(() => { if (active) setLoading(false) })
        return () => { active = false }
    }, [settings.apiBaseUrl, settings.authToken, settings.userId, settings.impersonationToken, revision, section])

    useEffect(() => {
        let active = true
        setTicketMessages([])
        setMessagesError('')
        if (section !== 'Support' || !ticketId) { setMessagesLoading(false); return }
        setMessagesLoading(true)
        void fetchSupportMessages(settings, ticketId).then(value => { if (active) setTicketMessages(value) })
            .catch(cause => { if (active) setMessagesError(message(cause)) })
            .finally(() => { if (active) setMessagesLoading(false) })
        return () => { active = false }
    }, [section, ticketId, revision, settings.apiBaseUrl, settings.authToken, settings.userId, settings.impersonationToken])

    async function act(work: () => Promise<unknown>, success: string, reload = true) {
        if (busy) return
        setBusy(true); setError(''); setNotice('')
        try {
            await work()
            setNotice(success)
            if (reload) setRevision(value => value + 1)
        } catch (cause) { setError(message(cause)) } finally { setBusy(false) }
    }
    function confirm(title: string, body: string, label: string, work: () => Promise<unknown>, success: string) {
        Alert.alert(title, body, [
            { text: 'Cancel', style: 'cancel' },
            { text: label, style: 'destructive', onPress: () => void act(work, success) },
        ])
    }

    return (
        <Screen title='Profile' subtitle={identity ? `@${identity.username || identity.id}` : settings.userId}
            right={<PillButton small label='Refresh' disabled={loading || busy} onPress={() => setRevision(value => value + 1)} />}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
                {sections.map(item => <PillButton key={item} label={item} tone={section === item ? 'accent' : 'default'} disabled={busy} onPress={() => { setSection(item); setNotice(''); setError('') }} />)}
            </ScrollView>
            <InlineNotice message={error} />
            <InlineNotice message={notice} tone='success' />
            {loading && <Text accessibilityRole='progressbar' style={styles.meta}>Loading {section.toLowerCase()}…</Text>}
            {section === 'Profile' && <>
                <GlassCard style={styles.card}>
                    <SectionTitle eyebrow='Your Hanasand account' title={identity?.name || settings.userId} body={identity?.email} />
                    {identity?.active === false && <Text style={styles.meta}>Inactive account</Text>}
                    <LabeledInput label='Display name' value={name} onChangeText={setName} />
                    <LabeledInput label='Username' value={username} onChangeText={setUsername} autoCapitalize='none' autoCorrect={false} />
                    <PillButton label='Save profile' tone='accent' disabled={busy || loading || !identity || !name.trim() || username.trim().length < 3 || (name === identity.name && username === identity.username)} onPress={() => void act(async () => { await updateAccountIdentity(settings, name, username) }, 'Profile updated.')} />
                </GlassCard>
                <GlassCard style={styles.card}>
                    <SectionTitle eyebrow='Overview' title='Workspace usage' />
                    {stats ? <View style={styles.statsGrid}>{[
                        ['Organizations', stats.counts.organizations], ['Files', stats.counts.shares], ['Virtual machines', stats.counts.vms],
                        ['Containers', stats.counts.containers], ['Articles', stats.counts.articles],
                    ].map(([label, value]) => <View key={String(label)} style={styles.stat}><Text style={styles.statValue}>{Number(value).toLocaleString()}</Text><Text style={styles.meta}>{label}</Text></View>)}</View> : <Text style={styles.meta}>{statsError || 'Loading statistics…'}</Text>}
                </GlassCard>
                {stats && <GlassCard style={styles.card}>
                    <SectionTitle eyebrow='Activity' title='Login activity' body={`${stats.loginDays.length} active days · ${stats.loginDays.reduce((total, day) => total + day.logins, 0)} sign-ins in the past year`} />
                    <View style={styles.activity}>{recentActivity(stats.loginDays).map(day => <View key={day.day} accessible accessibilityLabel={`${day.day}: ${day.logins} sign-ins`} style={[styles.activityDay, { backgroundColor: day.logins ? theme.accent : theme.ambientNeutral, opacity: day.logins ? Math.min(1, 0.3 + day.logins / 8) : 1 }]} />)}</View>
                    <Text style={styles.meta}>Past 12 weeks · More color shows more sign-ins</Text>
                </GlassCard>}
            </>}
            {section === 'Security' && <>
                <GlassCard style={styles.card}>
                    <SectionTitle eyebrow='Security' title='Passkeys' body='Use your device to sign in without a password.' />
                    <PillButton label='Add passkey' disabled={busy || !passkeysSupported} onPress={() => void act(() => registerAccountPasskey(settings), 'Passkey added.')} />
                    {!passkeysSupported && <Text style={styles.meta}>Passkeys are unavailable on this device.</Text>}
                    {!loading && !error && !passkeys.length && <Text style={styles.meta}>No passkeys added.</Text>}
                    {passkeys.map(key => <View key={key.credentialId} style={styles.item}>
                        <Text style={styles.title}>{key.label || 'Passkey'}</Text>
                        <Text style={styles.meta}>{key.algorithm} · Added {date(key.createdAt)}{key.lastUsedAt ? ` · Last used ${date(key.lastUsedAt)}` : ' · Never used'}</Text>
                        {editingPasskey === key.credentialId ? <>
                            <LabeledInput label='Passkey name' value={passkeyLabel} onChangeText={setPasskeyLabel} />
                            <View style={styles.row}><PillButton label='Save name' disabled={busy || !passkeyLabel.trim()} onPress={() => void act(async () => { await renameAccountPasskey(settings, key.credentialId, passkeyLabel); setEditingPasskey('') }, 'Passkey renamed.')} /><PillButton label='Cancel' disabled={busy} onPress={() => setEditingPasskey('')} /></View>
                        </> : <View style={styles.row}>
                            <PillButton small label='Rename' disabled={busy} onPress={() => { setEditingPasskey(key.credentialId); setPasskeyLabel(key.label) }} />
                            <PillButton small label='Remove passkey' tone='danger' disabled={busy} onPress={() => confirm('Remove passkey?', 'You will no longer be able to sign in with this passkey.', 'Remove', () => removeAccountPasskey(settings, key.credentialId), 'Passkey removed.')} />
                        </View>}
                    </View>)}
                </GlassCard>
                <GlassCard style={styles.card}>
                    <SectionTitle eyebrow='Account' title='Access' />
                    <View style={styles.row}>
                        <PillButton label='Log out' disabled={busy} onPress={() => confirm('Log out?', 'End your session on this device.', 'Log out', onLogout, '')} />
                        <PillButton label='Delete account' tone='danger' disabled={busy} onPress={() => confirm('Delete account?', 'Your account will be logged out everywhere and scheduled for permanent deletion after 30 days.', 'Delete', async () => { await deleteHanasandAccount(settings); await onDeleted() }, '')} />
                    </View>
                </GlassCard>
            </>}
            {section === 'Sessions' && <GlassCard style={styles.card}>
                <SectionTitle eyebrow='Security' title='Sessions' body='Review devices signed in to your account.' />
                <PillButton label='Revoke other sessions' tone='danger' disabled={busy || loading || !sessions.some(item => !item.current && !item.revoked_at)} onPress={() => confirm('Revoke other sessions?', 'Other devices will need to sign in again.', 'Revoke', () => revokeOtherAccountSessions(settings), 'Other sessions revoked.')} />
                {!loading && !error && !sessions.length && <Text style={styles.meta}>No sessions found.</Text>}
                {sessions.map(session => <View key={session.token_id} style={styles.item}>
                    <Text style={styles.title}>{session.current ? 'This device' : session.user_agent || 'Device'}{session.revoked_at ? ' · Revoked' : ''}</Text>
                    <Text selectable style={styles.meta}>{[session.ip, session.network?.city, session.network?.country, session.network?.provider].filter(Boolean).join(' · ') || 'Network not recorded'}</Text>
                    <Text style={styles.meta}>Signed in {date(session.created_at)} · Last seen {date(session.last_seen_at)}</Text>
                    {session.current && <Text style={styles.meta}>{Platform.OS} · {session.user_agent}</Text>}
                    {!session.current && !session.revoked_at && <PillButton small label='Revoke session' tone='danger' disabled={busy} onPress={() => confirm('Revoke session?', 'This device will need to sign in again.', 'Revoke', () => revokeAccountSession(settings, session.token_id), 'Session revoked.')} />}
                </View>)}
            </GlassCard>}
            {section === 'SSH keys' && <GlassCard style={styles.card}>
                <SectionTitle eyebrow='Security' title='SSH keys' body={`${keys.length} keys`} />
                <PillButton label={addingKey ? 'Cancel' : 'Add SSH key'} disabled={busy} onPress={() => setAddingKey(value => !value)} />
                {addingKey && <>
                    <LabeledInput label='Key name' value={keyName} onChangeText={setKeyName} placeholder='Work laptop' />
                    <LabeledInput label='Public key' value={publicKey} onChangeText={setPublicKey} placeholder='ssh-ed25519 AAAA…' multiline autoCapitalize='none' autoCorrect={false} />
                    <PillButton label='Save SSH key' tone='accent' disabled={busy || !keyName.trim() || !publicKey.trim()} onPress={() => void act(async () => { await addAccountSshKey(settings, keyName, publicKey); setKeyName(''); setPublicKey(''); setAddingKey(false) }, 'SSH key added.')} />
                </>}
                {!loading && !error && !keys.length && <Text style={styles.meta}>No SSH keys added.</Text>}
                {keys.map(key => <View key={key.id} style={styles.item}>
                    <Text style={styles.title}>{key.name} · {key.keyType}</Text>
                    <Text selectable style={styles.fingerprint}>{key.fingerprint}</Text>
                    <Text style={styles.meta}>Added {date(key.addedAt)} · Last used {date(key.lastUsedAt)}</Text>
                    {!!(key.lastUsedServer || key.lastUsedIp) && <Text selectable style={styles.meta}>{[key.lastUsedServer, key.lastUsedIp].filter(Boolean).join(' · ')}</Text>}
                    <PillButton small label='Remove SSH key' tone='danger' disabled={busy} onPress={() => confirm('Remove SSH key?', `Remove ${key.name} from your account?`, 'Remove', () => removeAccountSshKey(settings, key.id), 'SSH key removed.')} />
                </View>)}
            </GlassCard>}
            {section === 'Support' && <GlassCard style={styles.card}>
                <SectionTitle eyebrow='Account' title='Support tickets' />
                <PillButton label='New support ticket' disabled={busy} onPress={() => { setTicketId(''); setSupportMessage(''); setSupportSubject('') }} />
                {!loading && !error && !tickets.length && <Text style={styles.meta}>No support tickets yet.</Text>}
                {tickets.map(ticket => <View key={ticket.id} style={styles.item}>
                    <Text style={styles.title}>{ticket.subject}</Text><Text style={styles.meta}>{ticket.status} · {date(ticket.updated_at)}</Text>
                    <Text style={styles.meta}>{ticket.last_message || 'No messages yet'}</Text>
                    <PillButton small label={ticketId === ticket.id ? 'Selected conversation' : 'Read conversation'} disabled={busy} tone={ticketId === ticket.id ? 'accent' : 'default'} onPress={() => { setTicketId(ticket.id); setSupportMessage('') }} />
                </View>)}
                <View style={styles.item}>
                    <SectionTitle eyebrow='Support' title={ticketId ? tickets.find(ticket => ticket.id === ticketId)?.subject || 'Conversation' : 'New ticket'} />
                    <InlineNotice message={messagesError} />
                    {messagesLoading && <Text style={styles.meta}>Loading conversation…</Text>}
                    {ticketMessages.map(item => <View key={item.id} style={styles.item}>
                        <Text style={styles.title}>{item.sender_name || (item.sender_id === settings.userId ? 'You' : 'Support')}</Text>
                        <Text selectable style={styles.meta}>{item.body}</Text><Text style={styles.meta}>{date(item.created_at)}</Text>
                    </View>)}
                    {!ticketId && <LabeledInput label='Subject' value={supportSubject} onChangeText={setSupportSubject} />}
                    <LabeledInput label='Message' value={supportMessage} onChangeText={setSupportMessage} multiline />
                    <PillButton label={ticketId ? 'Send reply' : 'Create ticket'} tone='accent' disabled={busy || messagesLoading || !!messagesError || !supportMessage.trim() || (!ticketId && !supportSubject.trim())} onPress={() => void act(async () => {
                        const result = await sendSupportMessage(settings, ticketId, supportSubject.trim(), supportMessage.trim())
                        setSupportMessage('')
                        if (result.id) setTicketId(result.id)
                    }, 'Message sent.')} />
                </View>
            </GlassCard>}
        </Screen>
    )
}
function message(error: unknown) { return error instanceof Error ? error.message : 'Unable to complete this request.' }
function date(value: string | null) { const parsed = value ? new Date(value) : null; return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleString() : 'Not recorded' }
function recentActivity(days: MobileProfileStats['loginDays']) {
    const activity = new Map(days.map(day => [day.day, day.logins]))
    const today = new Date(); const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
    return Array.from({ length: 84 }, (_, index) => { const day = new Date(end - (83 - index) * 86400000).toISOString().slice(0, 10); return { day, logins: activity.get(day) || 0 } })
}
function createStyles(theme: ThemePalette) {
    return {
        card: { gap: spacing.md }, row: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
        meta: { color: theme.textMuted, fontSize: 13, lineHeight: 19 }, title: { color: theme.text, fontSize: 15, fontWeight: '700' as const },
        item: { gap: spacing.sm, borderTopWidth: 1, borderColor: theme.surfaceBorderSoft, paddingTop: spacing.md },
        fingerprint: { color: theme.textMuted, fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
        statsGrid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
        stat: { minWidth: 120, flexGrow: 1, borderRadius: 16, borderWidth: 1, borderColor: theme.surfaceBorderSoft, backgroundColor: theme.ambientNeutral, padding: 12 },
        statValue: { color: theme.text, fontSize: 22, fontWeight: '800' as const },
        activity: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 4 }, activityDay: { width: 14, height: 14, borderRadius: 3 },
    }
}
