import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, AppState, Pressable, Text, TextInput, View } from 'react-native'
import { useIsFocused } from '@react-navigation/native'
import * as WebBrowser from 'expo-web-browser'
import type { AppSettings } from '../types'
import { GlassCard, InlineNotice, PillButton, Screen, SectionTitle } from '../components/ui'
import { loadTiSources, setTiSourceStatus, tiSourcesAccountKey, tiSourcesWebsiteUrl, type TiSourcesPage, type TiSource } from '../lib/ti-sources'
import { useAppTheme } from '../theme/context'

type Snapshot = { page: number; query: string; data: TiSourcesPage | null; loading: boolean; error: string }

export function TiSourcesScreen({ settings }: { settings: AppSettings }) {
    return <TiSourcesWorkspace key={tiSourcesAccountKey(settings)} settings={settings} />
}

function TiSourcesWorkspace({ settings }: { settings: AppSettings }) {
    const theme = useAppTheme(), focused = useIsFocused()
    const [foreground, setForeground] = useState(AppState.currentState === 'active')
    const [page, setPage] = useState(1), [revision, setRevision] = useState(0)
    const [query, setQuery] = useState(''), [activeQuery, setActiveQuery] = useState('')
    const [busyId, setBusyId] = useState(''), [error, setError] = useState('')
    const [snapshot, setSnapshot] = useState<Snapshot>({ page: 1, query: '', data: null, loading: true, error: '' })
    const epoch = useRef(0), read = useRef<AbortController | null>(null), busy = useRef(false)
    const current = snapshot.page === page && snapshot.query === activeQuery ? snapshot : null
    const data = current?.data || null, loading = !current || current.loading

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
        setSnapshot(previous => ({ page, query: activeQuery, data: previous.page === page && previous.query === activeQuery ? previous.data : null, loading: true, error: '' }))
        void loadTiSources(settings, page, activeQuery, controller.signal).then(value => {
            if (!controller.signal.aborted && generation === epoch.current) setSnapshot({ page, query: activeQuery, data: value, loading: false, error: '' })
        }).catch(cause => {
            if (!controller.signal.aborted && generation === epoch.current) setSnapshot(previous => ({ page, query: activeQuery, data: previous.page === page && previous.query === activeQuery ? previous.data : null, loading: false, error: cause instanceof Error ? cause.message : 'The TI source inventory is unavailable.' }))
        })
        return () => { controller.abort(); epoch.current++ }
    }, [focused, foreground, page, activeQuery, revision, settings])

    async function changeStatus(source: TiSource) {
        if (busy.current || source.status === 'unknown') return
        const next = source.status === 'active' ? 'paused' : 'active'
        const action = next === 'paused' ? 'Pause collection' : 'Activate source'
        Alert.alert(`${action}?`, `${source.name} will ${next === 'paused' ? 'stop being collected' : 'be included in scheduled collection'}.`, [
            { text: 'Cancel', style: 'cancel' },
            { text: action, onPress: () => { void applyStatus(source, next) } },
        ])
    }

    async function applyStatus(source: TiSource, next: 'active' | 'paused') {
        if (busy.current) return
        busy.current = true; setBusyId(source.id); setError('')
        try {
            await setTiSourceStatus(settings, source.id, next)
            setRevision(value => value + 1)
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'The source status could not be changed.')
        } finally { busy.current = false; setBusyId('') }
    }

    async function openWebsite(path?: string) {
        try { await WebBrowser.openBrowserAsync(tiSourcesWebsiteUrl(settings, path)) }
        catch { setError('The TI website could not be opened. Try again shortly.') }
    }

    const sources = data?.sources || []
    const nextPage = data?.nextPage || (data && data.page * data.limit < data.total ? data.page + 1 : null)
    return <Screen title='TI sources' subtitle='Global feed inventory · internal access required' right={<PillButton small label={loading ? 'Loading…' : 'Refresh'} disabled={loading} onPress={() => setRevision(value => value + 1)} />}>
        {!!error && <InlineNotice message={error} />}
        {!!current?.error && <InlineNotice message={current.error} />}
        {data && <GlassCard style={{ gap: 12 }}>
            <SectionTitle eyebrow='Source inventory' title={`${data.total.toLocaleString()} feeds`} body={`Page ${data.page} · ${sources.length} shown`} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <PillButton small label='Previous page' disabled={loading || !data.previousPage} onPress={() => { if (data.previousPage) setPage(data.previousPage) }} />
                <PillButton small label='Next page' disabled={loading || !nextPage} onPress={() => { if (nextPage) setPage(nextPage) }} />
            </View>
        </GlassCard>}
        <GlassCard style={{ gap: 10 }}>
            <Text style={{ color: theme.text, fontSize: 15, fontWeight: '700' }}>Find a feed</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <TextInput accessibilityLabel='Search TI sources' value={query} onChangeText={setQuery} onSubmitEditing={() => { setPage(1); setActiveQuery(query.trim()) }} placeholder='Name, domain, or source type' placeholderTextColor={theme.textSoft} returnKeyType='search' style={{ flex: 1, minHeight: 44, borderWidth: 1, borderColor: theme.surfaceBorderSoft, borderRadius: 14, paddingHorizontal: 12, color: theme.text, backgroundColor: theme.backgroundRaised }} />
                <PillButton small label='Search' disabled={loading || query.trim().length > 100} onPress={() => { setPage(1); setActiveQuery(query.trim()) }} />
            </View>
            <PillButton small label='Open full feed controls' onPress={() => void openWebsite()} />
        </GlassCard>
        {!data && loading && <ActivityIndicator accessibilityLabel='Loading TI source inventory' color={theme.accent} />}
        {!data && !loading && <GlassCard><Text style={{ color: theme.textMuted }}>The TI source inventory could not be loaded. Refresh to try again.</Text></GlassCard>}
        {data && <GlassCard style={{ gap: 8 }}>
            <SectionTitle eyebrow='Feeds' title={sources.length ? `${sources.length} on this page` : 'No matching feeds'} body={activeQuery ? `Results for “${activeQuery}”.` : 'Search, check status, and pause or activate collection.'} />
            {!sources.length && <Text style={{ color: theme.textMuted, lineHeight: 20 }}>No sources match this page. Try a different search or move to another page.</Text>}
            {sources.map(source => <SourceCard key={source.id} source={source} busy={busyId === source.id} onStatus={() => void changeStatus(source)} onOpen={() => void openWebsite(`/dashboard/ti/sources/${encodeURIComponent(source.id)}?scope=global`)} />)}
        </GlassCard>}
        {data && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <PillButton small label='Previous page' disabled={loading || !data.previousPage} onPress={() => { if (data.previousPage) setPage(data.previousPage) }} />
            <PillButton small label='Next page' disabled={loading || !nextPage} onPress={() => { if (nextPage) setPage(nextPage) }} />
        </View>}
    </Screen>
}

