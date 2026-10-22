import { useEffect, useMemo, useState } from 'react'
import { Alert, Text, View } from 'react-native'
import { LogOut, Trash2 } from 'lucide-react-native'
import type { AppSettings } from '../types'
import { deleteHanasandAccount, fetchProfileStats, type MobileProfileStats } from '../lib/api'
import { GlassCard, PillButton, Screen, SectionTitle } from '../components/ui'
import { getThemePalette, spacing, type ThemePalette } from '../theme/tokens'

export function ProfileScreen({
    settings,
    onLogout,
    onDeleted,
}: {
    settings: AppSettings
    onLogout: () => Promise<void>
    onDeleted: () => Promise<void>
}) {
    const theme = getThemePalette(settings.themeMode)
    const styles = useMemo(() => createStyles(theme), [theme])
    const [busy, setBusy] = useState(false)
    const [status, setStatus] = useState('')
    const [stats, setStats] = useState<MobileProfileStats | null>(null)
    const [statsError, setStatsError] = useState('')

    useEffect(() => {
        let active = true
        void fetchProfileStats(settings).then(value => {
            if (active) setStats(value)
        }).catch(error => {
            if (active) setStatsError(error instanceof Error ? error.message : 'Profile details are unavailable.')
        })
        return () => { active = false }
    }, [settings.apiBaseUrl, settings.authToken, settings.userId])

    function confirmDelete() {
        Alert.alert(
            'Delete account?',
            'Your account will be logged out everywhere and scheduled for permanent deletion after 30 days.',
            [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => void deleteAccount() },
            ],
        )
    }

    async function deleteAccount() {
        if (busy) return
        setBusy(true)
        setStatus('Scheduling deletion')
        try {
            await deleteHanasandAccount(settings)
            await onDeleted()
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Unable to delete account.')
        } finally {
            setBusy(false)
        }
    }

    return (
        <Screen title='Profile' subtitle={settings.userId}>
            <GlassCard style={styles.card}>
                <SectionTitle eyebrow='Your Hanasand account' title={settings.userId} body='Your profile, activity and workspace usage across Hanasand.' />
                {stats ? (
                    <View style={styles.statsGrid}>
                        {[
                            ['Organizations', stats.counts.organizations],
                            ['Files', stats.counts.shares],
                            ['Virtual machines', stats.counts.vms],
                            ['Containers', stats.counts.containers],
                            ['Articles', stats.counts.articles],
                            ['Active days this year', new Set(stats.loginDays.map(item => item.day)).size],
                        ].map(([label, value]) => (
                            <View key={String(label)} style={styles.stat}>
                                <Text style={styles.statValue}>{Number(value).toLocaleString()}</Text>
                                <Text style={styles.statLabel}>{label}</Text>
                            </View>
                        ))}
                    </View>
                ) : <Text style={styles.meta}>{statsError || 'Loading profile activity…'}</Text>}
                <View style={styles.metaRow}><Text style={styles.meta}>Profile pages, security, sessions, SSH keys and support are available on hanasand.com/profile.</Text></View>
            </GlassCard>
            <GlassCard style={styles.card}>
                <SectionTitle eyebrow='Account' title='Access' body='Manage this app session or schedule deletion.' />
                <View style={styles.row}>
                    <PillButton label='Log out' onPress={() => void onLogout()} />
                    <PillButton label={busy ? 'Scheduling' : 'Delete account'} tone='danger' disabled={busy} onPress={confirmDelete} />
                </View>
                <View style={styles.metaRow}>
                    <LogOut color={theme.textMuted} size={15} />
                    <Text style={styles.meta}>Logout clears this device.</Text>
                </View>
                <View style={styles.metaRow}>
                    <Trash2 color={theme.danger} size={15} />
                    <Text style={styles.meta}>Deletion logs out all devices and keeps a 30 day restore window.</Text>
                </View>
                {!!status && <Text style={styles.status}>{status}</Text>}
            </GlassCard>
        </Screen>
    )
}

function createStyles(theme: ThemePalette) {
    return {
        card: { gap: spacing.md },
        row: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
        metaRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
        meta: { flex: 1, color: theme.textMuted, fontSize: 13, fontWeight: '700' as const, lineHeight: 19 },
        status: { color: theme.textMuted, fontSize: 13, fontWeight: '800' as const },
        statsGrid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
        stat: { minWidth: 100, flexGrow: 1, borderRadius: 16, borderWidth: 1, borderColor: theme.surfaceBorderSoft, backgroundColor: theme.ambientNeutral, padding: 12 },
        statValue: { color: theme.text, fontSize: 20, fontWeight: '800' as const },
        statLabel: { marginTop: 4, color: theme.textMuted, fontSize: 11, fontWeight: '700' as const },
    }
}
