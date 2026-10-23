import { caseWebsitePath, monitoredActorsWebsitePath, type WebsiteCaseRef } from './lib/workspace-links'
import { useEffect, useRef, useState } from 'react'
import { NavigationContainer, DarkTheme, useNavigationContainerRef } from '@react-navigation/native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { Alert, AppState, Platform, Pressable, Text, View } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import { StatusBar } from 'expo-status-bar'
import * as SystemUI from 'expo-system-ui'
import { AlarmClockCheck, Bot, Compass, Images, Mail, ScanLine, StickyNote, UserRound } from 'lucide-react-native'
import type { AiChatMessage, AppSettings, RootTabParamList } from './types'
import { SettingsDrawer } from './components/SettingsDrawer'
import { WorkspacePicker } from './components/WorkspacePicker'
import { SettingsDrawerProvider } from './components/ui'
import { HomeScreen } from './screens/HomeScreen'
import { LoginScreen } from './screens/LoginScreen'
import { MailScreen } from './screens/MailScreen'
import { ScannerScreen } from './screens/ScannerScreen'
import { ImagesScreen } from './screens/ImagesScreen'
import { ExploreScreen } from './screens/ExploreScreen'
import { NotesScreen } from './screens/NotesScreen'
import { ProfileScreen } from './screens/ProfileScreen'
import { PendingDeletionScreen } from './screens/PendingDeletionScreen'
import { AutomationsScreen } from './screens/AutomationsScreen'
import { OrganizationsScreen } from './screens/OrganizationsScreen'
import { WatchlistsScreen } from './screens/WatchlistsScreen'
import { WorkspacePageScreen } from './screens/WorkspacePageScreen'
import { NativeToolsScreen } from './screens/NativeToolsScreen'
import { nativeToolForPath } from './lib/native-tool-navigation'
import { organizationSectionForPath } from './lib/organization-navigation'
import { fetchOrganizations, type Organization } from './lib/profile-api'
import type { SiteNavigationItem } from './data/site-navigation'
import { loadAiChat, loadSettings, saveAiChat, saveSettings } from './lib/storage'
import { getThemePalette, palette } from './theme/tokens'
import { AppThemeProvider } from './theme/context'
import { PendingDeletionError, refreshHanasandSession, startDesktopAgentCoverTraffic, stopDesktopAgentCoverTraffic, stopMobileImpersonation } from './lib/api'
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
    Explore: Compass,
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
    const navigation = useNavigationContainerRef<RootTabParamList>()
    const [settings, setSettings] = useState<AppSettings | null>(null)
    const currentSettings = useRef(settings)
    currentSettings.current = settings
    const returningToOwnView = useRef<AbortController | null>(null)
    const [returnPending, setReturnPending] = useState(false)
    const [bootstrapError, setBootstrapError] = useState('')
    const [bootstrapAttempt, setBootstrapAttempt] = useState(0)
    const [aiMessages, setAiMessages] = useState<AiChatMessage[]>([])
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [workspaceOpen, setWorkspaceOpen] = useState(false)
    const [organizations, setOrganizations] = useState<Organization[]>([])
    const [organizationError, setOrganizationError] = useState('')
    const [organizationRevision, setOrganizationRevision] = useState(0)
    const [pendingDeletion, setPendingDeletion] = useState<{ id: string, restoreToken: string, deletionScheduledAt: string } | null>(null)

    useEffect(() => {
        let active = true
        void (async () => {
            setBootstrapError('')
            try {
                const [nextSettings, nextAiMessages] = await Promise.all([
                    loadSettings(),
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
        if (!settings?.authToken || !settings.userId) { setOrganizations([]); return }
        let active = true
        setOrganizationError('')
        void fetchOrganizations(settings).then(async items => {
            if (!active) return
            const available = items.filter(item => !item.lifecycleStatus || item.lifecycleStatus === 'active')
            setOrganizations(available)
            if (!settings.selectedOrganizationId || (settings.selectedOrganizationId !== 'personal' && !available.some(item => item.id === settings.selectedOrganizationId))) {
                const preferred = available.find(item => item.slug?.toLowerCase() === 'hanasand') || (available.length === 1 ? available[0] : null)
                const next = { ...settings, selectedOrganizationId: preferred?.id || 'personal' }
                await saveSettings(next)
                if (active) setSettings(next)
            }
        }).catch(error => { if (active) setOrganizationError(error instanceof Error ? error.message : 'Unable to load organizations.') })
        return () => { active = false }
    }, [settings?.apiBaseUrl, settings?.userId, settings?.authToken, organizationRevision])

    async function selectWorkspace(id: string) {
        if (!settings) return
        try {
            await handleSaveSettings({ ...settings, selectedOrganizationId: id || 'personal' })
            setWorkspaceOpen(false)
        } catch (error) {
            setOrganizationError(error instanceof Error ? error.message : 'Unable to save the workspace selection.')
        }
    }

    function openWebsite(path: string) {
        if (!settings) return
        void WebBrowser.openBrowserAsync(`${settings.siteBaseUrl.replace(/\/+$/, '')}${path}`)
            .catch(error => Alert.alert('Unable to open page', String(error)))
    }
    function openCase(ref: WebsiteCaseRef) {
        try { openWebsite(caseWebsitePath(ref)) }
        catch (error) { Alert.alert('Unable to open case', String(error)) }
    }
    function openMonitoredActors(id: string) {
        try { openWebsite(monitoredActorsWebsitePath(id)) }
        catch (error) { Alert.alert('Unable to open actors', String(error)) }
    }
    function openPage(item: SiteNavigationItem) {
        if (!navigation.isReady()) return
        if (item.disabledReason && item.path) {
            void WebBrowser.openBrowserAsync(`${settings!.siteBaseUrl.replace(/\/+$/, '')}${item.path}`).catch(error => Alert.alert('Unable to open page', String(error)))
            return
        }
        switch (item.tab) {
            case 'Home': navigation.navigate('Home'); break
            case 'Profile': {
                const section = item.label === 'SSH Keys' ? 'SSH keys' : item.path === '/support' || item.label === 'Tickets' ? 'Support' : ['Security', 'Sessions'].includes(item.label) ? item.label as 'Security' | 'Sessions' : 'Profile'
                navigation.navigate('Profile', { section })
                break
            }
            case 'Mail': navigation.navigate('Mail'); break
            case 'Notes': navigation.navigate('Notes'); break
            case 'Images': navigation.navigate('Images'); break
            case 'Organizations': navigation.navigate('Organizations', { section: organizationSectionForPath(item.path) }); break
            case 'Watchlists': navigation.navigate('Watchlists'); break
            case 'Automations': navigation.navigate('Automations', { section: item.path === '/automation/health' ? 'health' : 'cron' }); break
            case 'Tools': {
                const tool = nativeToolForPath(item.path)
                if (tool) navigation.navigate('Tools', { tool })
                break
            }
            case 'Scan': navigation.navigate('Scan'); break
            default: if (item.path) navigation.navigate('WorkspacePage', { path: item.path, title: item.label })
        }
    }

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

    async function returnToOwnView() {
        const before = currentSettings.current
        if (!before || !before.impersonationToken && !before.impersonatingUserId || returningToOwnView.current) return
        const controller = new AbortController()
        returningToOwnView.current = controller; setReturnPending(true)
        const sameSession = () => {
            const current = currentSettings.current
            return current?.apiBaseUrl === before.apiBaseUrl && current.userId === before.userId
                && current.authToken === before.authToken && current.impersonationToken === before.impersonationToken
        }
        try {
            let revoked = true
            try { await stopMobileImpersonation(before, controller.signal) } catch { revoked = false }
            if (!sameSession()) return
            const next = { ...currentSettings.current!, impersonationToken: '', impersonatingUserId: '', impersonatingUserName: '' }
            await saveSettings(next)
            if (!sameSession()) return
            currentSettings.current = next; setSettings(next)
            if (!revoked) Alert.alert('Returned to your account', 'The delegated token was removed from this device. The server could not confirm its revocation.')
        } catch {
            if (sameSession()) Alert.alert('Unable to return to your account', 'Your account settings could not be saved securely. Try again.')
        } finally {
            if (returningToOwnView.current === controller) { returningToOwnView.current = null; setReturnPending(false) }
        }
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

    const activeOrganization = organizations.find(item => item.id === settings.selectedOrganizationId)
    const hanasandMembership = organizations.find(item => item.slug?.toLowerCase() === 'hanasand')
    const internalAccess = !!hanasandMembership
    const navigationAccess = {
        canViewInternalPages: internalAccess,
        canManageOrganizations: !!hanasandMembership && ['owner', 'admin', 'editor'].includes(hanasandMembership.role || ''),
        hasContentOrganization: !!activeOrganization,
        hasHanasandOrganization: internalAccess,
        hasVMs: true,
        canReviewIntel: internalAccess,
    }

    return (
        <GestureHandlerRootView style={{ flex: 1, backgroundColor: activePalette.background }}>
            <StatusBar style='light' />
            <AppThemeProvider mode={settings.themeMode}>
                <SettingsDrawerProvider openSettings={() => setSettingsOpen(true)} openMenu={() => navigation.navigate('Explore')} openWorkspace={() => setWorkspaceOpen(true)} workspaceName={activeOrganization?.name || 'Personal'}>
                    <NavigationContainer
                        ref={navigation}
                        linking={{
                            prefixes: ['hanasand://'],
                            config: {
                                screens: {
                                    Home: 'home',
                                    Profile: 'profile',
                                    Mail: 'mail',
                                    Scan: 'scan',
                                    Notes: 'notes',
                                    Images: 'images',
                                    Explore: 'explore',
                                    Organizations: 'organizations',
                                    Watchlists: 'watchlists',
                                    Automations: 'automations',
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
                                tabBarShowLabel: true,
                                tabBarLabel: route.name === 'Explore' ? 'Menu' : route.name === 'Home' ? 'AI' : route.name,
                                tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
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
                                    ...(!['Home', 'Mail', 'Notes', 'Images', 'Explore'].includes(route.name) ? { display: 'none' as const } : {}),
                                },
                                tabBarIcon: ({ color, focused }) => {
                                    const Icon = tabIcons[route.name as keyof typeof tabIcons] || Compass
                                    return <Icon color={color} size={focused ? 22 : 20} strokeWidth={2.1} />
                                },
                                sceneStyle: { backgroundColor: activePalette.background },
                            })}
                        >
                            <Tab.Screen name='Home'>
                                {() => <HomeScreen settings={settings} aiMessages={aiMessages} onSaveAiMessages={handleSaveAiMessages} />}
                            </Tab.Screen>
                            <Tab.Screen name='Profile'>
                                {({ route }) => <ProfileScreen settings={settings} initialSection={route.params?.section} onLogout={clearSession} onDeleted={clearSession} />}
                            </Tab.Screen>
                            <Tab.Screen name='Mail'>
                                {() => <MailScreen settings={settings} />}
                            </Tab.Screen>
                            <Tab.Screen name='Scan' component={ScannerScreen} />
                            <Tab.Screen name='Notes'>
                                {() => <NotesScreen settings={settings} />}
                            </Tab.Screen>
                            <Tab.Screen name='Images'>{() => <ImagesScreen settings={settings} />}</Tab.Screen>
                            <Tab.Screen name='Automations'>
                                {({ route }) => <AutomationsScreen settings={settings} section={route.params?.section} />}
                            </Tab.Screen>
                            <Tab.Screen name='Explore'>
                                {() => <ExploreScreen settings={settings} access={navigationAccess} onOpen={openPage} />}
                            </Tab.Screen>
                            <Tab.Screen name='Organizations'>
                                {({ route }) => <OrganizationsScreen initialSection={route.params?.section} settings={settings} selectedOrganizationId={activeOrganization?.id} onSelectOrganization={id => void selectWorkspace(id)} />}
                            </Tab.Screen>
                            <Tab.Screen name='Watchlists'>
                                {() => <WatchlistsScreen settings={settings} />}
                            </Tab.Screen>
                            <Tab.Screen name='WorkspacePage'>
                                {({ route }) => <WorkspacePageScreen key={`${route.params.path}:${settings.selectedOrganizationId}`} settings={settings} path={route.params.path} title={route.params.title} />}
                            </Tab.Screen>
                            <Tab.Screen name='Tools'>
                                {({ route }) => <NativeToolsScreen settings={settings} tool={route.params.tool} initialQuery={route.params.query} onManageSshKeys={() => navigation.navigate('Profile', { section: 'SSH keys' })}
                                    onSelectOrganization={id => void selectWorkspace(id)}
                                    onConfigureDelivery={() => navigation.navigate('Tools', { tool: 'integrations' })}
                                    onOpenCase={openCase}
                                    onViewAiLogs={name => openWebsite(`/logs?service=${encodeURIComponent(name)}`)}
                                    onOpenActor={name => navigation.navigate('Tools', { tool: 'threat-search', query: name })}
                                    onOpenMonitoredActors={openMonitoredActors}
                                    onOpenApiJson={() => navigation.navigate('Tools', { tool: 'openapi-json' })}
                                    onOpenGuide={() => openWebsite('/developers')} />}
                            </Tab.Screen>
                        </Tab.Navigator>
                        {!!(settings.impersonatingUserId || settings.impersonationToken) && (
                            <View style={{ position: 'absolute', left: 14, right: 14, bottom: Platform.OS === 'ios' ? 100 : 86, borderRadius: 18, borderWidth: 1, borderColor: activePalette.surfaceBorder, backgroundColor: activePalette.backgroundAlt, paddingHorizontal: 14, paddingVertical: 10 }}>
                                <Pressable disabled={returnPending} accessibilityState={{ busy: returnPending }} onPress={() => void returnToOwnView()} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                                    <Text style={{ color: activePalette.text, fontWeight: '700', flex: 1 }} numberOfLines={2}>Impersonating {settings.impersonatingUserName || settings.impersonatingUserId || 'another account'}</Text>
                                    <Text style={{ color: activePalette.accent, fontWeight: '800' }}>{returnPending ? 'Returning…' : 'Return to own view'}</Text>
                                </Pressable>
                            </View>
                        )}
                    </NavigationContainer>
                    <WorkspacePicker open={workspaceOpen} organizations={organizations} selectedId={settings.selectedOrganizationId || 'personal'} error={organizationError} onClose={() => setWorkspaceOpen(false)} onSelect={id => void selectWorkspace(id)} onRetry={() => setOrganizationRevision(value => value + 1)} onManage={() => { setWorkspaceOpen(false); navigation.navigate('Organizations', { section: 'Overview' }) }} />
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
