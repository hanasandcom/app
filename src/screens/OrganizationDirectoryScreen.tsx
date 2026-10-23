import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import type { AppSettings } from '../types'
import { GlassCard, InlineNotice, LabeledInput, PillButton, Screen } from '../components/ui'
import { useAppTheme } from '../theme/context'
import {
    canSwitchDirectoryOrganization, directoryRows, directoryScope, directorySorts, DirectoryRequests,
    loadOrganizationDirectory, type DirectoryOrganization, type DirectorySnapshot, type DirectorySort
} from '../lib/organization-directory'

export function OrganizationDirectoryScreen({ settings, onSelectOrganization }: {
    settings: AppSettings
    onSelectOrganization: (id: string) => void
}) {
    return <Directory key={directoryScope(settings)} settings={settings} onSelectOrganization={onSelectOrganization} />
}
function Directory({ settings, onSelectOrganization }: {
    settings: AppSettings
    onSelectOrganization: (id: string) => void
}) {
    const theme = useAppTheme()
    const [snapshot, setSnapshot] = useState<DirectorySnapshot | null>(null)
    const [query, setQuery] = useState('')
    const [sort, setSort] = useState<DirectorySort>('name')
    const [direction, setDirection] = useState<'asc' | 'desc'>('asc')
    const [shown, setShown] = useState(50)
    const [busy, setBusy] = useState(false)
    const [fresh, setFresh] = useState(false)
    const [switchRequested, setSwitchRequested] = useState(false)
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const requests = useRef(new DirectoryRequests())
    const mounted = useRef(true), focused = useRef(true)
    const foreground = useRef(AppState.currentState === 'active')
    const running = useRef(false), requested = useRef(false)
    const visible = () => mounted.current && focused.current && foreground.current
    function hide() {
        requests.current.invalidate()
        running.current = false
        setBusy(false); setFresh(false)
    }
    useFocusEffect(useCallback(() => {
        mounted.current = true; focused.current = true
        if (foreground.current) void refresh()
        return () => { focused.current = false; hide() }
    }, []))
    useEffect(() => {
        mounted.current = true
        const listener = AppState.addEventListener('change', (state) => {
            const returning = !foreground.current && state === 'active'
            foreground.current = state === 'active'
            if (!foreground.current) hide()
            else if (returning && focused.current) void refresh()
        })
        return () => { mounted.current = false; requests.current.invalidate(); listener.remove() }
    }, [])
    async function refresh() {
        if (running.current || !visible()) return
        const operation = requests.current.start()
        running.current = true; requested.current = false
        setBusy(true); setFresh(false); setSwitchRequested(false); setError(''); setNotice('')
        try {
            const value = await loadOrganizationDirectory(settings, operation.controller.signal)
            if (!requests.current.canApply(operation, visible())) return
            setSnapshot(value); setFresh(true)
        } catch (cause) {
            if (requests.current.canApply(operation, visible())) setError(message(cause))
        } finally {
            if (requests.current.finish(operation)) { running.current = false; if (visible()) setBusy(false) }
        }
    }
    async function select(organization: DirectoryOrganization) {
        if (running.current || requested.current || !fresh || !visible() || !snapshot
            || !canSwitchDirectoryOrganization(settings, organization, snapshot.memberships)) return
        const operation = requests.current.start()
        running.current = true; setBusy(true); setFresh(false); setError(''); setNotice('Verifying your current workspace access…')
        try {
            // A global directory entry is never authority to join or switch into that organization.
            const current = await loadOrganizationDirectory(settings, operation.controller.signal)
            if (!requests.current.canApply(operation, visible())) return
            setSnapshot(current); setFresh(true)
            const target = current.organizations.find((item) => item.id === organization.id)
            if (!target || !canSwitchDirectoryOrganization(settings, target, current.memberships))
                throw new Error('This organization is no longer available through your active memberships. Refresh to review access.')
            requested.current = true; setSwitchRequested(true)
            setNotice(`Opening ${target.name}. If the workspace does not change, refresh before another attempt.`)
            onSelectOrganization(target.id)
        } catch (cause) {
            if (requests.current.canApply(operation, visible())) { setFresh(false); setNotice(''); setError(message(cause)) }
        } finally {
            if (requests.current.finish(operation)) { running.current = false; if (visible()) setBusy(false) }
        }
    }
    const organizations = snapshot?.organizations || []
    const rows = directoryRows(organizations, query, sort, direction)
    const displayed = rows.slice(0, shown)
    const impersonating = Boolean(settings.impersonationToken || settings.impersonatingUserId)
    return (
        <Screen title='Organizations' subtitle='Hanasand administration'
            right={<PillButton small label={busy ? 'Loading…' : 'Refresh'} disabled={busy} onPress={() => void refresh()} />}>
            <InlineNotice message={error} />
            <InlineNotice message={notice} tone='info' />
            <GlassCard style={{ gap: 12 }}>
                <Text style={{ color: theme.textMuted }}>
                    The directory lists organizations across Hanasand. You can open only organizations where your account already has an active membership.
                </Text>
                {impersonating && <InlineNotice tone='info' message='Workspace switching is disabled while impersonating. Return to your own account first.' />}
                <LabeledInput label='Search organizations' value={query} onChangeText={(value) => { setQuery(value); setShown(50) }} />
                <Text style={{ color: theme.text, fontWeight: '700' }}>Sort by</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {directorySorts.map((item) => (
                        <PillButton key={item.key} small label={item.label} tone={sort === item.key ? 'accent' : 'default'}
                            onPress={() => { setSort(item.key); setShown(50) }} />
                    ))}
                </View>
                <PillButton small label={direction === 'asc' ? 'Ascending' : 'Descending'}
                    onPress={() => { setDirection(direction === 'asc' ? 'desc' : 'asc'); setShown(50) }} />
                {snapshot && <Text style={{ color: theme.textMuted }}>
                    {displayed.length} of {rows.length} matches shown · {organizations.length} organizations loaded
                </Text>}
                {snapshot && !fresh && <Text style={{ color: theme.textMuted }}>Previous snapshot. Refresh access before switching.</Text>}
                {!snapshot && busy && <Text style={{ color: theme.textMuted }}>Loading organization directory…</Text>}
                {snapshot && !rows.length && <Text style={{ color: theme.textMuted }}>
                    {organizations.length ? 'No organizations match your search.' : 'No organizations found.'}
                </Text>}
            </GlassCard>
            {displayed.map((organization) => {
                const current = settings.selectedOrganizationId === organization.id
                const accessible = snapshot && canSwitchDirectoryOrganization(settings, organization, snapshot.memberships)
                return (
                    <GlassCard key={organization.id} style={{ gap: 8 }}>
                        <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>{organization.name}</Text>
                        <Text selectable style={{ color: theme.textMuted }}>{organization.slug || 'No slug'} · {organization.status}</Text>
                        <Text style={{ color: theme.textMuted }}>Members: {organization.memberCount ?? 'Unavailable'}</Text>
                        <Text style={{ color: theme.textMuted }}>Created: {formatDate(organization.createdAt)}</Text>
                        <Text style={{ color: theme.textMuted }}>Last active: {formatDate(organization.lastActiveAt)}</Text>
                        {current ? <Text style={{ color: theme.text }}>Current workspace</Text>
                            : accessible ? <PillButton label={`Open ${organization.name}`} disabled={busy || !fresh || switchRequested}
                                onPress={() => void select(organization)} />
                                : <Text style={{ color: theme.textMuted }}>
                                    {organization.status !== 'active' ? 'This organization is not active.' : 'No verified active membership for switching.'}
                                </Text>}
                    </GlassCard>
                )
            })}
            {displayed.length < rows.length && <PillButton label='Show 50 more loaded organizations' onPress={() => setShown((value) => value + 50)} />}
        </Screen>
    )
}
function formatDate(value: string | null) {
    return value ? `${new Date(value).toLocaleString(undefined, { timeZone: 'UTC' })} UTC` : 'Not recorded'
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : 'The directory is unavailable. Refresh to try again.' }
