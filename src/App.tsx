import { useEffect, useState } from 'react'
import { NavigationContainer, DarkTheme } from '@react-navigation/native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { Alert, AppState, Platform, Pressable, Text, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import * as SystemUI from 'expo-system-ui'
import { AlarmClockCheck, Bot, Images, Mail, ScanLine, SlidersHorizontal, StickyNote, UserRound } from 'lucide-react-native'
import type { AiChatMessage, AppSettings, AuthenticatorEntry, RootTabParamList, SavedMailboxConnection } from './types'
import { SettingsDrawer } from './components/SettingsDrawer'
import { SettingsDrawerProvider } from './components/ui'
import { HomeScreen } from './screens/HomeScreen'
import { LoginScreen } from './screens/LoginScreen'
import { MailScreen } from './screens/MailScreen'
import { ScannerScreen } from './screens/ScannerScreen'
import { ImagesScreen } from './screens/ImagesScreen'
import { ControlScreen } from './screens/ControlScreen'
import { NotesScreen } from './screens/NotesScreen'
import { ProfileScreen } from './screens/ProfileScreen'
import { PendingDeletionScreen } from './screens/PendingDeletionScreen'
import { AutomationsScreen } from './screens/AutomationsScreen'
import { loadAiChat, loadAuthenticatorEntries, loadMailboxConnections, loadSettings, saveAiChat, saveAuthenticatorEntries, saveMailboxConnections, saveSettings } from './lib/storage'
import { getThemePalette, palette } from './theme/tokens'
import { AppThemeProvider } from './theme/context'
import { PendingDeletionError, refreshHanasandSession, startDesktopAgentCoverTraffic, startMobileImpersonation, stopDesktopAgentCoverTraffic, stopMobileImpersonation } from './lib/api'
import { classifyRefreshFailure } from './lib/session'

const Tab = createBottomTabNavigator<RootTabParamList>()

const tabIcons = {
    Home: Bot,
    Profile: UserRound,
    Mail: Mail,
    Scan: ScanLine,
    Notes: StickyNote,
    Images: Images,
    Automations: AlarmClockCheck,
    Control: SlidersHorizontal,
} as const

void SystemUI.setBackgroundColorAsync(palette.background)

async function safeLoad<T>(loader: () => Promise<T>, fallback: T) {
    try {
        return await loader()
    } catch {
        return fallback
    }
}