function SourceCard({ source, busy, onStatus, onOpen }: { source: TiSource; busy: boolean; onStatus: () => void; onOpen: () => void }) {
    const theme = useAppTheme()
    const statusColor = source.status === 'active' ? theme.success : source.status === 'unknown' ? theme.warning : theme.textMuted
    return <View style={{ gap: 7, paddingVertical: 12, borderBottomWidth: 1, borderColor: theme.surfaceBorderSoft }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
            <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontSize: 15, fontWeight: '700' }}>{source.name}</Text>
                <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 2 }}>{source.family.replaceAll('_', ' ')} · {source.accessMethod || source.type}</Text>
            </View>
            <Text style={{ color: statusColor, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }}>{source.status === 'candidate' ? 'Inactive' : source.status}</Text>
        </View>
        <Text style={{ color: theme.textSoft, fontSize: 12 }}>Health: {source.healthState.replaceAll('_', ' ')} · {source.productiveCycleCount.toLocaleString()} useful runs · {source.customerMatchCount.toLocaleString()} matches</Text>
        {!!(source.domain || source.domains.length) && <Text numberOfLines={2} style={{ color: theme.textMuted, fontSize: 12 }}>{[source.domain, ...source.domains].filter((value, index, values) => value && values.indexOf(value) === index).join(' · ')}</Text>}
        {!!source.lastUsefulAt && <Text style={{ color: theme.textSoft, fontSize: 12 }}>Last useful result {formatDate(source.lastUsefulAt)}</Text>}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <PillButton small label={busy ? 'Saving…' : source.status === 'active' ? 'Pause collection' : 'Activate'} disabled={busy || source.status === 'unknown'} onPress={onStatus} />
            <Pressable accessibilityRole='button' accessibilityLabel={`Open full settings for ${source.name} on the TI website`} onPress={onOpen} style={{ minHeight: 38, justifyContent: 'center', paddingHorizontal: 12 }}><Text style={{ color: theme.accentAlt, fontSize: 13, fontWeight: '700' }}>Details</Text></Pressable>
        </View>
    </View>
}

function formatDate(value: string) {
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Oslo' }) : 'not recorded'
}
