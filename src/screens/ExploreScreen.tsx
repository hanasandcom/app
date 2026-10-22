import { useMemo } from 'react'
import { Linking, Pressable, Text, View } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import type { AppSettings } from '../types'
import { GlassCard, Screen, SectionTitle } from '../components/ui'
import { spacing } from '../theme/tokens'
import { useAppTheme } from '../theme/context'

const groups = [
    { title: 'Workspace', routes: [['Dashboard', '/dashboard'], ['AI workspace', '/ai'], ['Mail', '/mail'], ['Organizations', '/organizations']] },
    { title: 'Content and media', routes: [['Notes', '/notes'], ['Gallery', '/gallery'], ['Upload', '/upload'], ['Articles', '/content/articles'], ['Thoughts', '/content/thoughts']] },
    { title: 'Security and intelligence', routes: [['Cases', '/cases'], ['Threat search', '/ti'], ['Watchlists', '/watchlists'], ['Findings', '/findings'], ['Sandbox', '/sandbox'], ['Password check', '/pwned']] },
    { title: 'Infrastructure', routes: [['System', '/system'], ['Containers', '/system/containers'], ['Virtual machines', '/vms'], ['Traffic', '/traffic'], ['Logs', '/logs'], ['Vulnerabilities', '/vulnerabilities'], ['Database', '/db']] },
    { title: 'Automation and account', routes: [['Health checks', '/automation/health'], ['Cron jobs', '/automation/cron'], ['Profile', '/profile'], ['Security', '/profile/security'], ['Sessions', '/profile/sessions'], ['SSH keys', '/profile/ssh-keys'], ['Support', '/support'], ['Subscription', '/subscription'], ['API documentation', '/api']] },
    { title: 'Organization', routes: [['Organization overview', '/organizations'], ['Team', '/organizations/team'], ['Organization settings', '/organizations/settings'], ['Events and cases', '/organizations/events'], ['Organization activity', '/organizations/activity']] },
] as const

export function ExploreScreen({ settings }: { settings: AppSettings }) {
    const theme = useAppTheme()
    const styles = useMemo(() => ({
        route: { minHeight: 46, justifyContent: 'center' as const, borderRadius: 14, borderWidth: 1, borderColor: theme.surfaceBorderSoft, backgroundColor: theme.ambientNeutral, paddingHorizontal: 13, paddingVertical: 10 },
        label: { color: theme.text, fontWeight: '700' as const, fontSize: 13 },
        group: { gap: spacing.sm, marginTop: spacing.md },
        routes: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm, marginTop: spacing.sm },
    }), [theme])

    async function open(path: string) {
        const url = `${settings.siteBaseUrl.replace(/\/+$/, '')}${path === '/profile' ? `/profile/${encodeURIComponent(settings.userId)}` : path}`
        try {
            await WebBrowser.openBrowserAsync(url, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN })
        } catch {
            await Linking.openURL(url)
        }
    }

    return <Screen title='Explore Hanasand' subtitle='Website sections and workspace tools'>
        {groups.map(group => <GlassCard key={group.title} style={styles.group}>
            <SectionTitle eyebrow='Hanasand' title={group.title} />
            <View style={styles.routes}>{group.routes.map(([label, path]) => <Pressable key={path} accessibilityRole='link' onPress={() => void open(path)} style={({ pressed }) => [styles.route, pressed && { opacity: 0.7 }]}>
                <Text style={styles.label}>{label}</Text>
            </Pressable>)}</View>
        </GlassCard>)}
    </Screen>
}
