import { useEffect, useState } from 'react'
import { NavigationContainer, DarkTheme } from '@react-navigation/native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { Alert, Platform, Pressable, Text, View } from 'react-native'
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
import { defaultSettings, loadAiChat, loadAuthenticatorEntries, loadMailboxConnections, loadSettings, saveAiChat, saveAuthenticatorEntries, saveMailboxConnections, saveSettings } from './lib/storage'
import { getThemePalette, palette } from './theme/tokens'
import { AppThemeProvider } from './theme/context'
import { PendingDeletionError, refreshHanasandSession, startMobileImpersonation, stopMobileImpersonation } from './lib/api'

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
    const [mailboxConnections, setMailboxConnections] = useState<SavedMailboxConnection[]>([])
    const [authenticatorEntries, setAuthenticatorEntries] = useState<AuthenticatorEntry[]>([])
    const [aiMessages, setAiMessages] = useState<AiChatMessage[]>([])
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [pendingDeletion, setPendingDeletion] = useState<{ id: string, restoreToken: string, deletionScheduledAt: string } | null>(null)

    useEffect(() => {
        void (async () => {
            const [nextSettings, nextMailboxConnections, nextAuthenticatorEntries, nextAiMessages] = await Promise.all([
                safeLoad(loadSettings, defaultSettings),
                safeLoad(loadMailboxConnections, [] as SavedMailboxConnection[]),
                safeLoad(loadAuthenticatorEntries, [] as AuthenticatorEntry[]),
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
                    if (error instanceof PendingDeletionError) {
                        setPendingDeletion({
                            id: error.id,
                            restoreToken: error.restoreToken,
                            deletionScheduledAt: error.deletionScheduledAt,
                        })
                    }
                    hydratedSettings = {
                        ...nextSettings,
                        authToken: '',
                        userId: '',
                    }
                    await saveSettings(hydratedSettings)
                }
            }
            setSettings(hydratedSettings)
            setMailboxConnections(nextMailboxConnections)
            setAuthenticatorEntries(nextAuthenticatorEntries)
            setAiMessages(nextAiMessages)
        })()
    }, [])

    useEffect(() => {
        if (!settings) return
        void SystemUI.setBackgroundColorAsync(getThemePalette(settings.themeMode).background)
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
