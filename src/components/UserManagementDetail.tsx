import { useState } from 'react'
import { Image, Text, View } from 'react-native'
import type { AppSettings } from '../types'
import { GlassCard, InlineNotice, PillButton, SectionTitle } from './ui'
import { useAppTheme } from '../theme/context'
import { managedAvatarUrl, managedProfileUrl, mayOpenUserOrganization, type ManagedProfile, type ManagedUser, type UserAction, type UserOrganization, type UserSnapshot } from '../lib/user-management'

export function UserManagementDetail({ settings, user, snapshot, profile, profileError, busy, disabled, boundary, onAction, onOrganization, onBack }: {
    settings: AppSettings; user: ManagedUser; snapshot: UserSnapshot; profile: ManagedProfile | null; profileError: string
    busy: boolean; disabled: boolean; boundary: number; onAction: (action: UserAction) => void
    onOrganization: (organization: UserOrganization) => void; onBack: () => void
}) {
    const [failedAvatar, setFailedAvatar] = useState('')
    const avatar = user.active ? managedAvatarUrl(settings, profile?.avatar || user.avatar) : null
    const theme = useAppTheme(), meta = { color: theme.textMuted, lineHeight: 21 }
    let profileLink: string | null = null
    try { profileLink = managedProfileUrl(settings, user.username) } catch { /* Invalid custom sites cannot produce a safe profile link. */ }
    return <View key={`user-detail:${boundary}:${user.id}`} style={{ gap: 12 }}>
        <PillButton label='Back to users' disabled={busy} onPress={onBack} />
        <GlassCard style={{ gap: 10 }}>
            {avatar && failedAvatar !== avatar ? <Image source={{ uri: avatar }} accessibilityLabel={`${user.username} avatar`} style={{ width: 72, height: 72, borderRadius: 36 }} onError={() => setFailedAvatar(avatar)} /> : <Text style={{ color: theme.accentAlt, fontSize: 26 }}>{(user.name || user.username).trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()}</Text>}
            <SectionTitle eyebrow={user.active ? 'Active account' : 'Inactive account'} title={user.name || user.username} body={`@${user.username}`} />
            <Text selectable style={meta}>Account ID: {user.id}</Text>
            <Text selectable style={meta}>Email: {user.email || 'Not available'}</Text>
            <Text style={meta}>Created: {when(user.createdAt)}{'\n'}Last login: {when(user.lastLoginAt)}{'\n'}Deactivated: {when(user.deactivatedAt)}</Text>
            <Text selectable style={meta}>Profile link: {profileLink || 'Unavailable'}</Text>
            <Text style={meta}>Select the link text to copy.</Text>
        </GlassCard>
        <GlassCard style={{ gap: 10 }}>
            <SectionTitle eyebrow='Profile access' title='Account profile' />
            <InlineNotice message={profileError} />
            {profile ? <>
                <Text style={meta}>{profile.name} · @{profile.username} · {profile.active ? 'Active' : 'Inactive'}</Text>
                {!!profile.deletionScheduledAt && <Text style={meta}>Deletion scheduled: {when(profile.deletionScheduledAt)}</Text>}
            </> : !profileError && <Text style={meta}>{busy ? 'Loading profile…' : 'Profile is not available.'}</Text>}
        </GlassCard>
        <GlassCard style={{ gap: 10 }}>
            <SectionTitle eyebrow={`${user.organizations.length} memberships`} title='Organizations' />
            {!user.organizations.length && <Text style={meta}>No active organization memberships were returned.</Text>}
            {user.organizations.map(org => <View key={org.id} style={{ gap: 6 }}>
                <Text selectable style={meta}>{org.name} · {org.status}</Text>
                {mayOpenUserOrganization(settings, snapshot, org) && <PillButton label={`Open ${org.name}`} disabled={busy} onPress={() => onOrganization(org)} />}
            </View>)}
        </GlassCard>
        <GlassCard style={{ gap: 10 }}>
            <SectionTitle eyebrow='Account administration' title='Actions' />
            {!snapshot.access.canWrite && <Text style={meta}>Changes require verified Hanasand editing access in your own account.</Text>}
            <PillButton label={user.active ? 'Review deactivation' : 'Review activation'} disabled={disabled} onPress={() => onAction(user.active ? 'deactivate' : 'activate')} />
            <PillButton label='Review scheduled deletion' tone='danger' disabled={disabled} onPress={() => onAction('delete')} />
            <PillButton label='Impersonation unavailable' disabled onPress={() => {}} />
            <Text style={meta}>Impersonation requires compatible Core and Identity services.</Text>
        </GlassCard>
    </View>
}
function when(value: string | null) { return value ? new Date(value).toLocaleString() : 'Not recorded' }
