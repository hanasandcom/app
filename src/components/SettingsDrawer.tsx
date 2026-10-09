import { useEffect, useMemo, useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions, type KeyboardTypeOptions } from 'react-native'
import { ArrowLeft, CircleDot, Cog, Monitor, Palette, SlidersHorizontal } from 'lucide-react-native'
import type { AppSettings } from '../types'
import { getThemePalette, type ThemeMode, radius, spacing } from '../theme/tokens'

type SettingsSection = 'general' | 'appearance' | 'configuration' | 'personalization'

const sectionItems: Array<{ id: SettingsSection; label: string; icon: typeof Cog }> = [
    { id: 'general', label: 'General', icon: Cog },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'configuration', label: 'Configuration', icon: SlidersHorizontal },
    { id: 'personalization', label: 'Personalization', icon: Monitor },
]

const themeOptions: Array<{ id: ThemeMode; label: string; description: string }> = [
    { id: 'obsidian', label: 'Obsidian', description: 'Warm charcoal and orange contrast.' },
    { id: 'graphite', label: 'Graphite', description: 'Cooler neutral tones for long sessions.' },
    { id: 'forest', label: 'Forest', description: 'Dark green accents with a calmer glow.' },
]

export function SettingsDrawer({
    open,
    settings,
    onClose,
    onSave,
}: {
    open: boolean
    settings: AppSettings
    onClose: () => void
    onSave: (next: AppSettings) => Promise<void> | void
}) {
    const { width } = useWindowDimensions()
    const [section, setSection] = useState<SettingsSection>('general')
    const [draft, setDraft] = useState(settings)
    const [saving, setSaving] = useState(false)
    const compactDrawer = width < 760
    const drawerWidth = compactDrawer ? Math.max(width - 24, 280) : Math.min(width * 0.88, 1040)
    const theme = useMemo(() => getThemePalette(draft.themeMode), [draft.themeMode])

    useEffect(() => {
        if (open) {
            setDraft(settings)
        }
    }, [open, settings])

    function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
        setDraft(current => ({ ...current, [key]: value }))
    }

    async function handleSave() {
        if (saving) return
        setSaving(true)
        try {
            await onSave(draft)
        } catch (cause) {
            Alert.alert('Save failed', cause instanceof Error ? cause.message : 'Settings could not be saved.')
        } finally {
            setSaving(false)
        }
    }

    return (
        <Modal visible={open} animationType='fade' transparent onRequestClose={onClose}>
            <View style={styles.overlay}>
                <Pressable style={styles.backdrop} onPress={onClose} />
                <View style={[styles.drawer, compactDrawer && styles.drawerCompact, { width: drawerWidth, backgroundColor: theme.backgroundAlt, borderColor: theme.surfaceBorder }]}>
                    <View style={[
                        styles.sidebar,
                        compactDrawer && styles.sidebarCompact,
                        { backgroundColor: 'rgba(255,255,255,0.035)', borderRightColor: theme.surfaceBorderSoft, borderBottomColor: theme.surfaceBorderSoft },
                    ]}>
                        <Pressable onPress={onClose} style={({ pressed }) => [styles.backRow, pressed && styles.pressed]}>
                            <ArrowLeft color={theme.textSoft} size={18} strokeWidth={2} />
                            <Text style={[styles.backLabel, { color: theme.textSoft }]}>Back to app</Text>
                        </Pressable>
                        <View style={[{ gap: 8 }, compactDrawer && styles.navCompact]}>
                            {sectionItems.map(item => {
                                const Icon = item.icon
                                const active = section === item.id
                                return (
                                    <Pressable
                                        key={item.id}
                                        onPress={() => setSection(item.id)}
                                        style={({ pressed }) => [
                                            styles.navItem,
                                            {
                                                backgroundColor: active ? 'rgba(255,255,255,0.08)' : 'transparent',
                                                borderColor: active ? theme.surfaceBorder : 'transparent',
                                            },
                                            pressed && styles.pressed,
                                        ]}
                                    >
                                        <Icon color={active ? theme.text : theme.textSoft} size={18} strokeWidth={2} />
                                        <Text style={[styles.navLabel, { color: active ? theme.text : theme.textMuted }]}>{item.label}</Text>
                                    </Pressable>
                                )
                            })}
                        </View>
                    </View>
                    <ScrollView contentContainerStyle={[styles.content, compactDrawer && styles.contentCompact]}>
                        {section === 'general' && (
                            <View style={styles.sectionColumn}>
                                <Text style={[styles.sectionTitle, { color: theme.text }]}>General</Text>
                                <Text style={[styles.sectionBody, { color: theme.textMuted }]}>Choose how the desktop app behaves by default.</Text>
                                <Text style={[styles.groupLabel, { color: theme.text }]}>Workspace mode</Text>
                                <View style={styles.modeGrid}>
                                    <ModeCard
                                        active={draft.workspaceMode === 'coding'}
                                        title='For coding'
                                        body='More technical responses and tighter control.'
                                        onPress={() => update('workspaceMode', 'coding')}
                                        theme={theme}
                                    />
                                    <ModeCard
                                        active={draft.workspaceMode === 'daily'}
                                        title='For daily work'
                                        body='Same power, fewer technical details by default.'
                                        onPress={() => update('workspaceMode', 'daily')}
                                        theme={theme}
                                    />
                                </View>
                                <View style={[styles.preferenceCard, { backgroundColor: theme.surface, borderColor: theme.surfaceBorderSoft }]}>
                                    <PreferenceRow
                                        theme={theme}
                                        title='Use desktop agent first'
                                        body='Prefer the local desktop agent when it is reachable.'
                                        value={draft.desktopAgentBaseUrl.startsWith('http')}
                                        onChange={(value) => {
                                            update('desktopAgentBaseUrl', value ? settings.desktopAgentBaseUrl || 'http://localhost:45731' : '')
                                        }}
                                    />
                                    <PreferenceNote
                                        theme={theme}
                                        title='Saving'
                                        body='Changes are staged here and persisted when you press Save.'
                                    />
                                </View>
                            </View>
                        )}

                        {section === 'appearance' && (
                            <View style={styles.sectionColumn}>
                                <Text style={[styles.sectionTitle, { color: theme.text }]}>Appearance</Text>
                                <Text style={[styles.sectionBody, { color: theme.textMuted }]}>Switch the shell palette without changing your content.</Text>
                                <View style={styles.themeStack}>
                                    {themeOptions.map(option => (
                                        <Pressable
                                            key={option.id}
                                            onPress={() => update('themeMode', option.id)}
                                            style={({ pressed }) => [
                                                styles.themeCard,
                                                {
                                                    backgroundColor: option.id === draft.themeMode ? theme.surface : 'rgba(255,255,255,0.03)',
                                                    borderColor: option.id === draft.themeMode ? theme.surfaceBorder : theme.surfaceBorderSoft,
                                                },
                                                pressed && styles.pressed,
                                            ]}
                                        >
                                            <View style={{ flex: 1 }}>
                                                <Text style={[styles.themeTitle, { color: theme.text }]}>{option.label}</Text>
                                                <Text style={[styles.themeBody, { color: theme.textMuted }]}>{option.description}</Text>
                                            </View>
                                            <CircleDot color={option.id === draft.themeMode ? theme.accent : theme.textSoft} size={20} strokeWidth={2} />
                                        </Pressable>
                                    ))}
                                </View>
                            </View>
                        )}

                        {section === 'configuration' && (
                            <View style={styles.sectionColumn}>
                                <Text style={[styles.sectionTitle, { color: theme.text }]}>Configuration</Text>
                                <Text style={[styles.sectionBody, { color: theme.textMuted }]}>Core endpoints for the Hanasand stack. Authentication is handled by your login session.</Text>
                                <SettingsInput theme={theme} label='Site base URL' value={draft.siteBaseUrl} onChangeText={(value) => update('siteBaseUrl', value)} urlInput />
                                <SettingsInput theme={theme} label='API base URL' value={draft.apiBaseUrl} onChangeText={(value) => update('apiBaseUrl', value)} urlInput />
                                <SettingsInput theme={theme} label='CDN API URL' value={draft.cdnBaseUrl} onChangeText={(value) => update('cdnBaseUrl', value)} urlInput />
                                <SettingsInput theme={theme} label='Codex URL' value={draft.codexUrl} onChangeText={(value) => update('codexUrl', value)} urlInput />
                                <SettingsInput theme={theme} label='Codex API path' value={draft.codexApiPath} onChangeText={(value) => update('codexApiPath', value)} autoCapitalize='none' />
                                <SettingsInput theme={theme} label='Desktop agent URL' value={draft.desktopAgentBaseUrl} onChangeText={(value) => update('desktopAgentBaseUrl', value)} urlInput />
                            </View>
                        )}

                        {section === 'personalization' && (
                            <View style={styles.sectionColumn}>
                                <Text style={[styles.sectionTitle, { color: theme.text }]}>Personalization</Text>
                                <Text style={[styles.sectionBody, { color: theme.textMuted }]}>Keep your remote shortcuts and machine-specific tools in one place.</Text>
                                <SettingsInput theme={theme} label='VPN URL scheme' value={draft.vpnUrlScheme} onChangeText={(value) => update('vpnUrlScheme', value)} autoCapitalize='none' />
                                <SettingsInput theme={theme} label='Remote desktop host' value={draft.remoteDesktopHost} onChangeText={(value) => update('remoteDesktopHost', value)} autoCapitalize='none' />
                                <SettingsInput theme={theme} label='Remote desktop user' value={draft.remoteDesktopUser} onChangeText={(value) => update('remoteDesktopUser', value)} autoCapitalize='none' />
                                <SettingsInput theme={theme} label='VNC host' value={draft.vncHost} onChangeText={(value) => update('vncHost', value)} autoCapitalize='none' />
                                <SettingsInput theme={theme} label='Server base URL' value={draft.serverBaseUrl} onChangeText={(value) => update('serverBaseUrl', value)} urlInput />
                                <SettingsInput theme={theme} label='Start path' value={draft.serverStartPath} onChangeText={(value) => update('serverStartPath', value)} autoCapitalize='none' />
                                <SettingsInput theme={theme} label='Stop path' value={draft.serverStopPath} onChangeText={(value) => update('serverStopPath', value)} autoCapitalize='none' />
                                <SettingsInput theme={theme} label='Logs path' value={draft.serverLogsPath} onChangeText={(value) => update('serverLogsPath', value)} autoCapitalize='none' />
                            </View>
                        )}

                        <View style={styles.footerActions}>
                            <Pressable disabled={saving} onPress={onClose} style={({ pressed }) => [styles.secondaryButton, saving && styles.disabled, { borderColor: theme.surfaceBorderSoft, backgroundColor: theme.surfaceStrong }, pressed && !saving && styles.pressed]}>
                                <Text style={[styles.secondaryLabel, { color: theme.text }]}>Close</Text>
                            </Pressable>
                            <Pressable disabled={saving} onPress={() => void handleSave()} style={({ pressed }) => [styles.primaryButton, saving && styles.disabled, { backgroundColor: theme.accentSoft, borderColor: theme.surfaceBorder }, pressed && !saving && styles.pressed]}>
                                <Text style={[styles.primaryLabel, { color: theme.text }]}>{saving ? 'Saving...' : 'Save changes'}</Text>
                            </Pressable>
                        </View>
                    </ScrollView>
                </View>
            </View>
        </Modal>
    )
}

