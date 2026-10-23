import { useEffect, useMemo, useState } from 'react'
import { useIsFocused } from '@react-navigation/native'
import { Alert, Text, View } from 'react-native'
import type { AppSettings, OrganizationSection } from '../types'
import {
    accountRequest, fetchOrganizations, fetchOrganizationMembers, fetchOrganizationInvites,
    fetchOrganizationSettings, organizationPath, type Organization, type OrganizationInvite,
    type OrganizationMember, type OrganizationSettings,
} from '../lib/profile-api'
import { GlassCard, InlineNotice, LabeledInput, PillButton, Screen, SectionTitle } from '../components/ui'
import { getThemePalette, spacing } from '../theme/tokens'

export type { Organization } from '../lib/profile-api'
const roles = ['owner', 'admin', 'editor', 'reader'] as const

export function OrganizationsScreen({ settings, selectedOrganizationId, onSelectOrganization, initialSection }: {
    settings: AppSettings; selectedOrganizationId?: string; onSelectOrganization?: (id: string) => void; initialSection?: OrganizationSection
}) {
    const theme = getThemePalette(settings.themeMode)
    const styles = useMemo(() => ({
        card: { gap: spacing.md }, row: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
        text: { color: theme.text, fontSize: 15, fontWeight: '700' as const },
        meta: { color: theme.textMuted, fontSize: 13, lineHeight: 19 },
        item: { gap: spacing.sm, borderTopWidth: 1, borderColor: theme.surfaceBorderSoft, paddingTop: spacing.md },
    }), [theme])
    const [organizations, setOrganizations] = useState<Organization[]>([])
    const [selectedId, setSelectedId] = useState(selectedOrganizationId || '')
    const [tab, setTab] = useState<OrganizationSection>(initialSection || 'Overview')
    const focused = useIsFocused()
    useEffect(() => { if (focused) setTab(initialSection || 'Overview') }, [focused, initialSection])
    const [members, setMembers] = useState<OrganizationMember[]>([])
    const [invites, setInvites] = useState<OrganizationInvite[]>([])
    const [draft, setDraft] = useState<OrganizationSettings>({})
    const [savedSettings, setSavedSettings] = useState<OrganizationSettings | null>(null)
    const [loading, setLoading] = useState(false)
    const [detailsLoading, setDetailsLoading] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [detailErrors, setDetailErrors] = useState<string[]>([])
    const [notice, setNotice] = useState('')
    const [revision, setRevision] = useState(0)
    const [createName, setCreateName] = useState('')
    const [creating, setCreating] = useState(false)
    const [inviteEmails, setInviteEmails] = useState('')
    const [inviteRole, setInviteRole] = useState('reader')
    const [editingMemberId, setEditingMemberId] = useState('')
    const selected = organizations.find(item => item.id === selectedId)
    const mayManage = !!selected && ['owner', 'admin'].includes(selected.role?.toLowerCase() || '')

    useEffect(() => { setSelectedId(selectedOrganizationId || '') }, [selectedOrganizationId])
    useEffect(() => {
        let active = true
        setLoading(true); setError('')
        void fetchOrganizations(settings).then(value => {
            if (!active) return
            setOrganizations(value)
            setSelectedId(current => value.some(item => item.id === current) ? current : '')
        }).catch(cause => { if (active) { setError(errorMessage(cause)); setOrganizations([]) } })
            .finally(() => { if (active) setLoading(false) })
        return () => { active = false }
    }, [settings.apiBaseUrl, settings.authToken, settings.userId, settings.impersonationToken, revision])
    useEffect(() => {
        let active = true
        setMembers([]); setInvites([]); setSavedSettings(null); setDraft({}); setDetailErrors([])
        if (!selected) { setDetailsLoading(false); return }
        const id = selected.id
        setDetailsLoading(true)
        const requests = [
            { label: 'Settings', run: async () => { const value = await fetchOrganizationSettings(settings, id); if (active) { setSavedSettings(value); setDraft(value) } } },
            { label: 'Members', run: async () => { const value = await fetchOrganizationMembers(settings, id); if (active) setMembers(value) } },
            ...(mayManage ? [{ label: 'Invites', run: async () => { const value = await fetchOrganizationInvites(settings, id); if (active) setInvites(value) } }] : []),
        ]
        void Promise.allSettled(requests.map(item => item.run())).then(results => {
            if (!active) return
            setDetailErrors(results.flatMap((result, index) => result.status === 'rejected' ? [`${requests[index].label}: ${errorMessage(result.reason)}`] : []))
            setDetailsLoading(false)
        })
        return () => { active = false }
    }, [selected?.id, selected?.role, settings.apiBaseUrl, settings.authToken, settings.userId, settings.impersonationToken, revision])

    function choose(id: string) {
        setSelectedId(id); setNotice(''); setError(''); setInviteEmails(''); setEditingMemberId(''); onSelectOrganization?.(id)
    }
    async function act(work: () => Promise<unknown>, success: string) {
        if (busy) return
        setBusy(true); setError(''); setNotice('')
        try { await work(); setNotice(success); setRevision(value => value + 1) }
        catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) }
    }
    function mutation(suffix: string, method: string, body?: object) {
        if (!selected || !mayManage) return Promise.reject(new Error('An owner or admin role is required.'))
        return accountRequest(settings, organizationPath(selected.id, suffix), { method, ...(body ? { body: JSON.stringify(body) } : {}) }, settings.apiBaseUrl)
    }
    function confirm(title: string, body: string, work: () => Promise<unknown>, success: string) {
        Alert.alert(title, body, [{ text: 'Cancel', style: 'cancel' }, { text: 'Confirm', style: 'destructive', onPress: () => void act(work, success) }])
    }
    async function saveSettings() {
        const retentionDays = Number(draft.retentionDays)
        if (!draft.name?.trim()) throw new Error('Organization name is required.')
        if (draft.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.slug)) throw new Error('Use lowercase letters, numbers and hyphens for the slug.')
        if (!Number.isFinite(retentionDays) || retentionDays < 30 || retentionDays > 2555) throw new Error('Retention days must be between 30 and 2555.')
        await mutation('settings', 'PUT', { ...draft, name: draft.name.trim(), slug: draft.slug?.trim() || '', retentionDays })
    }

    return <Screen title='Organizations' subtitle={selected?.name || 'Your workspaces'} right={<PillButton small label='Refresh' disabled={busy || loading || detailsLoading} onPress={() => setRevision(value => value + 1)} />}>
        <InlineNotice message={error} /><InlineNotice message={notice} tone='success' />
        <GlassCard style={styles.card}>
            <SectionTitle eyebrow='Workspaces' title='Your organizations' body='Select an organization to view its team and settings.' />
            <PillButton label={selectedOrganizationId ? 'Use personal workspace' : 'Personal workspace'} disabled={busy} tone={!selectedOrganizationId ? 'accent' : 'default'} onPress={() => choose('')} />
            {loading && <Text style={styles.meta}>Loading organizations…</Text>}
            {!loading && !error && !organizations.length && <Text style={styles.meta}>You do not belong to an organization yet.</Text>}
            {organizations.map(organization => <View key={organization.id} style={styles.item}>
                <Text style={styles.text}>{organization.name}</Text>
                <Text style={styles.meta}>{[organization.role, organization.status, organization.memberCount === undefined ? '' : `${organization.memberCount} members`].filter(Boolean).join(' · ')}</Text>
                <PillButton label={selectedId === organization.id ? 'Selected workspace' : 'Select workspace'} disabled={busy} tone={selectedId === organization.id ? 'accent' : 'default'} onPress={() => choose(organization.id)} />
            </View>)}
            <PillButton label={creating ? 'Cancel creation' : 'Create organization'} disabled={busy} onPress={() => setCreating(value => !value)} />
            {creating && <>
                <LabeledInput label='Organization name' value={createName} onChangeText={setCreateName} />
                <PillButton label='Create' tone='accent' disabled={busy || !createName.trim()} onPress={() => void act(async () => {
                    const payload = await accountRequest<{ organization?: Organization }>(settings, 'organizations', { method: 'POST', body: JSON.stringify({ name: createName.trim() }) })
                    if (!payload.organization?.id) throw new Error('Organization created, but no organization ID was returned. Refresh to view it.')
                    setCreating(false); setCreateName(''); choose(payload.organization.id)
                }, 'Organization created.')} />
            </>}
        </GlassCard>
        {selected && <>
            <View style={styles.row}>{(['Overview', 'Team', 'Settings'] as const).map(item => <PillButton key={item} label={item} tone={tab === item ? 'accent' : 'default'} onPress={() => setTab(item)} />)}</View>
            {detailsLoading && <Text style={styles.meta}>Loading organization…</Text>}
            {detailErrors.map(item => <InlineNotice key={item} message={item} />)}
            {tab === 'Overview' && <GlassCard style={styles.card}>
                <SectionTitle eyebrow={selected.role || 'Membership'} title={selected.name} body={selected.slug ? `@${selected.slug}` : undefined} />
                <Text selectable style={styles.meta}>{selected.id}</Text>
                <Text style={styles.meta}>Status: {selected.status || 'Active'}</Text>
                {selected.activeMemberCount !== undefined && <Text style={styles.meta}>{selected.activeMemberCount} active members</Text>}
                {selected.pendingInviteCount !== undefined && <Text style={styles.meta}>{selected.pendingInviteCount} pending invites</Text>}
                {selected.sharedWatchlistCount !== undefined && <Text style={styles.meta}>{selected.sharedWatchlistCount} shared watchlists</Text>}
            </GlassCard>}
            {tab === 'Team' && <>
                <GlassCard style={styles.card}>
                    <SectionTitle eyebrow='Team' title='Members' />
                    {!detailsLoading && !detailErrors.some(item => item.startsWith('Members:')) && !members.length && <Text style={styles.meta}>No members found.</Text>}
                    {members.map(member => <View key={member.userId} style={styles.item}>
                        <Text style={styles.text}>{member.name || member.email || member.userId}{member.userId === settings.userId ? ' · You' : ''}</Text>
                        {!!member.email && <Text selectable style={styles.meta}>{member.email}</Text>}
                        <Text style={styles.meta}>{member.role} · {member.status}{member.joinedAt ? ` · Joined ${formatDate(member.joinedAt)}` : ''}</Text>
                        {mayManage && <View style={styles.row}>
                            <PillButton small label='Change role' disabled={busy} onPress={() => setEditingMemberId(current => current === member.userId ? '' : member.userId)} />
                            <PillButton small label='Remove member' tone='danger' disabled={busy} onPress={() => confirm('Remove member?', `Remove ${member.name || member.email || member.userId} from ${selected.name}?`, () => mutation(`members/${encodeURIComponent(member.userId)}`, 'DELETE', { reason: 'Member removed from mobile organization workspace.', requestId: requestId() }), 'Member removed.')} />
                        </View>}
                        {mayManage && editingMemberId === member.userId && <View style={styles.row}>
                            {roles.map(role => <PillButton key={role} small label={role} disabled={busy || role === member.role} onPress={() => void act(async () => {
                                await mutation(`members/${encodeURIComponent(member.userId)}/role`, 'PATCH', { role, reason: 'Role updated from mobile organization workspace.', requestId: requestId() })
                                setEditingMemberId('')
                            }, 'Member role updated.')} />)}
                            <PillButton small label='Cancel' disabled={busy} onPress={() => setEditingMemberId('')} />
                        </View>}
                    </View>)}
                </GlassCard>
                {mayManage && <GlassCard style={styles.card}>
                    <SectionTitle eyebrow='Team' title='Invitations' />
                    <LabeledInput label='Email addresses' value={inviteEmails} onChangeText={setInviteEmails} placeholder='name@example.com' keyboardType='email-address' autoCapitalize='none' autoCorrect={false} multiline />
                    <View style={styles.row}>{roles.map(role => <PillButton small key={role} label={role} tone={inviteRole === role ? 'accent' : 'default'} onPress={() => setInviteRole(role)} />)}</View>
                    <PillButton label='Send invitations' disabled={busy || !inviteEmails.trim()} onPress={() => void act(async () => {
                        const emails = [...new Set(inviteEmails.split(/[,\n]/).map(value => value.trim().toLowerCase()).filter(Boolean))]
                        if (!emails.length || emails.some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error('Enter valid email addresses, separated by commas or new lines.')
                        await mutation('invites', 'POST', { emails, role: inviteRole, requestId: requestId() }); setInviteEmails('')
                    }, 'Invitations sent.')} />
                    {!detailsLoading && !detailErrors.some(item => item.startsWith('Invites:')) && !invites.length && <Text style={styles.meta}>No invitations.</Text>}
                    {invites.map(invite => <View key={invite.id} style={styles.item}>
                        <Text style={styles.text}>{invite.email}</Text><Text style={styles.meta}>{invite.role} · {invite.status}{invite.expiresAt ? ` · Expires ${formatDate(invite.expiresAt)}` : ''}</Text>
                        {invite.status !== 'accepted' && <View style={styles.row}>
                            <PillButton small label='Resend' disabled={busy} onPress={() => void act(() => mutation(`invites/${encodeURIComponent(invite.id)}/actions`, 'POST', { action: 'resend', reason: 'Invite reissued from mobile workspace.', requestId: requestId() }), 'Invitation resent.')} />
                            <PillButton small label='Revoke invitation' tone='danger' disabled={busy || invite.status === 'revoked'} onPress={() => confirm('Revoke invitation?', `Revoke the invitation for ${invite.email}?`, () => mutation(`invites/${encodeURIComponent(invite.id)}/actions`, 'POST', { action: 'revoke', reason: 'Access no longer required.', requestId: requestId() }), 'Invitation revoked.')} />
                        </View>}
                    </View>)}
                </GlassCard>}
            </>}
            {tab === 'Settings' && savedSettings && <GlassCard style={styles.card}>
                <SectionTitle eyebrow='Workspace' title='Organization settings' />
                {mayManage ? <>
                    <LabeledInput label='Name' value={draft.name || ''} onChangeText={name => setDraft(value => ({ ...value, name }))} />
                    <LabeledInput label='Slug' value={draft.slug || ''} onChangeText={slug => setDraft(value => ({ ...value, slug }))} autoCapitalize='none' autoCorrect={false} />
                    <LabeledInput label='Retention days (30–2555)' value={String(draft.retentionDays ?? 365)} onChangeText={retentionDays => setDraft(value => ({ ...value, retentionDays: Number(retentionDays) }))} keyboardType='number-pad' />
                    <Text style={styles.meta}>Webhook policy: {draft.defaultWebhookPolicy || 'active_destinations'}</Text>
                    <Text style={styles.meta}>Alert visibility: {draft.alertVisibilityPolicy || 'members'}</Text>
                    <Text style={styles.meta}>Lifecycle: {draft.lifecycleStatus || 'active'}</Text>
                    <PillButton label='Save settings' tone='accent' disabled={busy || detailsLoading || JSON.stringify(draft) === JSON.stringify(savedSettings)} onPress={() => void act(saveSettings, 'Organization settings updated.')} />
                </> : <>
                    <Text style={styles.meta}>Name: {savedSettings.name || selected.name}</Text><Text style={styles.meta}>Slug: {savedSettings.slug || 'None'}</Text>
                    <Text style={styles.meta}>Retention: {savedSettings.retentionDays ?? 365} days</Text>
                    <Text style={styles.meta}>An owner or admin can change organization settings.</Text>
                </>}
            </GlassCard>}
        </>}
    </Screen>
}
function requestId() { return `org-mobile-${Date.now()}-${Math.random().toString(36).slice(2)}` }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Unable to complete this request.' }
function formatDate(value: string) { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? 'Unknown' : parsed.toLocaleDateString() }