export default function App() {
    const [settings, setSettings] = useState<AppSettings | null>(null)
    const [bootstrapError, setBootstrapError] = useState('')
    const [bootstrapAttempt, setBootstrapAttempt] = useState(0)
    const [mailboxConnections, setMailboxConnections] = useState<SavedMailboxConnection[]>([])
    const [authenticatorEntries, setAuthenticatorEntries] = useState<AuthenticatorEntry[]>([])
    const [aiMessages, setAiMessages] = useState<AiChatMessage[]>([])
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [pendingDeletion, setPendingDeletion] = useState<{ id: string, restoreToken: string, deletionScheduledAt: string } | null>(null)

    useEffect(() => {
        let active = true
        void (async () => {
            setBootstrapError('')
            try {
                const [nextSettings, nextMailboxConnections, nextAuthenticatorEntries, nextAiMessages] = await Promise.all([
                    loadSettings(),
                    safeLoad(loadMailboxConnections, [] as SavedMailboxConnection[]),
                    loadAuthenticatorEntries(),
                    safeLoad(loadAiChat, [] as AiChatMessage[]),
                ])
                let hydratedSettings = nextSettings
                if (nextSettings.authToken && nextSettings.userId) {
                    try {
                        const session = await refreshHanasandSession(nextSettings)
                        hydratedSettings = {
                            ...nextSettings,
                            authToken: session.token,
                            userId: session.id,
                        }
                        await saveSettings(hydratedSettings)
                    } catch (error) {
                        const disposition = classifyRefreshFailure(error)
                        if (disposition === 'pending-deletion' && error instanceof PendingDeletionError) {
                            setPendingDeletion({
                                id: error.id,
                                restoreToken: error.restoreToken,
                                deletionScheduledAt: error.deletionScheduledAt,
                            })
                            hydratedSettings = { ...nextSettings, authToken: '', userId: '' }
                            await saveSettings(hydratedSettings)
                        } else if (disposition === 'clear-session') {
                            hydratedSettings = { ...nextSettings, authToken: '', userId: '' }
                            await saveSettings(hydratedSettings)
                        }
                        // Network, server, and invalid-response failures keep the cached session.
                    }
                }
                if (!active) return
                if (AppState.currentState === 'active') startDesktopAgentCoverTraffic(hydratedSettings)
                setSettings(hydratedSettings)
                setMailboxConnections(nextMailboxConnections)
                setAuthenticatorEntries(nextAuthenticatorEntries)
                setAiMessages(nextAiMessages)
            } catch (error) {
                if (active) setBootstrapError(error instanceof Error ? error.message : 'Secure local data could not be loaded.')
            }
        })()
        return () => { active = false }
    }, [bootstrapAttempt])

    useEffect(() => {
        if (!settings) return
        void SystemUI.setBackgroundColorAsync(getThemePalette(settings.themeMode).background)
    }, [settings])

    useEffect(() => {
        if (!settings || AppState.currentState !== 'active') {
            stopDesktopAgentCoverTraffic()
        } else {
            startDesktopAgentCoverTraffic(settings)
        }
        const subscription = AppState.addEventListener('change', state => {
            if (state === 'active' && settings) startDesktopAgentCoverTraffic(settings)
            else stopDesktopAgentCoverTraffic()
        })
        return () => {
            subscription.remove()
            stopDesktopAgentCoverTraffic()
        }
    }, [settings])

    async function handleSaveSettings(next: AppSettings) {
        await saveSettings(next)
        setSettings(next)
    }

    async function handleSaveMailboxConnections(next: SavedMailboxConnection[]) {
        await saveMailboxConnections(next)
        setMailboxConnections(next)
    }

    async function handleSaveAuthenticatorEntries(next: AuthenticatorEntry[]) {
        await saveAuthenticatorEntries(next)
        setAuthenticatorEntries(next)
    }

    async function handleSaveAiMessages(next: AiChatMessage[]) {
        await saveAiChat(next)
        setAiMessages(next)
    }

    async function handleAuthenticated(session: { id: string; token: string }) {
        const next = {
            ...settings!,
            authToken: session.token,
            userId: session.id,
            impersonationToken: '',
            impersonatingUserId: '',
            impersonatingUserName: '',
        }
        await saveSettings(next)
        setSettings(next)
    }

    async function clearSession() {
        const next = {
            ...settings!,
            authToken: '',
            userId: '',
            impersonationToken: '',
            impersonatingUserId: '',
            impersonatingUserName: '',
        }
        await saveSettings(next)
        setSettings(next)
    }

    async function handleImpersonate(user: { id: string; name?: string }) {
        try {
            const session = await startMobileImpersonation(settings!, user.id)
            const next = {
                ...settings!,
                impersonationToken: session.token,
                impersonatingUserId: session.targetId,
                impersonatingUserName: session.targetName,
            }
            await saveSettings(next)
            setSettings(next)
        } catch (error) {
            console.warn(error)
            Alert.alert('Impersonation failed', error instanceof Error ? error.message : 'Unable to start impersonation.')
        }
    }

    async function returnToOwnView() {
        await stopMobileImpersonation(settings!)
        const next = {
            ...settings!,
            impersonationToken: '',
            impersonatingUserId: '',
            impersonatingUserName: '',
        }
        await saveSettings(next)
        setSettings(next)
    }

    if (!settings && bootstrapError) {
        return (
            <GestureHandlerRootView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: palette.background }}>
                <StatusBar style='light' />
                <Text style={{ color: palette.text, fontSize: 17, fontWeight: '700', textAlign: 'center' }}>Secure local data is unavailable</Text>
                <Text style={{ color: palette.textSoft, marginTop: 10, textAlign: 'center' }}>{bootstrapError}</Text>
                <Pressable onPress={() => setBootstrapAttempt(value => value + 1)} style={{ marginTop: 20, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 14, backgroundColor: palette.accent }}>
                    <Text style={{ color: palette.background, fontWeight: '800' }}>Try again</Text>
                </Pressable>
            </GestureHandlerRootView>
        )
    }

    if (!settings) {
        return (
            <GestureHandlerRootView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.background }}>
                <StatusBar style='light' />
                <Text style={{ color: palette.text }}>Loading Hanasand App...</Text>
            </GestureHandlerRootView>
        )
    }

    const activePalette = getThemePalette(settings.themeMode)

    if (!settings.authToken || !settings.userId) {
        if (pendingDeletion) {
            return (
                <GestureHandlerRootView style={{ flex: 1, backgroundColor: activePalette.background }}>
                    <StatusBar style='light' />
                    <AppThemeProvider mode={settings.themeMode}>
                        <PendingDeletionScreen
                            settings={settings}
                            id={pendingDeletion.id}
                            restoreToken={pendingDeletion.restoreToken}
                            deletionScheduledAt={pendingDeletion.deletionScheduledAt}
                            onRestored={async session => {
                                setPendingDeletion(null)
                                await handleAuthenticated(session)
                            }}
                            onBack={async () => {
                                setPendingDeletion(null)
                                await clearSession()
                            }}
                        />
                    </AppThemeProvider>
                </GestureHandlerRootView>
            )
        }
        return (
            <GestureHandlerRootView style={{ flex: 1, backgroundColor: activePalette.background }}>
                <StatusBar style='light' />
                <AppThemeProvider mode={settings.themeMode}>
                    <LoginScreen
                        settings={settings}
                        onAuthenticated={handleAuthenticated}
                        onPendingDeletion={async details => {
                            setPendingDeletion(details)
                            await clearSession()
                        }}
                    />
                </AppThemeProvider>
            </GestureHandlerRootView>
        )
    }

    return (
        <GestureHandlerRootView style={{ flex: 1, backgroundColor: activePalette.background }}>
            <StatusBar style='light' />
            <AppThemeProvider mode={settings.themeMode}>
                <SettingsDrawerProvider openSettings={() => setSettingsOpen(true)}>
                    <NavigationContainer
                        linking={{
                            prefixes: ['hanasandapp://'],
                            config: {
                                screens: {
                                    Home: 'home',
                                    Profile: 'profile',
                                    Mail: 'mail',
                                    Scan: 'scan',
                                    Notes: 'notes',
                                    Images: 'images',
                                    Control: 'control',
                                },
                            },
                        }}
                        theme={{
                            ...DarkTheme,
                            colors: {
                                ...DarkTheme.colors,
                                background: activePalette.background,
                                card: activePalette.backgroundAlt,
                                text: activePalette.text,
                                border: activePalette.surfaceBorder,
                                primary: activePalette.accent,
                            },
                        }}
                    >
                        <Tab.Navigator
                            initialRouteName='Home'
                            screenOptions={({ route }) => ({
                                headerShown: false,
                                tabBarShowLabel: false,
                                tabBarStyle: {
                                    position: 'absolute',
                                    bottom: 0,
                                    left: 0,
                                    right: 0,
                                    height: Platform.OS === 'ios' ? 92 : 78,
                                    paddingBottom: Platform.OS === 'ios' ? 28 : 12,
                                    paddingTop: 10,
                                    borderTopWidth: 0,
                                    borderTopLeftRadius: 28,
                                    borderTopRightRadius: 28,
                                    backgroundColor: activePalette.backgroundAlt,
                                    borderWidth: 1,
                                    borderColor: activePalette.surfaceBorder,
                                },
                                tabBarActiveTintColor: activePalette.text,
                                tabBarInactiveTintColor: activePalette.textSoft,
                                tabBarItemStyle: {
                                    borderRadius: 18,
                                    marginHorizontal: 2,
                                },
                                tabBarIcon: ({ color, focused }) => {
                                    const Icon = tabIcons[route.name as keyof typeof tabIcons]
                                    return <Icon color={color} size={focused ? 22 : 20} strokeWidth={2.1} />
                                },
                                sceneStyle: { backgroundColor: activePalette.background },
                            })}
                        >
                            <Tab.Screen name='Home'>
                                {() => <HomeScreen settings={settings} aiMessages={aiMessages} onSaveAiMessages={handleSaveAiMessages} />}
                            </Tab.Screen>
                            <Tab.Screen name='Profile'>
                                {() => <ProfileScreen settings={settings} onLogout={clearSession} onDeleted={clearSession} />}
                            </Tab.Screen>
                            <Tab.Screen name='Mail'>
                                {() => <MailScreen settings={settings} mailboxConnections={mailboxConnections} onSaveMailboxConnections={handleSaveMailboxConnections} />}
                            </Tab.Screen>
                            <Tab.Screen name='Scan' component={ScannerScreen} />
                            <Tab.Screen name='Notes'>
                                {() => <NotesScreen settings={settings} />}
                            </Tab.Screen>
                            <Tab.Screen name='Images' component={ImagesScreen} />
                            <Tab.Screen name='Automations'>
                                {() => <AutomationsScreen settings={settings} />}
                            </Tab.Screen>
                            <Tab.Screen name='Control'>
                                {() => <ControlScreen settings={settings} onSaveSettings={handleSaveSettings} onImpersonate={handleImpersonate} authenticatorEntries={authenticatorEntries} onSaveAuthenticatorEntries={handleSaveAuthenticatorEntries} />}
                            </Tab.Screen>
                        </Tab.Navigator>
                        {!!settings.impersonatingUserId && (
                            <View style={{ position: 'absolute', left: 14, right: 14, bottom: Platform.OS === 'ios' ? 100 : 86, borderRadius: 18, borderWidth: 1, borderColor: activePalette.surfaceBorder, backgroundColor: activePalette.backgroundAlt, paddingHorizontal: 14, paddingVertical: 10 }}>
                                <Pressable onPress={() => void returnToOwnView()} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                                    <Text style={{ color: activePalette.text, fontWeight: '700', flex: 1 }} numberOfLines={2}>Impersonating {settings.impersonatingUserName || settings.impersonatingUserId}</Text>
                                    <Text style={{ color: activePalette.accent, fontWeight: '800' }}>Return to own view</Text>
                                </Pressable>
                            </View>
                        )}
                    </NavigationContainer>
                    <SettingsDrawer
                        open={settingsOpen}
                        settings={settings}
                        onClose={() => setSettingsOpen(false)}
                        onSave={async (next) => {
                            await handleSaveSettings(next)
                            setSettingsOpen(false)
                        }}
                    />
                </SettingsDrawerProvider>
            </AppThemeProvider>
        </GestureHandlerRootView>
    )
}
