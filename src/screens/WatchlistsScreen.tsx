import { useEffect, useRef, useState } from 'react'
import { Alert, Text, View, type ScrollView } from 'react-native'
import { useIsFocused } from '@react-navigation/native'
import type { AppSettings } from '../types'
import { GlassCard, InlineNotice, LabeledInput, PillButton, Screen, SectionTitle } from '../components/ui'
import { useAppTheme } from '../theme/context'
import { changeWatchlists, filterWatchlists, loadWatchlists, mayChangeWatchlists, maySyncWatchlists, syncWatchlists, validateWatchlistDraft, watchlistKinds, watchlistScope, WatchlistRequestError, type WatchlistChange, type WatchlistDraft, type WatchlistPage, type WatchlistStatus } from '../lib/watchlists'

export function WatchlistsScreen({ settings }: { settings: AppSettings }) {
    return <WorkspaceWatchlists key={watchlistScope(settings)} settings={settings} />
}
function WorkspaceWatchlists({ settings }: { settings: AppSettings }) {
    const theme = useAppTheme(), live = useRef(true), saving = useRef(false)
    const focused = useIsFocused(), scrollViewRef = useRef<ScrollView>(null)
    const [page, setPage] = useState<WatchlistPage | null>(null)
    const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0)
    const [error, setError] = useState(''), [notice, setNotice] = useState(''), [warning, setWarning] = useState('')
    const [readFailed, setReadFailed] = useState(false), [mustRefresh, setMustRefresh] = useState(false)
    const [query, setQuery] = useState(''), [status, setStatus] = useState<WatchlistStatus | ''>('')
    const [selected, setSelected] = useState(''), [cleanupIds, setCleanupIds] = useState<string[]>([])
    const [editing, setEditing] = useState<string | null>(null)
    const [draft, setDraft] = useState<WatchlistDraft>({ kind: 'company', value: '', notes: '' })
    const organizationId = settings.selectedOrganizationId
    const hasOrganization = !!organizationId && organizationId !== 'personal'
    useEffect(() => { live.current = true; return () => { live.current = false } }, [])
    useEffect(() => {
        if (!focused || !hasOrganization || saving.current) return
        const controller = new AbortController()
        let active = true
        setLoading(true); setError('')
        void loadWatchlists(settings, controller.signal).then(value => {
            if (!active) return
            setPage(value); setReadFailed(false); setMustRefresh(false)
            setCleanupIds(ids => ids.filter(id => value.items.some(item => item.id === id && item.status !== 'archived')))
        }).catch(cause => { if (active) { setError(message(cause)); setReadFailed(true) } })
            .finally(() => { if (active) setLoading(false) })
        return () => { active = false; controller.abort() }
    }, [revision, focused, hasOrganization, settings])
    const disabled = busy || loading || mustRefresh || readFailed
    const allowed = (type: WatchlistChange['type']) => !!page && !disabled && mayChangeWatchlists(settings, page, type)
    const text = { color: theme.textMuted, fontSize: 14, lineHeight: 20 }
    const row = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 }
    async function save(change: WatchlistChange) {
        if (!page || saving.current || !allowed(change.type)) return
        saving.current = true; setBusy(true); setError(''); setNotice(''); setWarning('')
        try {
            const result = await changeWatchlists(settings, page, change, `watchlist-mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`)
            if (!live.current) return
            setPage(current => current && { ...current, items: [...current.items.filter(item => !result.items.some(saved => saved.id === item.id)), ...result.items] })
            setNotice(result.message); setWarning(result.warning); setMustRefresh(result.requiresRefresh)
            setEditing(null); setCleanupIds([])
            if (result.items[0]) setSelected(result.items[0].id)
        } catch (cause) {
            if (live.current) { setError(message(cause)); if (cause instanceof WatchlistRequestError && cause.outcomeUnknown) setMustRefresh(true) }
        } finally { saving.current = false; if (live.current) setBusy(false) }
    }
    async function sync(itemId: string) {
        if (!page || saving.current || disabled || !maySyncWatchlists(settings, page)) return
        saving.current = true; setBusy(true); setError(''); setNotice(''); setWarning('')
        try {
            const result = await syncWatchlists(settings, page, [itemId], `watchlist-sync-${Date.now()}-${Math.random().toString(36).slice(2)}`)
            if (live.current) { setNotice(result.message); setWarning(result.warning) }
        } catch (cause) { if (live.current) setError(message(cause)) }
        finally { saving.current = false; if (live.current) setBusy(false) }
    }
    function confirm(change: WatchlistChange, title: string, body: string) {
        Alert.alert(title, body, [{ text: 'Cancel', style: 'cancel' }, { text: 'Confirm', style: 'destructive', onPress: () => void save(change) }])
    }
    function openEditor(id: string, value: WatchlistDraft) {
        setEditing(id); setDraft(value)
        scrollViewRef.current?.scrollTo({ y: 0, animated: false })
    }
    function submitDraft() {
        try {
            const normalized = validateWatchlistDraft(draft)
            void save(editing ? { type: 'edit', itemId: editing, draft: normalized } : { type: 'create', draft: normalized })
        } catch (cause) { setError(message(cause)) }
    }
    const items = page ? filterWatchlists(page.items, query, status) : []
    return <Screen title='Watchlists' subtitle={page?.name || 'Organization watch terms'} scrollViewRef={scrollViewRef}>
        {!hasOrganization ? <InlineNotice tone='info' message='Select an organization in the workspace picker to view its watchlists.' /> : <>
            <View style={row}><PillButton label={loading ? 'Loading…' : 'Refresh watchlists'} disabled={busy || loading} onPress={() => setRevision(value => value + 1)} /><PillButton label='Create watch term' tone='accent' disabled={!allowed('create')} onPress={() => openEditor('', { kind: 'company', value: '', notes: '' })} /></View>
            <InlineNotice message={error} /><InlineNotice message={notice} tone='success' /><InlineNotice message={warning} tone='info' />
            {page && !page.projectionSupported && <InlineNotice tone='info' message='Watchlists are available to read. Update the monitoring service to enable watchlist changes.' />}
            {page && !page.canWrite && <InlineNotice tone='info' message='Your organization access is read-only for watch terms.' />}
            {mustRefresh && <InlineNotice tone='info' message='Refresh to review the saved state before another change. No action will be retried automatically.' />}
            {editing !== null && <GlassCard style={{ gap: 12 }}>
                <SectionTitle eyebrow='Watch term' title={editing ? 'Edit watch term' : 'Create watch term'} />
                <View style={row}>{watchlistKinds.map(kind => <PillButton small key={kind} label={kind} disabled={busy} tone={draft.kind === kind ? 'accent' : 'default'} onPress={() => setDraft(value => ({ ...value, kind }))} />)}</View>
                <LabeledInput label='Term' value={draft.value} onChangeText={value => { if (!saving.current) setDraft(current => ({ ...current, value })) }} autoCapitalize='none' autoCorrect={false} />
                <LabeledInput label='Notes' value={draft.notes} onChangeText={notes => { if (!saving.current) setDraft(current => ({ ...current, notes })) }} multiline />
                <View style={row}><PillButton label={busy ? 'Saving…' : 'Save watch term'} tone='accent' disabled={!allowed(editing ? 'edit' : 'create') || !draft.value.trim()} onPress={submitDraft} /><PillButton label='Cancel' disabled={busy} onPress={() => setEditing(null)} /></View>
            </GlassCard>}
            <LabeledInput label='Search watchlists' value={query} onChangeText={setQuery} placeholder='Term, type or notes' />
            <View style={row}>{(['', 'active', 'paused', 'archived'] as const).map(value => <PillButton small key={value} label={value || 'All states'} tone={status === value ? 'accent' : 'default'} onPress={() => setStatus(value)} />)}</View>
            {page && <Text style={text}>{items.length} of {page.items.length} watch terms</Text>}
            {!loading && page && !items.length && <Text style={text}>No watch terms match this view.</Text>}
            {items.map(item => <GlassCard key={item.id} style={{ gap: 10 }}>
                <SectionTitle eyebrow={`${item.kind} · ${item.status}`} title={item.value} body={item.notes || undefined} />
                <PillButton small label={selected === item.id ? 'Close details' : 'View details'} onPress={() => setSelected(value => value === item.id ? '' : item.id)} />
                {selected === item.id && <>
                    <Text selectable style={text}>Item: {item.id}</Text><Text style={text}>Updated: {item.updatedAt || 'Not reported'}</Text>
                    <View style={row}>
                        {page?.canReconcile && <PillButton small label='Sync monitoring' disabled={disabled || !maySyncWatchlists(settings, page)} onPress={() => void sync(item.id)} />}
                        {item.status !== 'archived' && <PillButton small label='Edit' disabled={!allowed('edit')} onPress={() => openEditor(item.id, { kind: item.kind, value: item.value, notes: item.notes })} />}
                        {item.status === 'active' && <PillButton small label='Pause' disabled={!allowed('pause')} onPress={() => confirm({ type: 'pause', itemId: item.id }, 'Pause watch term?', item.value)} />}
                        {item.status === 'paused' && <PillButton small label='Resume' disabled={!allowed('resume')} onPress={() => void save({ type: 'resume', itemId: item.id })} />}
                        {item.status === 'archived' && <PillButton small label='Restore' disabled={!allowed('restore')} onPress={() => void save({ type: 'restore', itemId: item.id })} />}
                        {item.status !== 'archived' && <PillButton small label='Archive' tone='danger' disabled={!allowed('archive')} onPress={() => confirm({ type: 'archive', itemId: item.id }, 'Archive watch term?', `${item.value} will be archived. It can be restored later.`)} />}
                    </View>
                </>}
                {item.status !== 'archived' && page?.canCleanup && <PillButton small label={cleanupIds.includes(item.id) ? 'Remove from cleanup selection' : 'Select for cleanup'} disabled={!allowed('cleanup')} onPress={() => setCleanupIds(ids => ids.includes(item.id) ? ids.filter(id => id !== item.id) : ids.length < 50 ? [...ids, item.id] : ids)} />}
            </GlassCard>)}
            {!!cleanupIds.length && <PillButton label={`Archive ${cleanupIds.length} selected terms`} tone='danger' disabled={!allowed('cleanup')} onPress={() => confirm({ type: 'cleanup', itemIds: cleanupIds }, 'Archive selected watch terms?', `Archive ${cleanupIds.length} selected terms. No permanent deletion is performed.`)} />}
        </>}
    </Screen>
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : 'Watchlists could not be loaded.' }
