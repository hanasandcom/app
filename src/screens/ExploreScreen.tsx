import { useMemo, useState, type ReactNode } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { ChevronDown, ChevronRight, ExternalLink, Settings2 } from 'lucide-react-native'
import type { AppSettings } from '../types'
import { Screen } from '../components/ui'
import { siteNavigation, toggleNavigationGroup, type NavigationAccess, type SiteNavigationItem } from '../data/site-navigation'
import { useAppTheme } from '../theme/context'

export function ExploreScreen({ settings, access, onOpen, onOpenSettings }: { settings: AppSettings; access?: Omit<NavigationAccess, 'id'>; onOpen: (item: SiteNavigationItem) => void; onOpenSettings: () => void }) {
    const theme = useAppTheme()
    const [search, setSearch] = useState('')
    const [expanded, setExpanded] = useState<Record<string, boolean>>({ Workspace: true, Communication: true, Content: true, Organization: true, Account: true, Automation: true })
    const groups = useMemo(() => siteNavigation(settings.userId, access), [settings.userId, access])
    const query = search.trim().toLowerCase()
    const hasMatch = !query || groups.some(function contains(item: SiteNavigationItem): boolean {
        return item.label.toLowerCase().includes(query) || !!item.items?.some(contains)
    })

    function rows(items: SiteNavigationItem[], parents: string[] = [], depth = 0): ReactNode {
        return items.map(item => {
            const key = [...parents, item.label].join('/')
            if (item.items) {
                const contains = (entry: SiteNavigationItem): boolean => entry.label.toLowerCase().includes(query) || !!entry.items?.some(contains)
                if (query && !contains(item)) return null
                const open = query || expanded[key]
                return <View key={key} style={{ marginTop: depth === 0 ? 10 : 1 }}>
                    <Pressable accessibilityRole='button' accessibilityLabel={`${item.label} section`} accessibilityState={{ expanded: !!open }} onPress={() => setExpanded(current => toggleNavigationGroup(current, key, !!open))} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 12 + depth * 10, gap: 8 }}>
                        {open ? <ChevronDown size={16} color={theme.textMuted} /> : <ChevronRight size={16} color={theme.textMuted} />}
                        <Text style={{ flex: 1, color: depth ? theme.textMuted : theme.text, fontSize: depth ? 13 : 15, fontWeight: '700' }}>{item.label}</Text>
                    </Pressable>
                    {!!open && rows(item.items, [...parents, item.label], depth + 1)}
                </View>
            }
            if (query && !item.label.toLowerCase().includes(query) && !parents.some(parent => parent.toLowerCase().includes(query))) return null
            return <Pressable key={key} accessibilityRole='button' accessibilityLabel={`${item.label}${item.opensWebsite ? ', opens website' : ''}`} onPress={() => onOpen(item)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 10, paddingVertical: 13, paddingLeft: 14 + Math.min(depth, 2) * 12, paddingRight: 12, borderRadius: 12, backgroundColor: pressed ? theme.accentSoft : 'transparent' })}>
                <Text style={{ flex: 1, color: theme.text, fontSize: 14 }}>{item.label}</Text>
                {item.opensWebsite ? <ExternalLink size={13} color={theme.textSoft} /> : <ChevronRight size={14} color={theme.textSoft} />}
            </Pressable>
        })
    }

    return <Screen title='Menu'>
        <Pressable accessibilityRole='button' accessibilityLabel='App settings' onPress={onOpenSettings} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, borderWidth: 1, borderColor: theme.surfaceBorderSoft, backgroundColor: pressed ? theme.accentSoft : theme.backgroundAlt, paddingHorizontal: 16, paddingVertical: 16 })}>
            <Settings2 color={theme.text} size={20} strokeWidth={2} />
            <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>App settings</Text>
                <Text style={{ color: theme.textMuted, fontSize: 13, marginTop: 3 }}>Theme, workspace, and app preferences</Text>
            </View>
            <ChevronRight size={18} color={theme.textSoft} />
        </Pressable>
        <TextInput value={search} onChangeText={setSearch} autoCorrect={false} autoCapitalize='none' placeholder='Find a page' placeholderTextColor={theme.textSoft} accessibilityLabel='Search navigation' style={{ color: theme.text, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 16, borderWidth: 1, borderColor: theme.surfaceBorderSoft, backgroundColor: theme.backgroundRaised }} />
        <View style={{ borderRadius: 18, borderWidth: 1, borderColor: theme.surfaceBorderSoft, backgroundColor: theme.backgroundAlt, paddingBottom: 10 }}>
            {hasMatch ? rows(groups) : <Text style={{ color: theme.textMuted, padding: 18, textAlign: 'center' }}>No pages match “{search.trim()}”. Try another name.</Text>}
        </View>
    </Screen>
}
