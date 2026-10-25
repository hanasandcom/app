// Opt-in simulator entry for reviewing the native settings drawer and global theme.
import { useState } from 'react'
import { Text, View } from 'react-native'
import { registerRootComponent } from 'expo'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { SettingsDrawer } from '../src/components/SettingsDrawer'
import { PillButton } from '../src/components/ui'
import { defaultSettings } from '../src/lib/storage'
import type { AppSettings } from '../src/types'
import { AppThemeProvider, useAppTheme } from '../src/theme/context'

function Fixture({ settings, setSettings }: { settings: AppSettings; setSettings: (update: (current: AppSettings) => AppSettings) => void }) {
    const [open, setOpen] = useState(false)
    const theme = useAppTheme()
    return <View style={{ flex: 1, padding: 24, paddingTop: 96, gap: 16, backgroundColor: theme.background }}>
        <Text accessibilityLabel={`App theme ${settings.themeMode}`} style={{ color: theme.text, fontSize: 24, fontWeight: '700' }}>App theme: {settings.themeMode}</Text>
        <Text style={{ color: theme.textMuted }}>Changing Appearance must update this screen too.</Text>
        <PillButton label='Open app settings' onPress={() => setOpen(true)} />
        <SettingsDrawer open={open} settings={settings} onClose={() => setOpen(false)}
            onSave={next => setSettings(() => next)} onThemeChange={themeMode => setSettings(current => ({ ...current, themeMode }))} />
    </View>
}

function AppearanceRoot() {
    const [settings, setSettings] = useState<AppSettings>({ ...defaultSettings, userId: 'synthetic-user', authToken: 'synthetic-token' })
    return <AppThemeProvider mode={settings.themeMode}><Fixture settings={settings} setSettings={setSettings} /></AppThemeProvider>
}

const Stack = createNativeStackNavigator()
registerRootComponent(() => <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider><NavigationContainer><Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name='SyntheticAppearance' component={AppearanceRoot} /></Stack.Navigator></NavigationContainer></SafeAreaProvider></GestureHandlerRootView>)