function ModeCard({
    active,
    title,
    body,
    onPress,
    theme,
}: {
    active: boolean
    title: string
    body: string
    onPress: () => void
    theme: ReturnType<typeof getThemePalette>
}) {
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.modeCard,
                {
                    backgroundColor: active ? theme.surface : 'rgba(255,255,255,0.03)',
                    borderColor: active ? theme.surfaceBorder : theme.surfaceBorderSoft,
                },
                pressed && styles.pressed,
            ]}
        >
            <View style={[styles.modePreview, { backgroundColor: 'rgba(0,0,0,0.24)' }]} />
            <Text style={[styles.modeTitle, { color: theme.text }]}>{title}</Text>
            <Text style={[styles.modeBody, { color: theme.textMuted }]}>{body}</Text>
            <CircleDot color={active ? theme.accent : theme.textSoft} size={22} strokeWidth={2} />
        </Pressable>
    )
}

function PreferenceRow({
    title,
    body,
    value,
    onChange,
    theme,
    disabled = false,
}: {
    title: string
    body: string
    value: boolean
    onChange: (value: boolean) => void
    theme: ReturnType<typeof getThemePalette>
    disabled?: boolean
}) {
    return (
        <View style={[styles.preferenceRow, { borderTopColor: theme.surfaceBorderSoft }]}>
            <View style={{ flex: 1, paddingRight: spacing.md }}>
                <Text style={[styles.preferenceTitle, { color: theme.text }]}>{title}</Text>
                <Text style={[styles.preferenceBody, { color: theme.textMuted }]}>{body}</Text>
            </View>
            <Switch value={value} onValueChange={onChange} disabled={disabled} thumbColor={value ? theme.text : theme.textSoft} trackColor={{ false: 'rgba(255,255,255,0.10)', true: theme.accent }} />
        </View>
    )
}

