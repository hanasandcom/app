import { useMemo, useState } from 'react'
import { Alert, Text, View } from 'react-native'
import { LogOut, Trash2 } from 'lucide-react-native'
import type { AppSettings } from '../types'
import { deleteHanasandAccount } from '../lib/api'
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
    }
}
