import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { ArrowLeft, RotateCcw } from 'lucide-react-native'
import type { AppSettings } from '../types'
import { restoreHanasandAccount } from '../lib/api'
import { getThemePalette, spacing, type ThemePalette } from '../theme/tokens'

export function PendingDeletionScreen({
    settings,
    id,
    restoreToken,
    deletionScheduledAt,
    onBack,
    onRestored,
}: {
    settings: AppSettings
    id: string
    restoreToken: string
    deletionScheduledAt: string
    onBack: () => Promise<void>
    onRestored: (session: { id: string, token: string }) => Promise<void>
}) {
    const theme = getThemePalette(settings.themeMode)
    const styles = useMemo(() => createStyles(theme), [theme])
    const [busy, setBusy] = useState(false)
    const [status, setStatus] = useState('')
    const deletionDate = deletionScheduledAt
        ? new Intl.DateTimeFormat('en', { dateStyle: 'full', timeStyle: 'short' }).format(new Date(deletionScheduledAt))
        : 'the scheduled deletion time'

    async function restore() {
        if (busy) return
        setBusy(true)
        setStatus('Restoring')
        try {
            const session = await restoreHanasandAccount(settings, id, restoreToken)
            await onRestored(session)
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Unable to restore account.')
        } finally {
            setBusy(false)
        }
    }

    return (
        <LinearGradient colors={[theme.backgroundRaised, theme.background, '#050605']} locations={[0, 0.58, 1]} style={styles.root}>
            <View style={styles.wrap}>
                <View style={styles.masthead}>
                    <Text style={styles.logo}>Hanasand</Text>
                    <View style={styles.logoRule} />
                </View>
                <View style={styles.card}>
                    <Text style={styles.title}>Account pending deletion</Text>
                    <Text style={styles.body}>@{id} is scheduled to be permanently deleted on {deletionDate}.</Text>
                    {!!status && <Text style={styles.status}>{status}</Text>}
                    <View style={styles.row}>
                        <Pressable onPress={() => void onBack()} style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}>
                            <ArrowLeft color={theme.textMuted} size={16} />
                            <Text style={styles.linkText}>Go back</Text>
                        </Pressable>
                        <Pressable disabled={busy} onPress={() => void restore()} style={({ pressed }) => [styles.primaryButton, busy && styles.disabled, pressed && !busy && styles.pressed]}>
                            <Text style={styles.primaryText}>{busy ? 'Restoring' : 'Restore'}</Text>
                            <RotateCcw color={theme.background} size={16} />
                        </Pressable>
                    </View>
                </View>
            </View>
        </LinearGradient>
    )
}

function createStyles(theme: ThemePalette) {
    return StyleSheet.create({
        root: { flex: 1 },
        wrap: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xl, paddingVertical: 54, gap: 22 },
        masthead: { alignItems: 'center', gap: 14 },
        logo: {
            color: theme.text,
            fontSize: 56,
            lineHeight: 62,
            fontFamily: 'serif',
            fontWeight: '700',
        },
        logoRule: { width: 48, height: 1, backgroundColor: `${theme.text}33` },
        card: {
            gap: 14,
            borderRadius: 26,
            borderWidth: 1,
            borderColor: theme.surfaceBorder,
            backgroundColor: `${theme.surface}dd`,
            padding: 14,
        },
        title: { color: theme.text, fontSize: 20, fontWeight: '800' },
        body: { color: theme.textMuted, fontSize: 14, fontWeight: '700', lineHeight: 22 },
        status: { color: theme.textMuted, fontSize: 13, fontWeight: '800' },
        row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 2 },
        linkButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 6 },
        linkText: { color: theme.textMuted, fontSize: 13, fontWeight: '800' },
        primaryButton: { marginLeft: 'auto', minHeight: 44, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.text, paddingHorizontal: 16 },
        primaryText: { color: theme.background, fontSize: 14, fontWeight: '900' },
        disabled: { opacity: 0.58 },
        pressed: { opacity: 0.9, transform: [{ scale: 0.985 }] },
    })
}
