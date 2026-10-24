import { useRef, useState } from 'react'
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native'
import { ArrowLeft, RotateCw } from 'lucide-react-native'
import { WebView } from 'react-native-webview'
import type { AppSettings } from '../types'
import { InlineNotice, PillButton, Screen } from '../components/ui'
import { useAppTheme } from '../theme/context'
import { isSandboxFirstPartyNavigation } from '../lib/sandbox-navigation'

export function SandboxScreen({ settings }: { settings: AppSettings }) {
    const key = JSON.stringify([settings.siteBaseUrl, settings.userId, settings.authToken])
    if (!settings.userId || !settings.authToken) return <Screen title='Sandbox' subtitle='Sign in to your Hanasand account'><InlineNotice tone='info' message='Sign in to open the remote browser in the app.' /></Screen>
    return <SandboxViewport key={key} settings={settings} />
}

function SandboxViewport({ settings }: { settings: AppSettings }) {
    const theme = useAppTheme(), web = useRef<WebView>(null)
    const [loading, setLoading] = useState(true), [progress, setProgress] = useState(0), [error, setError] = useState('')
    const siteOrigin = 'https://hanasand.com'
    const initialUrl = `${siteOrigin}/sandbox`
    const cookieBootstrap = `(()=>{try{if(window.location.origin!==${JSON.stringify(siteOrigin)})return;document.cookie='id='+encodeURIComponent(${JSON.stringify(settings.userId)})+'; Path=/; Secure; SameSite=Lax';document.cookie='access_token='+encodeURIComponent(${JSON.stringify(settings.authToken)})+'; Path=/; Secure; SameSite=Lax'}catch(e){window.ReactNativeWebView.postMessage(JSON.stringify({type:'auth_error'}))}})();true;`

    function shouldLoad(request: { url: string; isTopFrame: boolean }) {
        if (request.url === 'about:blank') return true
        let target: URL
        try { target = new URL(request.url) } catch { return false }
        if (target.protocol !== 'https:') return false
        if (!request.isTopFrame) return true
        if (isSandboxFirstPartyNavigation(target.href)) return true
        void Linking.openURL(target.href).catch(() => setError('This link could not be opened.'))
        return false
    }

    return <Screen title='Sandbox' subtitle='Remote browser · Hanasand session' scroll={false} right={<PillButton small label='Reload' onPress={() => { setError(''); setLoading(true); web.current?.reload() }} />} contentStyle={{ flex: 1, paddingBottom: 0 }}>
        <View style={{ flex: 1, minHeight: 320, overflow: 'hidden', borderRadius: 18, borderWidth: 1, borderColor: theme.surfaceBorderSoft, backgroundColor: theme.background }}>
            {loading && <View pointerEvents='none' style={{ position: 'absolute', zIndex: 2, top: 0, left: 0, right: 0, height: 2, backgroundColor: theme.surface }}><View style={{ width: `${Math.max(5, Math.round(progress * 100))}%`, height: 2, backgroundColor: theme.accent }} /></View>}
            {!!error && <View style={{ position: 'absolute', zIndex: 3, top: 8, left: 8, right: 8, padding: 10, borderRadius: 12, backgroundColor: theme.backgroundRaised }}><Text accessibilityRole='alert' style={{ color: theme.danger, fontSize: 13 }}>{error}</Text></View>}
            <WebView
                ref={web}
                source={{ uri: initialUrl }}
                originWhitelist={['https://*']}
                injectedJavaScriptBeforeContentLoaded={cookieBootstrap}
                onShouldStartLoadWithRequest={shouldLoad}
                onLoadStart={() => { setLoading(true); setError('') }}
                onLoadProgress={event => setProgress(event.nativeEvent.progress)}
                onLoadEnd={() => setLoading(false)}
                onError={event => { setLoading(false); setError(event.nativeEvent.description || 'Sandbox could not be loaded. Check your connection and try again.') }}
                onHttpError={event => { if (event.nativeEvent.statusCode >= 400) setError(`Sandbox returned HTTP ${event.nativeEvent.statusCode}.`) }}
                onMessage={event => { if (event.nativeEvent.data.includes('auth_error')) setError('Your app sign-in could not be connected to Sandbox. Sign in again and retry.') }}
                incognito
                cacheEnabled={false}
                sharedCookiesEnabled={false}
                javaScriptEnabled
                domStorageEnabled
                allowsInlineMediaPlayback
                mediaPlaybackRequiresUserAction={false}
                allowFileAccess={false}
                setSupportMultipleWindows={false}
                mixedContentMode='never'
                style={{ flex: 1, backgroundColor: theme.background }}
            />
            {loading && <View pointerEvents='none' style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={theme.accent} /></View>}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 8, borderTopWidth: 1, borderColor: theme.surfaceBorderSoft, backgroundColor: theme.backgroundRaised }}>
                <Pressable accessibilityRole='button' accessibilityLabel='Go back in Sandbox' onPress={() => web.current?.goBack()} style={{ padding: 8 }}><ArrowLeft color={theme.textMuted} size={18} /></Pressable>
                <Text numberOfLines={1} style={{ color: theme.success, fontSize: 12, alignSelf: 'center' }}>🔒 https://hanasand.com</Text>
                <Pressable accessibilityRole='button' accessibilityLabel='Reload Sandbox' onPress={() => web.current?.reload()} style={{ padding: 8 }}><RotateCw color={theme.textMuted} size={18} /></Pressable>
            </View>
        </View>
    </Screen>
}
