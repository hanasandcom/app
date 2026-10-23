import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, AppState, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import type { AppSettings } from '../types'
import { GlassCard, InlineNotice, LabeledInput, PillButton, Screen, StatChip } from '../components/ui'
import { UserManagementDetail } from '../components/UserManagementDetail'
import { useAppTheme } from '../theme/context'
import { changeManagedUser, isReservedUser, loadManagedProfile, loadUserManagement, mayOpenUserOrganization, UserManagementError, UserManagementOperations, userManagementScope, visibleManagedUsers, type ManagedProfile, type ManagedUser, type UserAction, type UserOrganization, type UserSnapshot } from '../lib/user-management'

type Props = { settings: AppSettings; onSelectOrganization: (id: string) => void }
export function UserManagementScreen(props: Props) { return <Users key={userManagementScope(props.settings)} {...props} /> }
function Users({ settings, onSelectOrganization }: Props) {
    const theme = useAppTheme(), [snapshot, setSnapshot] = useState<UserSnapshot | null>(null)
    const [selected, setSelected] = useState(''), [profile, setProfile] = useState<ManagedProfile | null>(null), [profileError, setProfileError] = useState('')
    const [query, setQuery] = useState(''), [showReserved, setShowReserved] = useState(false), [shown, setShown] = useState(30)
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [boundary, setBoundary] = useState(0)
    const operations = useRef(new UserManagementOperations()), mounted = useRef(true), focused = useRef(false), foreground = useRef(AppState.currentState === 'active')
    const latest = useRef({ snapshot, selected }); latest.current = { snapshot, selected }
    const captured = operations.current.generation
    function publishBoundary() { setBoundary(operations.current.generation) }
    function visible() { return mounted.current && focused.current && foreground.current }
    function hide() {
        const ops = operations.current
        if (ops.pending) ops.locked = true
        ops.visible = false; ops.pending = false; ops.invalidate()
        setBusy(false); setProfile(null); setSnapshot(null); setError(''); setProfileError(''); publishBoundary()
    }
    async function refresh(explicit = true) {
        const ops = operations.current
        if (!visible() || ops.pending) return
        ops.visible = true
        const read = ops.beginRead(explicit)
        setBusy(true); setError(''); publishBoundary()
        try {
            const result = await loadUserManagement(settings, read.controller.signal)
            if (!ops.finishRead(read.ticket)) return
            setSnapshot(result); setSelected(''); ops.selection = ''; setProfile(null); setProfileError('')
        } catch (cause) {
            if (ops.current(read.ticket.generation) && !read.controller.signal.aborted) { ops.failRead(read.ticket); setError(message(cause)) }
        } finally { if (ops.current(read.ticket.generation)) { setBusy(false); publishBoundary() } }
    }
    useFocusEffect(useCallback(() => {
        mounted.current = true; focused.current = true
        if (foreground.current) void refresh(false)
        return () => { focused.current = false; hide() }
    }, []))
    useEffect(() => {
        mounted.current = true
        const listener = AppState.addEventListener('change', state => {
            const returning = !foreground.current && state === 'active'
            foreground.current = state === 'active'
            if (!foreground.current) hide()
            else if (returning && focused.current) void refresh(false)
        })
        return () => { mounted.current = false; operations.current.visible = false; operations.current.invalidate(); listener.remove() }
    }, [])
    function usable(generation = captured) { return visible() && operations.current.current(generation) && !operations.current.pending }
    async function select(user: ManagedUser) {
        const ops = operations.current
        if (!usable() || busy) return
        ops.selection = user.id
        const read = ops.beginRead(false)
        setSelected(user.id); setProfile(null); setProfileError(''); setBusy(true); publishBoundary()
        try {
            const result = await loadManagedProfile(settings, user.id, read.controller.signal)
            if (ops.current(read.ticket.generation) && ops.selection === user.id && !read.controller.signal.aborted) setProfile(result)
        } catch (cause) { if (ops.current(read.ticket.generation) && !read.controller.signal.aborted) setProfileError(message(cause)) }
        finally { if (ops.current(read.ticket.generation)) setBusy(false) }
    }
    function review(action: UserAction) {
        const ops = operations.current, current = latest.current.snapshot
        const user = current?.users.find(user => user.id === latest.current.selected)
        if (!usable() || busy || ops.locked || !current?.access.canWrite || !user) return
        const confirmation = ops.confirm(userManagementScope(settings), action)
        const description = action === 'delete' ? 'Schedule this account for deletion in 30 days. Access tokens will be revoked now. Active organization ownership may need to be transferred first.'
            : action === 'deactivate' ? 'Deactivate this account and revoke all its access tokens.' : 'Reactivate this account. Previously revoked access tokens remain revoked.'
        Alert.alert(`${action === 'delete' ? 'Schedule deletion' : action === 'deactivate' ? 'Deactivate' : 'Activate'} ${user.username}?`, description, [
            { text: 'Cancel', style: 'cancel' }, { text: action === 'delete' ? 'Schedule deletion' : action === 'deactivate' ? 'Deactivate' : 'Activate', style: action === 'activate' ? 'default' : 'destructive', onPress: () => {
                if (!visible() || !ops.canConfirm(confirmation, userManagementScope(settings)) || !latest.current.snapshot?.access.canWrite) return
                const operation = ops.beginWrite(); setBusy(true); setError(''); setNotice(''); publishBoundary()
                void changeManagedUser(settings, current.access, user.id, action, operation.controller.signal).then(receipt => {
                    if (!ops.current(operation.generation) || operation.controller.signal.aborted) return
                    setNotice(receipt.action === 'delete' ? `Deletion scheduled for ${new Date(receipt.deletionScheduledAt!).toLocaleString()}.` : receipt.active ? 'Account activated.' : 'Account deactivated; access tokens revoked.')
                }).catch(cause => {
                    if (!ops.current(operation.generation)) return
                    setError(message(cause)); ops.locked = true
                }).finally(() => {
                    if (!ops.current(operation.generation)) return
                    ops.endWrite(); setBusy(false); publishBoundary()
                    if (!ops.locked) void refresh(false)
                })
            } }
        ])
    }
    async function openOrganization(org: UserOrganization) {
        const ops = operations.current
        if (!usable() || busy) return
        const read = ops.beginRead(false); setBusy(true); publishBoundary()
        try {
            const fresh = await loadUserManagement(settings, read.controller.signal)
            if (!ops.current(read.ticket.generation) || read.controller.signal.aborted) return
            setSnapshot(fresh)
            if (!mayOpenUserOrganization(settings, fresh, org)) throw new UserManagementError('This organization is not available through your current active memberships.')
            onSelectOrganization(org.id)
        } catch (cause) { if (ops.current(read.ticket.generation)) setError(message(cause)) }
        finally { if (ops.current(read.ticket.generation)) setBusy(false) }
    }
    const user = snapshot?.users.find(user => user.id === selected)
    const rows = visibleManagedUsers(snapshot?.users || [], query, showReserved)
    return <Screen title='Users' subtitle='Account administration' right={<PillButton key={`refresh:${boundary}`} small label='Refresh users' disabled={busy} onPress={() => { if (usable()) void refresh(true) }} />}>
        <InlineNotice message={error} /><InlineNotice tone='success' message={notice} />
        {operations.current.locked && <InlineNotice message='Changes are locked. Refresh users manually and review the account before another action.' />}
        {busy && <Text style={{ color: theme.textMuted }}>Loading…</Text>}
        {snapshot && <View style={{ flexDirection: 'row', gap: 8 }}>
            <StatChip label='Registered accounts' value={String(snapshot.users.length)} />
            <StatChip label='Reserved placeholders' value={String(snapshot.users.filter(isReservedUser).length)} />
        </View>}
        {user && snapshot ? <UserManagementDetail settings={settings} user={user} snapshot={snapshot} profile={profile} profileError={profileError}
            boundary={boundary} busy={busy} disabled={busy || operations.current.locked || !snapshot.access.canWrite}
            onBack={() => { if (usable() && !busy) { operations.current.invalidate(); operations.current.selection = ''; setSelected(''); setProfile(null); publishBoundary() } }}
            onAction={review} onOrganization={org => void openOrganization(org)} /> : <>
            <View key={`directory:${boundary}`} style={{ gap: 10 }}>
                <LabeledInput label='Search loaded users' value={query} onChangeText={value => { if (usable()) { setQuery(value); setShown(30) } }} autoCapitalize='none' autoCorrect={false} placeholder='Name, username, account ID or email' />
                <PillButton label={showReserved ? 'Hide reserved placeholders' : 'Show reserved placeholders'} disabled={busy} onPress={() => { if (usable()) { setShowReserved(!showReserved); setShown(30) } }} />
            </View>
            {snapshot && <Text style={{ color: theme.textMuted }}>{Math.min(shown, rows.length)} shown of {rows.length} matching loaded accounts · Name order</Text>}
            {rows.slice(0, shown).map(user => <GlassCard key={user.id} style={{ gap: 8 }}>
                <Text style={{ color: theme.text, fontWeight: '600' }}>{user.name} · @{user.username}</Text>
                <Text style={{ color: theme.textMuted }}>{user.email || 'Email not available'} · {user.active ? 'Active' : 'Inactive'} · {user.organizations.length} organizations</Text>
                <PillButton label={`Open ${user.username}`} disabled={busy} onPress={() => void select(user)} />
            </GlassCard>)}
            {snapshot && !rows.length && <Text style={{ color: theme.textMuted }}>No loaded accounts match these filters.</Text>}
            {rows.length > shown && <PillButton label='Show 30 more users' disabled={busy} onPress={() => { if (usable()) setShown(shown + 30) }} />}
        </>}
    </Screen>
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : 'Users is unavailable. Refresh and review before continuing.' }
