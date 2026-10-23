import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useIsFocused } from '@react-navigation/native'
import { Alert, AppState, ScrollView, View } from 'react-native'
import { Screen, InlineNotice, NativeTile, PillButton, StatChip } from '../../components/ui'
import { MarkdownView } from '../../components/MarkdownView'
import type { AppSettings } from '../../types'
import { accountScope, filterContent, publicationSummary, type ContentKind } from './contracts'
import { createPublishingApi, type PublishingApi } from './api'
import { PublishingDesk } from './desk'
import type { PublishingDigest } from './intents'
import { PublishingEditor } from './PublishingEditor'
import { PublishingActions, PublishingField, PublishingText } from './ui'

export type PublishingServices = { api?: PublishingApi; digest?: PublishingDigest }
export function PublishingScreen({ settings, kind, services }: { settings: AppSettings; kind: ContentKind; services?: PublishingServices }) {
    const focused = useIsFocused()
    const scope = accountScope(settings)
    const desk = useMemo(() => new PublishingDesk({ ...settings }, kind, services?.api || createPublishingApi(settings, kind), services?.digest), [scope, kind, services?.api, services?.digest])
    const [, rerender] = useReducer(value => value + 1, 0)
    const [search, setSearch] = useState('')
    const [sort, setSort] = useState<'newest' | 'title'>('newest')
    const [page, setPage] = useState(0)
    const scroll = useRef<ScrollView>(null)
    const state = desk.state
    const host = state.host
    useEffect(() => desk.subscribe(rerender), [desk])
    useEffect(() => {
        const sync = (active: boolean) => { if (focused && active) desk.activate(); else desk.hide() }
        sync(AppState.currentState === 'active')
        const subscription = AppState.addEventListener('change', next => sync(next === 'active'))
        return () => { subscription.remove(); desk.hide() }
    }, [desk, focused])
    useEffect(() => { setSearch(''); setPage(0) }, [scope, kind])
    useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }) }, [state.mode, state.selected?.id])
    const filtered = filterContent(state.items, search, sort)
    const pages = Math.max(1, Math.ceil(filtered.length / 20))
    const currentPage = Math.min(page, pages - 1)
    const ready = desk.canRead(host)
    const label = kind === 'articles' ? 'Articles' : 'Thoughts'
    const summary = publicationSummary(state.items, state.loaded, state.fresh)
    const latest = filterContent(state.items, '', 'newest')[0]
    function reviewedUnknown() {
        if (!ready || !state.unknown?.reviewed) return
        Alert.alert('Finish reviewing the uncertain operation?', 'The displayed data does not prove which request saved it. This acknowledgment enables editing; it does not retry the operation or create a save receipt. Keep your draft for comparison.', [
            { text: 'Continue review', style: 'cancel' }, { text: 'I reviewed the result', onPress: () => desk.acknowledge(host) },
        ])
    }
    return <Screen title={label} subtitle={state.access?.name || 'Workspace publishing'} scrollViewRef={scroll}>
        <InlineNotice tone='info' message='Content and unsaved drafts stay in memory while this workspace is open. Changing account or closing this screen clears drafts.' />
        {state.visible && <>
            <View key={`toolbar:${host}`}>
                <PublishingActions>
                    <PillButton label={state.pending === 'read' ? 'Refreshing…' : 'Refresh and review'} onPress={() => void desk.refresh(true, host)} disabled={!ready} />
                    <PillButton label={`Create ${kind === 'articles' ? 'article' : 'thought'}`} tone='accent' onPress={() => desk.startCreate(host)} disabled={!desk.canEdit(host) || desk.hasDraftChanges()} />
                </PublishingActions>
            </View>
            <InlineNotice message={state.error} />
            {!state.fresh && <InlineNotice tone='info' message={state.loaded ? 'Showing a cached in-memory list. Current service data is unavailable until refresh completes successfully.' : 'The workspace list has not loaded successfully. Counts and empty state are unavailable.'} />}
            <InlineNotice tone='success' message={state.notice} />
            {!state.access?.canWrite && <InlineNotice tone='info' message='Editing is unavailable until current workspace access is verified on your own account. Existing drafts are retained.' />}
            {state.pending === 'write' && <InlineNotice tone='info' message='Saving once. Keep this screen open; an interrupted operation requires a manual review.' />}
            {state.unknown && <View style={{ gap: 12 }}>
                <InlineNotice message='The operation may already have changed saved content. No retry will be sent automatically. Refresh and review the service result before another operation.' />
                <PublishingText heading>Retained submission</PublishingText>
                <PublishingText muted>{state.unknown.intent.action} · {state.unknown.intent.id || 'Thought ID not received'}</PublishingText>
                {state.unknown.mutation && state.unknown.intent.action !== 'delete' ? <MarkdownView source={state.unknown.mutation.draft.body} /> : <PublishingText muted>Only the unresolved action and content fingerprint were retained after leaving this editor; no full draft is stored.</PublishingText>}
                {state.unknown.reviewed && <>
                    <PublishingText heading>Current service result</PublishingText>
                    <PublishingText>{state.unknown.missing ? 'The selected record was not found. This is not an original delete receipt.' : state.unknown.matches.length ? 'Matching saved content was found. Its presence is not a receipt for this request.' : 'No matching record was found in this workspace. Another workspace may own a conflicting title.'}</PublishingText>
                    {state.unknown.matches.map(item => <View key={item.id} style={{ gap: 8 }}><PublishingText muted>{item.id} · {item.title}</PublishingText><MarkdownView source={item.body || ''} /></View>)}
                    <View key={`ack:${host}`}><PillButton label='Acknowledge reviewed result' onPress={reviewedUnknown} disabled={!ready} /></View>
                </>}
            </View>}
            {state.mode !== 'list' ? <PublishingEditor desk={desk} /> : <>
                <PublishingActions>
                    <StatChip label={summary.cached ? 'Cached saved' : 'Saved'} value={summary.count === null ? 'Unavailable' : String(summary.count)} />
                    {kind === 'articles' ? <><StatChip label='Words' value={summary.words === null ? 'Unavailable' : String(summary.words)} /><StatChip label='Reading time' value={summary.minutes === null ? 'Unavailable' : `${summary.minutes} min`} /></> : <StatChip label='Authors' value={summary.authors === null ? 'Unavailable' : String(summary.authors)} />}
                </PublishingActions>
                {latest && <PublishingText muted>{state.fresh ? 'Latest' : 'Cached latest'}: {latest.title} · {latest.updatedAt || latest.createdAt || 'Date unavailable'}</PublishingText>}
                <PublishingField label='Search titles or IDs' value={search} onChange={value => { if (desk.canRead(host)) { setSearch(value); setPage(0) } }} editable={ready} host={host} />
                <View key={`list-controls:${host}`}><PublishingActions>
                    <PillButton label={sort === 'newest' ? 'Sort: newest' : 'Sort: title'} onPress={() => { if (desk.canRead(host)) { setSort(sort === 'newest' ? 'title' : 'newest'); setPage(0) } }} disabled={!ready} />
                    <PillButton label='Previous' onPress={() => { if (desk.canRead(host)) setPage(Math.max(0, currentPage - 1)) }} disabled={!ready || currentPage === 0} />
                    <PillButton label='Next' onPress={() => { if (desk.canRead(host)) setPage(Math.min(pages - 1, currentPage + 1)) }} disabled={!ready || currentPage >= pages - 1} />
                </PublishingActions></View>
                <PublishingText muted>{state.loaded ? `Page ${currentPage + 1} of ${pages} · ${filtered.length} ${state.fresh ? '' : 'cached '}matches` : 'List unavailable'} · Local paging of the complete workspace list</PublishingText>
                {state.loaded && state.fresh && !state.pending && !filtered.length && <PublishingText>No saved {label.toLowerCase()} match this view.</PublishingText>}
                <View key={`rows:${host}`} style={{ gap: 10 }}>{filtered.slice(currentPage * 20, currentPage * 20 + 20).map(item => <NativeTile key={item.id} title={item.title || item.id} body={item.description || item.id} meta={[item.updatedAt || item.createdAt || 'Date unavailable', item.minutes === undefined ? '' : `${item.minutes} min`].filter(Boolean).join(' · ')} onPress={ready && !state.unknown ? () => void desk.select(item.id, host) : undefined} />)}</View>
            </>}
        </>}
    </Screen>
}