function PreferenceNote({
    title,
    body,
    theme,
}: {
    title: string
    body: string
    theme: ReturnType<typeof getThemePalette>
}) {
    return (
        <View style={[styles.preferenceRow, { borderTopColor: theme.surfaceBorderSoft }]}>
            <View style={{ flex: 1 }}>
                <Text style={[styles.preferenceTitle, { color: theme.text }]}>{title}</Text>
                <Text style={[styles.preferenceBody, { color: theme.textMuted }]}>{body}</Text>
            </View>
        </View>
    )
}

function SettingsInput({
    label,
    value,
    onChangeText,
    theme,
    secureTextEntry = false,
    autoCapitalize = 'sentences',
    urlInput = false,
}: {
    label: string
    value: string
    onChangeText: (value: string) => void
    theme: ReturnType<typeof getThemePalette>
    secureTextEntry?: boolean
    autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters'
    urlInput?: boolean
}) {
    const keyboardType: KeyboardTypeOptions = urlInput ? 'url' : 'default'
    return (
        <View style={{ gap: 8 }}>
            <Text style={[styles.inputLabel, { color: theme.textMuted }]}>{label}</Text>
            <TextInput
                value={value}
                onChangeText={onChangeText}
                placeholderTextColor={theme.textSoft}
                autoCapitalize={urlInput ? 'none' : autoCapitalize}
                autoCorrect={false}
                keyboardType={keyboardType}
                secureTextEntry={secureTextEntry}
                textContentType={secureTextEntry ? 'password' : 'none'}
                style={[
                    styles.input,
                    {
                        color: theme.text,
                        borderColor: theme.surfaceBorderSoft,
                        backgroundColor: theme.surface,
                    },
                ]}
            />
        </View>
    )
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.42)',
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'stretch',
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
    },
    drawer: {
        marginVertical: 24,
        borderRadius: 28,
        borderWidth: 1,
        overflow: 'hidden',
        flexDirection: 'row',
    },
    drawerCompact: {
        marginVertical: 12,
        flexDirection: 'column',
    },
    sidebar: {
        width: 250,
        paddingHorizontal: spacing.md,
        paddingTop: 26,
        paddingBottom: 24,
        borderRightWidth: 1,
        gap: spacing.lg,
    },
    sidebarCompact: {
        width: '100%',
        paddingTop: spacing.md,
        paddingBottom: spacing.md,
        borderRightWidth: 0,
        borderBottomWidth: 1,
        gap: spacing.md,
    },
    backRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 8,
        paddingHorizontal: 10,
    },
    backLabel: {
        fontSize: 15,
        fontWeight: '500',
    },
    navItem: {
        minHeight: 44,
        borderRadius: 14,
        borderWidth: 1,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    navCompact: {
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    navLabel: {
        fontSize: 16,
        fontWeight: '600',
    },
    content: {
        width: 0,
        flexGrow: 1,
        paddingHorizontal: 28,
        paddingVertical: 28,
        gap: spacing.lg,
    },
    contentCompact: {
        width: '100%',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.md,
    },
    sectionColumn: {
        gap: spacing.lg,
    },
    sectionTitle: {
        fontSize: 22,
        fontWeight: '700',
    },
    sectionBody: {
        fontSize: 14,
        lineHeight: 22,
    },
    groupLabel: {
        fontSize: 15,
        fontWeight: '700',
    },
    modeGrid: {
        flexDirection: 'row',
        gap: spacing.md,
        flexWrap: 'wrap',
    },
    modeCard: {
        width: 270,
        borderRadius: radius.lg,
        borderWidth: 1,
        padding: spacing.lg,
        gap: spacing.md,
    },
    modePreview: {
        height: 120,
        borderRadius: 18,
    },
    modeTitle: {
        fontSize: 18,
        fontWeight: '700',
    },
    modeBody: {
        fontSize: 14,
        lineHeight: 21,
    },
    preferenceCard: {
        borderRadius: radius.lg,
        borderWidth: 1,
        overflow: 'hidden',
    },
    preferenceRow: {
        minHeight: 96,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
        borderTopWidth: 1,
    },
    preferenceTitle: {
        fontSize: 17,
        fontWeight: '700',
        marginBottom: 6,
    },
    preferenceBody: {
        fontSize: 14,
        lineHeight: 22,
    },
    themeStack: {
        gap: spacing.md,
    },
    themeCard: {
        minHeight: 86,
        borderRadius: radius.md,
        borderWidth: 1,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
    },
    themeTitle: {
        fontSize: 17,
        fontWeight: '700',
        marginBottom: 4,
    },
    themeBody: {
        fontSize: 14,
        lineHeight: 20,
    },
    inputLabel: {
        fontSize: 13,
        fontWeight: '600',
    },
    input: {
        minHeight: 48,
        borderRadius: radius.md,
        borderWidth: 1,
        paddingHorizontal: 14,
        fontSize: 15,
    },
    footerActions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: spacing.sm,
        paddingTop: spacing.md,
    },
    secondaryButton: {
        minHeight: 44,
        borderRadius: radius.pill,
        borderWidth: 1,
        paddingHorizontal: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    primaryButton: {
        minHeight: 44,
        borderRadius: radius.pill,
        borderWidth: 1,
        paddingHorizontal: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    secondaryLabel: {
        fontSize: 14,
        fontWeight: '600',
    },
    primaryLabel: {
        fontSize: 14,
        fontWeight: '700',
    },
    pressed: {
        opacity: 0.86,
        transform: [{ scale: 0.99 }],
    },
    disabled: {
        opacity: 0.55,
    },
})
