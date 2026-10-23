import { useEffect, useRef, useState } from 'react'
import { AppState, Linking, Text, TextInput, View } from 'react-native'
import { useIsFocused } from '@react-navigation/native'
import type { AppSettings } from '../types'
import { changeSavedThreatSearch, loadSavedThreatSearches, searchThreatIntel, savedSearchMutationOutcome, threatAccountKey, ThreatRefreshBudget, type SavedThreatSearch, type ThreatSearchResult } from '../lib/threat-search'
import { GlassCard, InlineNotice, PillButton, Screen } from '../components/ui'
import { useAppTheme } from '../theme/context'

export function ThreatSearchScreen({ settings, initialQuery = '' }: { settings: AppSettings; initialQuery?: string }) {
    return <AccountThreatSearch key={`${threatAccountKey(settings)}:${initialQuery}`} settings={settings} initialQuery={initialQuery} />
}
function AccountThreatSearch({ settings, initialQuery }: { settings: AppSettings; initialQuery: string }) {
    const theme = useAppTheme()
    const [query, setQuery] = useState(initialQuery)
    const focused = useIsFocused(), [foreground, setForeground] = useState(AppState.currentState === 'active')
    const [result, setResult] = useState<ThreatSearchResult | null>(null)
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const [autoRefreshPaused, setAutoRefreshPaused] = useState(false)
    const [saved, setSaved] = useState<SavedThreatSearch[]>([])
    const [savedError, setSavedError] = useState('')
    const [savedBusy, setSavedBusy] = useState(false)
    const [savedRevision, setSavedRevision] = useState(0)
    const [view, setView] = useState<'activity' | 'sources' | 'techniques' | 'targets'>('activity')
    const [limit, setLimit] = useState(20)
    const lifecycle = useRef(0)
    const active = useRef(focused && foreground)
    active.current = focused && foreground
    const attempt = useRef(0)
    const request = useRef<AbortController | null>(null)
    const mutation = useRef<AbortController | null>(null)
    const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const refreshBudget = useRef(new ThreatRefreshBudget())
    useEffect(() => { active.current = true; return () => { active.current = false; attempt.current += 1; request.current?.abort(); mutation.current?.abort(); refreshBudget.current.cancel(); if (pollTimer.current) clearTimeout(pollTimer.current) } }, [])
    useEffect(() => {
        const listener = AppState.addEventListener('change', state => {
            if (state !== 'active') { active.current = false; pause() }
            setForeground(state === 'active')
        })
        return () => listener.remove()
    }, [])
    useEffect(() => {
        active.current = focused && foreground
        if (!active.current) pause()
        return () => { active.current = false; lifecycle.current++; attempt.current++; request.current?.abort(); mutation.current?.abort(); refreshBudget.current.cancel(); if (pollTimer.current) clearTimeout(pollTimer.current) }
    }, [focused, foreground])
    function pause() {
        lifecycle.current++; attempt.current++; request.current?.abort(); mutation.current?.abort(); refreshBudget.current.cancel()
        if (pollTimer.current) clearTimeout(pollTimer.current)
        setResult(null); setSaved([]); setBusy(false); setSavedBusy(false); setError(''); setSavedError(''); setAutoRefreshPaused(true)
    }
    useEffect(() => {
        if (!focused || !foreground) return
        const controller = new AbortController()
        let current = true
        const timeout = setTimeout(() => controller.abort(), 15000)
        setSavedError('')
        void loadSavedThreatSearches(settings, controller.signal).then(rows => { if (active.current && current && !controller.signal.aborted) setSaved(rows) })
            .catch(() => { if (active.current && current) setSavedError(settings.impersonationToken ? 'Return to your own account to manage saved searches.' : 'Account-saved searches are unavailable. Retry to load them.') })
            .finally(() => clearTimeout(timeout))
        return () => { current = false; controller.abort(); clearTimeout(timeout) }
    }, [savedRevision, focused, foreground])
    function cancel(clear = false) {
        attempt.current += 1; request.current?.abort(); refreshBudget.current.cancel(); setAutoRefreshPaused(true); if (pollTimer.current) clearTimeout(pollTimer.current); setBusy(false)
        if (clear) { setQuery(''); setResult(null); setError('') }
    }
    async function search(value = query, preferCached = true, automatic = false) {
        if (!active.current) return
        if (!automatic) { refreshBudget.current.start(value); setAutoRefreshPaused(false) }
        request.current?.abort()
        if (pollTimer.current) clearTimeout(pollTimer.current)
        const controller = new AbortController()
        request.current = controller
        const id = ++attempt.current
        setQuery(value); setBusy(true); setError('')
        if (!result || result.query.toLowerCase() !== value.trim().toLowerCase()) setResult(null)
        const timeout = setTimeout(() => controller.abort(), 20000)
        try {
            const next = await searchThreatIntel(settings, value, controller.signal, preferCached)
            if (active.current && attempt.current === id && !controller.signal.aborted) { setResult(next); setLimit(20) }
        } catch (cause) {
            if (active.current && attempt.current === id) setError(controller.signal.aborted ? 'Search timed out. Try again.' : cause instanceof Error ? cause.message : 'Threat search is unavailable.')
        } finally { if (active.current && attempt.current === id) setBusy(false); clearTimeout(timeout) }
    }
    useEffect(() => {
        if (!result?.refreshAfterSeconds || ['ready', 'unavailable', 'blocked_unsafe_target'].includes(result.status)) return
        if (!refreshBudget.current.take(result.query)) { setAutoRefreshPaused(true); return }
        pollTimer.current = setTimeout(() => void search(result.query, false, true), result.refreshAfterSeconds * 1000)
        return () => { if (pollTimer.current) clearTimeout(pollTimer.current) }
    }, [result])
    async function changeSaved(value: string, save: boolean) {
        if (savedBusy || !active.current || settings.impersonationToken || settings.impersonatingUserId) return
        const controller = new AbortController(), generation = lifecycle.current
        mutation.current = controller
        const outcome = () => savedSearchMutationOutcome({ visible: active.current, generation, currentGeneration: lifecycle.current, currentRequest: mutation.current === controller, aborted: controller.signal.aborted })
        const unconfirmed = 'The saved-search change could not be confirmed. Refresh saved searches before trying again.'
        const timeout = setTimeout(() => controller.abort(), 15000)
        setSavedBusy(true); setSavedError('')
        try {
            await changeSavedThreatSearch(settings, value, save, controller.signal)
            if (outcome() === 'apply') setSavedRevision(revision => revision + 1)
            else if (outcome() === 'unconfirmed') setSavedError(unconfirmed)
        } catch (cause) { if (outcome() !== 'ignore') setSavedError(controller.signal.aborted ? unconfirmed : cause instanceof Error ? cause.message : unconfirmed) }
        finally { if (active.current && mutation.current === controller) setSavedBusy(false); clearTimeout(timeout) }
    }
    const text = { color: theme.textMuted, fontSize: 14, lineHeight: 21 }
    const heading = { color: theme.text, fontSize: 17, fontWeight: '700' as const }
    const row = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 }
    const evidence = (url: string | null) => url ? <PillButton small label='Open source' onPress={() => { void Linking.openURL(url).catch(() => setError('Unable to open this source.')) }} /> : null
    return <Screen title='Threat search'>
        <GlassCard style={{ gap: 12 }}>
            <TextInput accessibilityLabel='Threat search query' value={query} onChangeText={value => { cancel(); setQuery(value); setResult(null); setError('') }} onSubmitEditing={() => void search()} placeholder='Actor, domain, CVE or organization' placeholderTextColor={theme.textSoft} autoCapitalize='none' autoCorrect={false} maxLength={200} returnKeyType='search' style={{ minHeight: 48, color: theme.text, borderWidth: 1, borderColor: theme.surfaceBorderSoft, borderRadius: 14, paddingHorizontal: 14 }} />
            <View style={row}><PillButton label={busy ? 'Searching…' : 'Search'} tone='accent' disabled={busy || query.trim().length < 2} onPress={() => void search()} /><PillButton label={busy ? 'Cancel' : 'Clear'} onPress={() => cancel(!busy)} /></View>
            {!!error && <InlineNotice message={error} />}
        </GlassCard>
        <GlassCard style={{ gap: 10 }}>
            <Text style={heading}>Saved searches</Text>
            {!!savedError && <InlineNotice message={savedError} />}
            <View style={row}>{saved.map(item => <View key={item.query} style={{ gap: 4 }}><PillButton small label={item.query} onPress={() => void search(item.query)} /><PillButton small label={`Remove ${item.query}`} disabled={savedBusy} onPress={() => void changeSaved(item.query, false)} /></View>)}</View>
            {!saved.length && !savedError && <Text style={text}>Save a search to find it on your account later.</Text>}
            <View style={row}><PillButton small label={savedBusy ? 'Updating…' : 'Save current search'} disabled={savedBusy || !result || busy || !!settings.impersonationToken || !!settings.impersonatingUserId} onPress={() => void changeSaved(result?.query || query, true)} /><PillButton small label='Refresh saved searches' disabled={savedBusy} onPress={() => setSavedRevision(revision => revision + 1)} /></View>
        </GlassCard>
        {result && <>
            <GlassCard style={{ gap: 10 }}>
                <Text accessibilityRole='header' style={heading}>{result.query}</Text>
                <Text style={text}>{result.status.replaceAll('_', ' ')}{result.generatedAt ? ` · ${new Date(result.generatedAt).toLocaleString()}` : ''}</Text>
                {(result.catalogOnly || result.mode === 'seeded') && <InlineNotice message='Catalog identity only. Recent activity evidence is not available for this match.' />}
                {!!result.summary && <Text selectable style={text}>{result.summary}</Text>}
                {!!result.aliases.length && <Text style={text}>Also known as: {result.aliases.join(', ')}</Text>}
                {result.candidates.map((candidate, index) => <View key={`${candidate.name}:${index}`} style={{ gap: 6 }}><Text style={heading}>{candidate.name}</Text><Text selectable style={text}>{candidate.description}</Text>{evidence(candidate.url)}</View>)}
                {result.notes.map((note, index) => <Text selectable key={index} style={text}>{note}</Text>)}
                {autoRefreshPaused && !['ready', 'unavailable', 'blocked_unsafe_target'].includes(result.status) && <Text style={text}>Automatic refresh is paused. Refresh the result to check again.</Text>}
                <PillButton small label='Refresh result' disabled={busy} onPress={() => void search(result.query, false)} />
            </GlassCard>
            <View style={row}>{(['activity', 'sources', 'techniques', 'targets'] as const).map(tab => <PillButton key={tab} small label={`${tab[0].toUpperCase()}${tab.slice(1)} · ${result[tab].length}`} tone={view === tab ? 'accent' : 'default'} onPress={() => { setView(tab); setLimit(20) }} />)}</View>
            <GlassCard style={{ gap: 16 }}>
                {!result[view].length && <Text style={text}>No {view} returned for this result.</Text>}
                {view === 'activity' && result.activity.slice(0, limit).map((item, index) => <View key={index} style={{ gap: 6 }}><Text style={heading}>{item.title}</Text><Text style={text}>{item.date}{item.reviewState ? ` · ${item.reviewState}` : ''}{item.corroboration ? ` · ${item.corroboration}` : ''}</Text><Text selectable style={text}>{item.detail}</Text>{!!item.sourceIds.length && <Text selectable style={text}>Sources: {item.sourceIds.join(', ')}</Text>}{evidence(item.url)}</View>)}
                {view === 'sources' && result.sources.slice(0, limit).map((source, index) => <View key={`${source.id}:${index}`} style={{ gap: 6 }}><Text style={heading}>{source.name || source.id}</Text><Text style={text}>{source.type}{source.collectedAt ? ` · ${source.collectedAt}` : ''}</Text>{!!source.provenance && <Text selectable style={text}>{source.provenance}</Text>}{evidence(source.url)}</View>)}
                {view === 'techniques' && result.techniques.slice(0, limit).map((item, index) => <View key={index} style={{ gap: 6 }}><Text style={heading}>{item.attackId} {item.name}</Text><Text style={text}>{item.tactic}</Text><Text selectable style={text}>{item.detail}</Text>{!!item.sourceIds.length && <Text selectable style={text}>Sources: {item.sourceIds.join(', ')}</Text>}</View>)}
                {view === 'targets' && result.targets.slice(0, limit).map((item, index) => <View key={index} style={{ gap: 6 }}><Text style={heading}>{item.sector}</Text><Text style={text}>{item.regions.join(', ')}</Text><Text selectable style={text}>{item.rationale}</Text></View>)}
                {result[view].length > limit && <PillButton small label='Show 20 more' onPress={() => setLimit(value => value + 20)} />}
            </GlassCard>
        </>}
    </Screen>
}
