import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, AppState, Switch, Text, TextInput, View } from 'react-native'
import { useIsFocused } from '@react-navigation/native'
import type { AppSettings } from '../types'
import { GlassCard, InlineNotice, PillButton, Screen, SectionTitle } from '../components/ui'
import { useAppTheme } from '../theme/context'
import { deleteBlocklistEntry, filterBlocklist, listBlocklist, saveBlocklistEntry, type BlocklistDraft, type BlocklistEntry, type BlocklistType } from '../lib/blocklist'

const emptyDraft = (): BlocklistDraft => ({ type: 'ip', value: '', is_vpn: false, is_proxy: false, is_tor: false })

export function TrafficBlocklistScreen({ settings }: { settings: AppSettings }) {
    const key = JSON.stringify([settings.userId, settings.cdnBaseUrl, !!settings.impersonationToken, !!settings.impersonatingUserId])
    return <TrafficBlocklistWorkspace key={key} settings={settings} />
}

function TrafficBlocklistWorkspace({ settings }: { settings: AppSettings }) {
    const theme = useAppTheme(), focused = useIsFocused()
    const [foreground, setForeground] = useState(AppState.currentState === 'active')
    const [entries, setEntries] = useState<BlocklistEntry[] | null>(null)
    const [loading, setLoading] = useState(false)
    const [query, setQuery] = useState(''), [filterType, setFilterType] = useState<'all' | BlocklistType>('all')
    const [editing, setEditing] = useState<BlocklistEntry | null>(null), [editorOpen, setEditorOpen] = useState(false)
    const [draft, setDraft] = useState<BlocklistDraft>(emptyDraft)
    const [saving, setSaving] = useState(false), [needsRefresh, setNeedsRefresh] = useState(false)
    const [error, setError] = useState(''), [notice, setNotice] = useState('')
    const epoch = useRef(0), read = useRef<AbortController | null>(null)
    const visible = useMemo(() => filterBlocklist(entries || [], query, filterType), [entries, query, filterType])
    const meta = { color: theme.textMuted, fontSize: 13, lineHeight: 19 }
    const row = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 }

    useEffect(() => {
        const subscription = AppState.addEventListener('change', state => {
            if (state !== 'active') { epoch.current++; read.current?.abort() }
            setForeground(state === 'active')
        })
        return () => subscription.remove()
    }, [])
    useEffect(() => {
        if (!focused || !foreground) { epoch.current++; read.current?.abort(); return }
        const controller = new AbortController(), generation = ++epoch.current
        read.current = controller
        setLoading(true); setError('')
        void listBlocklist(settings, controller.signal).then(value => {
            if (controller.signal.aborted || generation !== epoch.current) return
            setEntries(value)
        }).catch(reason => {
            if (controller.signal.aborted || generation !== epoch.current) return
            setError(reason instanceof Error ? reason.message : 'Unable to load the traffic blocklist.')
        }).finally(() => {
            if (!controller.signal.aborted && generation === epoch.current) setLoading(false)
        })
        return () => { controller.abort(); epoch.current++ }
    }, [focused, foreground, settings])

    function beginCreate() {
        setEditing(null); setDraft(emptyDraft()); setError(''); setNotice(''); setEditorOpen(true)
    }
    function beginEdit(entry: BlocklistEntry) {
        setEditing(entry)
        setDraft({ type: entry.type, value: entry.value, is_vpn: entry.is_vpn, is_proxy: entry.is_proxy, is_tor: entry.is_tor })
        setError(''); setNotice(''); setEditorOpen(true)
    }
    function closeEditor() { if (!saving) { setEditorOpen(false); setEditing(null); setDraft(emptyDraft()) } }
    async function refreshAfterWrite(successMessage: string) {
        try {
            const value = await listBlocklist(settings)
            setEntries(value); setNeedsRefresh(false); setError(''); setNotice(successMessage)
            setEditorOpen(false); setEditing(null); setDraft(emptyDraft())
        } catch (reason) {
            setNeedsRefresh(true)
            setError(reason instanceof Error ? reason.message : 'The change may have been saved. Refresh to check before trying again.')
        }
    }
    async function save() {
        if (saving || needsRefresh || !entries) return
        setSaving(true); setError(''); setNotice('')
        try {
            const result = await saveBlocklistEntry(settings, draft, editing || undefined)
            if (result.kind === 'duplicate') { setError('That blocklist entry already exists.'); return }
            await refreshAfterWrite(editing ? 'Blocklist entry updated.' : 'Blocklist entry added.')
        } catch (reason) {
            setNeedsRefresh(true)
            setError(reason instanceof Error ? reason.message : 'The change result is unknown. Refresh before trying again.')
        } finally { setSaving(false) }
    }
    async function remove(entry: BlocklistEntry) {
        if (saving || needsRefresh) return
        setSaving(true); setError(''); setNotice('')
        try {
            await deleteBlocklistEntry(settings, entry.id)
            await refreshAfterWrite('Blocklist entry deleted.')
        } catch (reason) {
            setNeedsRefresh(true)
            setError(reason instanceof Error ? reason.message : 'The change result is unknown. Refresh before trying again.')
        } finally { setSaving(false) }
    }
    function confirmRemove(entry: BlocklistEntry) {
        Alert.alert('Delete blocklist entry?', 'This removes the rule from production traffic controls and may affect access immediately.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete rule', style: 'destructive', onPress: () => void remove(entry) },
        ])
    }
    async function manualRefresh() {
        if (loading || saving) return
        setLoading(true); setError(''); setNotice('')
        try {
            const value = await listBlocklist(settings)
            setEntries(value); setNeedsRefresh(false); setNotice('Blocklist refreshed.')
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Unable to refresh the traffic blocklist.')
        } finally { setLoading(false) }
    }

    return <Screen title='Traffic blocklist' subtitle='Global traffic controls · requires system admin' right={<PillButton small label={loading ? 'Loading…' : 'Refresh'} disabled={loading || saving} onPress={() => { void manualRefresh() }} />}>
        {!!error && !editorOpen && <InlineNotice title={needsRefresh ? 'Review required' : undefined} message={error} />}
        {!!notice && <InlineNotice message={notice} tone='success' />}
        {needsRefresh && <Text style={meta}>Refresh the list to check the result before making another change.</Text>}

        <GlassCard style={{ gap: 12 }}>
            <SectionTitle eyebrow='Production rules' title={!entries ? 'Blocklist' : entries.length === 100 ? '100 latest entries' : `${entries.length} entries`} body='The CDN service applies these rules to global traffic.' />
            <TextInput accessibilityLabel='Search blocklist' placeholder='Search value or location' placeholderTextColor={theme.textMuted} value={query} onChangeText={setQuery} autoCapitalize='none' autoCorrect={false} style={{ color: theme.text, borderWidth: 1, borderColor: theme.surfaceBorderSoft, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11 }} />
            <View style={row}>{([['all', 'All'], ['ip', 'IP addresses'], ['user_agent', 'User agents']] as const).map(([value, label]) => <PillButton key={value} small label={label} tone={filterType === value ? 'accent' : 'default'} onPress={() => setFilterType(value)} />)}</View>
            <View style={row}><PillButton label='Add rule' disabled={!entries || saving || needsRefresh} onPress={beginCreate} /></View>
        </GlassCard>

        {editorOpen && <GlassCard style={{ gap: 12 }}>
            <SectionTitle eyebrow={editing ? 'Edit rule' : 'New rule'} title={editing ? 'Update blocklist entry' : 'Add a blocklist entry'} body={editing ? 'Changes apply to global production traffic after you save.' : 'A new rule is added to global production traffic after you save.'} />
            <Text style={meta}>Rule type</Text>
            <View style={row}>{(['ip', 'user_agent'] as const).map(value => <PillButton key={value} small label={value === 'ip' ? 'IP address' : 'User agent'} tone={draft.type === value ? 'accent' : 'default'} disabled={saving} onPress={() => setDraft(current => ({ ...current, type: value }))} />)}</View>
            <Text style={meta}>Value</Text>
            <TextInput accessibilityLabel='Blocklist value' value={draft.value} onChangeText={value => setDraft(current => ({ ...current, value }))} autoCapitalize='none' autoCorrect={false} maxLength={2048} multiline={draft.type === 'user_agent'} textAlignVertical={draft.type === 'user_agent' ? 'top' : 'center'} style={{ minHeight: draft.type === 'user_agent' ? 84 : 46, color: theme.text, borderWidth: 1, borderColor: theme.surfaceBorderSoft, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11 }} />
            {editing && <View style={{ gap: 8 }}><Text style={meta}>Traffic signals</Text>
                {([['is_vpn', 'VPN'], ['is_proxy', 'Proxy'], ['is_tor', 'Tor']] as const).map(([field, label]) => <View key={field} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}><Text style={{ color: theme.text }}>{label}</Text><Switch accessibilityLabel={`${label} signal`} value={draft[field]} disabled={saving} onValueChange={value => setDraft(current => ({ ...current, [field]: value }))} /> </View>)}
            </View>}
            {!!error && <InlineNotice message={error} />}
            <View style={row}><PillButton label={saving ? 'Saving…' : editing ? 'Save changes' : 'Add to blocklist'} tone='accent' disabled={saving || needsRefresh} onPress={() => { void save() }} /><PillButton label='Cancel' small disabled={saving} onPress={closeEditor} /></View>
        </GlassCard>}

        {loading && !entries && <Text accessibilityRole='progressbar' style={meta}>Loading traffic blocklist…</Text>}
        {!loading && !entries && <GlassCard style={{ gap: 10 }}><Text style={meta}>Blocklist entries are unavailable. Refresh to try again.</Text></GlassCard>}
        {entries && <GlassCard style={{ gap: 12 }}><SectionTitle eyebrow='Entries' title={`${visible.length} shown`} />
            {!visible.length && <Text style={meta}>{entries.length ? 'No entries match this search.' : 'No blocklist entries. Add an IP address or user agent to block.'}</Text>}
            {visible.map(entry => {
                const location = [entry.location.city, entry.location.region, entry.location.country].filter(Boolean).join(', ')
                const signals = [entry.is_vpn && 'VPN', entry.is_proxy && 'Proxy', entry.is_tor && 'Tor', entry.is_relay && 'Relay'].filter(Boolean).join(' · ')
                return <View key={entry.id} style={{ gap: 8, paddingVertical: 12, borderBottomWidth: 1, borderColor: theme.surfaceBorderSoft }}>
                    <Text style={{ color: theme.textMuted, fontSize: 12, fontWeight: '700' }}>{entry.type === 'ip' ? 'IP ADDRESS' : 'USER AGENT'}</Text>
                    <Text selectable style={{ color: theme.text, fontSize: 15, lineHeight: 21 }}>{entry.value}</Text>
                    {!!signals && <Text style={meta}>{signals}</Text>}
                    {!!location && <Text style={meta}>{location}</Text>}
                    <View style={row}><PillButton small label='Edit' disabled={saving || needsRefresh} onPress={() => beginEdit(entry)} /><PillButton small tone='danger' label='Delete' disabled={saving || needsRefresh} onPress={() => confirmRemove(entry)} /></View>
                </View>
            })}
        </GlassCard>}
    </Screen>
}
