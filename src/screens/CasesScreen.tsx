import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, AppState, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { randomUUID } from 'expo-crypto'
import { GlassCard, InlineNotice, PillButton, Screen } from '../components/ui'
import type { AppSettings } from '../types'
import { caseServices, type CaseServices } from '../features/cases/api'
import { CaseController, caseCallbackAllowed, caseReadComplete, type CaseIntent } from '../features/cases/controller'
import { CaseError, caseScope, filterCases, intentScope, own, type CaseChange, type CaseItem, type Repository } from '../features/cases/model'
import { Actions, CaseInput, CaseText, Options } from '../features/cases/ui'
import { CaseDetail, type CasePanel } from '../features/cases/CaseDetail'
import { Development, type CommitPage, type DevelopmentPage } from '../features/cases/Development'
export type CasesScreenProps = { settings: AppSettings; onOpenIntelligence?: () => void; onOpenHealth?: (automationId: string) => void; services?: CaseServices }
export function CasesScreen(props: CasesScreenProps) { return <CasesWorkspace key={caseScope(props.settings)} {...props} /> }
function CasesWorkspace({ settings, onOpenIntelligence, onOpenHealth, services: injected }: CasesScreenProps) {
    const services = useMemo(() => injected || caseServices(settings), [settings, injected])
    const ops = useRef(new CaseController(intentScope(settings))).current
    const [items, setItems] = useState<CaseItem[] | null>(null), [selected, setSelected] = useState(''), [detail, setDetail] = useState<CaseItem | null>(null)
    const [eventView, setEventView] = useState<Pick<CaseItem, 'events' | 'eventPage' | 'eventTotal' | 'eventSnapshot'> | null>(null)
    const [panel, setPanel] = useState<CasePanel>('overview'), [repositories, setRepositories] = useState<Repository[] | null>(null), [development, setDevelopment] = useState<DevelopmentPage | null>(null), [canConnect, setCanConnect] = useState(false)
    const [developmentError, setDevelopmentError] = useState(''), [repositoryError, setRepositoryError] = useState('')
    const [commits, setCommits] = useState<CommitPage | null>(null), [commitCursor, setCommitCursor] = useState<string | undefined>(), [commitBack, setCommitBack] = useState<(string | undefined)[]>([]), [repository, setRepository] = useState('')
    const [repoDraft, setRepoDraft] = useState({ url: '', provider: 'forgejo', search: '' }), [secret, setSecret] = useState<{ secret: string; webhookUrl: string } | null>(null)
    const [comment, setComment] = useState(''), [ai, setAi] = useState(false), [query, setQuery] = useState(''), [status, setStatus] = useState('active'), [severity, setSeverity] = useState('all'), [review, setReview] = useState('all')
    const [owner, setOwner] = useState('all'), [resolution, setResolution] = useState('all')
    const drafts = useRef({ comment, ai, repoDraft, mergeSources: [] as string[] })
    const [listLimit, setListLimit] = useState(50)
    const [mergeSources, setMergeSources] = useState<string[]>([]), [error, setError] = useState(''), [notice, setNotice] = useState(''), [, render] = useState(0)
    const mounted = useRef(true), focused = useRef(false), foreground = useRef(AppState.currentState === 'active')
    const current = useRef({ selected, panel, detail, repository }); current.current = { selected, panel, detail, repository }
    drafts.current = { comment, ai, repoDraft, mergeSources }
    const host = ops.generation
    const publish = () => { if (mounted.current) render(n => n + 1) }
    function hide() {
        ops.hide(); setSecret(null); setRepoDraft(v => ({ ...v, url: '' })); setDetail(null); setItems(null); setRepositories(null); setDevelopment(null); setCommits(null); setCanConnect(false); publish()
    }
    async function refresh(generation: number, manual: boolean) {
        const read = ops.beginRead(generation, manual)
        if (!read) return
        setError(''); setCanConnect(false); publish()
        let complete = false
        try {
            const unknown = ops.unknown
            const id = manual && unknown && ['update', 'merge', 'link'].includes(unknown.kind) ? unknown.target : current.current.selected
            const [listResult, itemResult, reposResult, changesResult, connectionResult] = await Promise.allSettled([
                services.list(read.controller.signal), id ? services.detail(id, read.controller.signal) : Promise.resolve(null), services.repositories(read.controller.signal),
                id ? services.development(id, 0, read.controller.signal) : Promise.resolve(null), services.connectionAccess(read.controller.signal),
            ])
            if (!ops.current(read.ticket.generation)) return
            setItems(listResult.status === 'fulfilled' ? listResult.value : null)
            const item = itemResult.status === 'fulfilled' ? itemResult.value : null
            setDetail(item); setEventView(null)
            setRepositories(reposResult.status === 'fulfilled' ? reposResult.value : null)
            if (reposResult.status === 'rejected') setSecret(null)
            setRepositoryError(reposResult.status === 'rejected' ? message(reposResult.reason) : connectionResult.status === 'rejected' ? 'Repository creation access is unavailable. Refresh before connecting.' : '')
            setCanConnect(reposResult.status === 'fulfilled' && connectionResult.status === 'fulfilled' && connectionResult.value)
            setDevelopment(changesResult.status === 'fulfilled' ? changesResult.value : null)
            setDevelopmentError(changesResult.status === 'rejected' ? message(changesResult.reason) : '')
            if (listResult.status === 'rejected') setError(message(listResult.reason))
            else if (itemResult.status === 'rejected') setError(message(itemResult.reason))
            if (item) {
                if (current.current.selected !== item.id) { setComment(''); setAi(false); setSecret(null); setRepoDraft(v => ({ ...v, url: '' })) }
                current.current.selected = item.id; current.current.detail = item; setSelected(item.id)
            }
            complete = caseReadComplete(unknown?.kind, { list: listResult.status === 'fulfilled', detail: itemResult.status === 'fulfilled', repositories: reposResult.status === 'fulfilled', development: changesResult.status === 'fulfilled', connection: connectionResult.status === 'fulfilled' })
        } catch (cause) { if (ops.current(read.ticket.generation)) { setError(message(cause)); setDetail(null); setDevelopment(null); setCanConnect(false) } }
        finally { if (ops.finishRead(read.ticket, complete)) publish() }
    }
    useFocusEffect(useCallback(() => {
        mounted.current = true; focused.current = true; ops.visible = foreground.current
        if (ops.visible) void refresh(ops.generation, false)
        return () => { focused.current = false; hide() }
    }, [services]))
    useEffect(() => {
        mounted.current = true
        const subscription = AppState.addEventListener('change', state => {
            const was = foreground.current; foreground.current = state === 'active'
            if (!foreground.current) hide()
            else if (!was && focused.current) { ops.visible = true; void refresh(ops.generation, false) }
        })
        return () => { mounted.current = false; ops.hide(); subscription.remove() }
    }, [services])
    function navigate(id: string, next: CasePanel = 'overview') {
        if (!ops.context(host)) return
        current.current.selected = id; current.current.panel = next
        setSelected(id); setPanel(next); setSecret(null); setComment(''); setAi(false); setMergeSources([]); setCommits(null); setRepository(''); setRepoDraft(v => ({ ...v, url: '' })); setDetail(null); setEventView(null); setDevelopment(null); publish()
        void refresh(ops.generation, false)
    }
    function tab(next: CasePanel) {
        if (!ops.context(host)) return
        current.current.panel = next; setPanel(next); setSecret(null); setRepoDraft(v => ({ ...v, url: '' })); publish()
    }
    async function readPart(task: (signal: AbortSignal) => Promise<() => void>) {
        const read = ops.beginRead(host, false)
        if (!read) return
        setError(''); publish()
        let complete = false
        try { const apply = await task(read.controller.signal); if (ops.current(read.ticket.generation)) { apply(); complete = true } }
        catch (cause) { if (ops.current(read.ticket.generation)) setError(message(cause)) }
        finally { if (ops.finishRead(read.ticket, complete)) publish() }
    }
    function events(page: number) {
        if (!detail) return
        const id = detail.id, snapshot = detail.eventSnapshot
        void readPart(async signal => { const next = await services.detail(id, signal, page, snapshot); if (next.id !== id) throw new CaseError('Case identity changed. Refresh before paging.'); return () => { setEventView({ events: next.events, eventPage: next.eventPage, eventTotal: next.eventTotal, eventSnapshot: next.eventSnapshot }); setDetail(previous => previous ? { ...previous, canManage: next.canManage } : previous) } })
    }
    function commitsPage(cursor?: string, back = false) {
        const id = repository, search = repoDraft.search
        if (!id) return
        void readPart(async signal => {
            const value = await services.commits(id, search, cursor, signal)
            return () => { setCommits(value); setCommitCursor(cursor); setCommitBack(v => back ? v.slice(0, -1) : cursor ? [...v, commitCursor] : []) }
        })
    }
    const writable = own(settings) && ops.idle(host) && !ops.locked
    async function perform(intent: CaseIntent, action: (signal: AbortSignal, current: () => boolean) => Promise<unknown>, successful: (value: unknown) => void) {
        const write = ops.beginWrite(host, intent)
        if (!write) return
        setError(''); setNotice(''); setSecret(null); publish()
        const outcome = { definite: false, succeeded: false }
        try {
            const value = await action(write.controller.signal, () => ops.current(write.generation))
            outcome.definite = true; outcome.succeeded = true
            if (ops.current(write.generation)) { successful(value); setNotice('Change saved.'); setMergeSources([]) }
        } catch (cause) {
            outcome.definite = cause instanceof CaseError && !cause.uncertain
            if (ops.current(write.generation)) setError(message(cause))
        } finally {
            if (ops.finishWrite(write.generation, intent, outcome.definite)) { publish(); if (outcome.definite) { await refresh(ops.generation, false); if (outcome.succeeded) publish() } }
        }
    }
    function confirm(title: string, body: string, intent: Omit<CaseIntent, 'token'>, action: (signal: AbortSignal, current: () => boolean) => Promise<unknown>, successful: (value: unknown) => void = () => {}) {
        if (!writable) return
        const generation = host, context = { ...current.current }, fingerprint = JSON.stringify(drafts.current)
        Alert.alert(title, body, [{ text: 'Cancel', style: 'cancel' }, { text: 'Confirm', onPress: () => {
            if (!own(settings) || !caseCallbackAllowed(ops, generation, context, current.current, fingerprint, JSON.stringify(drafts.current))) return
            void perform({ ...intent, token: randomUUID() }, action, successful)
        } }])
    }
    function save(change: CaseChange, title: string) {
        const item = detail
        if (!item?.canManage) return
        confirm(title, 'The case will be updated. Closing this view does not cancel a submitted change.', { kind: 'update', target: item.id }, (signal, valid) => services.update(item.id, change, signal, valid), () => { if (change.comment !== undefined) setComment(''); setAi(false) })
    }
    function acknowledge() {
        const token = ops.unknown?.token, generation = host
        if (!token || !ops.canAcknowledge || !ops.idle(generation)) return
        Alert.alert('Finish reviewing this uncertain change?', 'Current records were loaded after your Refresh. This does not prove whether the previous change succeeded. Check the case history or repository connections before continuing. A lost repository secret cannot be recovered here.', [{ text: 'Keep locked', style: 'cancel' }, { text: 'I have reviewed current records', onPress: () => { if (ops.acknowledge(generation, token)) { setNotice('Review acknowledged; the earlier outcome remains unconfirmed.'); publish() } } }])
    }
    const shown = items ? filterCases(items, query, status, severity, review, owner, resolution) : []
    return <Screen
        title='Monitoring cases'
        subtitle={settings.selectedOrganizationId && settings.selectedOrganizationId !== 'personal' ? 'Selected organization' : 'Personal workspace'}
        right={<PillButton
            key={`refresh:${host}`}
            label={ops.reading ? 'Refreshing…' : 'Refresh'}
            disabled={!ops.idle(host)}
            onPress={() => { if (ops.idle(host)) void refresh(host, true) }}
        />}
    >

        {!!error && <InlineNotice message={error} />}
        {!!notice && <InlineNotice message={notice} tone='success' />}

        {!own(settings) && <InlineNotice message='Return to your own account to change cases or repository connections.' />}

        {ops.unknown && <GlassCard>
            <View style={{ gap: 8 }}>
                <CaseText heading>Previous change is unconfirmed</CaseText>
                <CaseText>{ops.unknown.kind} · {ops.unknown.target}{ '\n' }Refresh manually, review current records, then acknowledge before another change. No change will be retried automatically.</CaseText>
                <PillButton
                    key={`ack:${host}`}
                    label='Acknowledge after reviewing'
                    disabled={!ops.canAcknowledge || !ops.idle(host)}
                    onPress={acknowledge}
                />
            </View>
        </GlassCard>}

        <View key={`case-controls:${host}`} style={{ gap: 12 }}>

            {selected ? <>
                <PillButton label='Back to monitoring cases' disabled={!ops.idle(host)} onPress={() => navigate('')} />
                <Actions>
                    {(['overview', 'comments', 'events', 'history', 'notifications', 'development'] as CasePanel[]).map(v => <PillButton key={v} label={`${panel === v ? '✓ ' : ''}${v}`} disabled={!ops.idle(host)} onPress={() => tab(v)} />)}
                </Actions>
                {detail && panel !== 'development' && <CaseDetail
                    item={panel === 'events' && eventView ? { ...detail, ...eventView } : detail}
                    panel={panel}
                    comment={comment}
                    setComment={v => { drafts.current.comment = v; setComment(v) }}
                    ai={ai}
                    setAi={v => { drafts.current.ai = v; setAi(v) }}
                    ops={ops}
                    host={host}
                    writable={writable && detail.canManage}
                    save={save}
                    eventPage={events}
                    onOpenHealth={onOpenHealth}
                />}
                {!detail && <CaseText>{ops.reading ? 'Loading current case…' : 'Case details are unavailable. Refresh to try again.'}</CaseText>}
                {detail && panel === 'development' && <Development
                    settings={settings}
                    ops={ops}
                    host={host}
                    repositories={repositories}
                    repositoryError={repositoryError}
                    developmentError={developmentError}
                    page={development}
                    canConnect={canConnect}
                    draft={repoDraft}
                    setDraft={v => { if (ops.idle(host) && !ops.unknown) { drafts.current.repoDraft = { ...drafts.current.repoDraft, ...v }; setRepoDraft(old => ({ ...old, ...v })); if (v.search !== undefined) { setCommits(null); setCommitCursor(undefined); setCommitBack([]) } } }}
                    commits={commits}
                    cursor={commitCursor}
                    previous={() => commitsPage(commitBack.at(-1), true)}
                    selected={repository}
                    select={id => { if (!ops.context(host)) return; current.current.repository = id; setRepository(id); setCommits(null); setCommitCursor(undefined); setCommitBack([]); setSecret(null); publish() }}
                    loadCommits={commitsPage}
                    developmentPage={offset => { void readPart(async signal => { const page = await services.development(detail.id, offset, signal); return () => { setDevelopment(page); setDevelopmentError('') } }) }}

                    connect={() => confirm('Connect this repository?', 'A webhook secret will be shown once. Configure the webhook on the repository website after connecting.', { kind: 'connect', target: 'repository-connection' }, (signal, valid) => services.connect(repoDraft.provider, repoDraft.url, signal, valid), value => { setSecret(value as { secret: string; webhookUrl: string }); setRepoDraft(v => ({ ...v, url: '' })) })}

                    disconnect={repo => confirm('Disconnect repository?', 'This removes its case links. The repository itself will not change.', { kind: 'disconnect', target: repo.id }, (signal, valid) => services.disconnect(repo.id, signal, valid))}

                    link={commit => confirm('Link this commit?', `${commit} will be linked to ${detail.id}.`, { kind: 'link', target: detail.id, repository }, (signal, valid) => services.link(detail.id, repository, commit, signal, valid))}
                    secret={secret}
                    hideSecret={() => { if (ops.idle(host)) setSecret(null) }}
                />}
            </> : <>
                <GlassCard>
                    <View style={{ gap: 10 }}>
                        <CaseText heading>Monitoring case queue</CaseText>
                        <CaseText>Cases are created by health checks. Search and filters apply to the loaded monitoring cases.</CaseText>

                        <CaseInput label='Search monitoring cases' value={query} onChange={setQuery} ops={ops} host={host} limit={200} />

                        <Options
                            label='Status'
                            values={['active', 'all', 'open', 'in_progress', 'resolved', 'closed']}
                            value={status}
                            disabled={!ops.idle(host)}
                            choose={v => { if (ops.idle(host)) setStatus(v) }}
                        />

                        <Options
                            label='Severity'
                            values={['all', 'low', 'medium', 'high', 'critical']}
                            value={severity}
                            disabled={!ops.idle(host)}
                            choose={v => { if (ops.idle(host)) setSeverity(v) }}
                        />

                        <Options
                            label='Assigned owner'
                            values={['all', 'unassigned', ...new Set((items || []).map(c => c.assignedOwner).filter(Boolean))]}
                            value={owner}
                            disabled={!ops.idle(host)}
                            choose={v => { if (ops.idle(host)) setOwner(v) }}
                        />

                        <Options
                            label='Resolution method'
                            values={['all', 'human', 'ai', 'automation', 'unknown']}
                            value={resolution}
                            disabled={!ops.idle(host)}
                            choose={v => { if (ops.idle(host)) { setResolution(v); if (v !== 'all') setStatus('all') } }}
                        />

                        <Options
                            label='Human review'
                            values={['all', 'pending', 'confirmed']}
                            value={review}
                            disabled={!ops.idle(host)}
                            choose={v => { if (ops.idle(host)) { setReview(v); if (v !== 'all') setStatus('all') } }}
                        />

                        <PillButton
                            label='Reset filters'
                            disabled={!ops.idle(host)}
                            onPress={() => { if (ops.idle(host)) { setQuery(''); setStatus('active'); setSeverity('all'); setOwner('all'); setResolution('all'); setReview('all') } }}
                        />

                        <CaseText>{items === null ? ops.reading ? 'Loading cases…' : 'Cases have not loaded.' : `${shown.length} matching · ${items.length} loaded`}</CaseText>

                    </View>
                </GlassCard>
                {shown.slice(0, listLimit).map(item => <GlassCard key={item.id}>
                    <View style={{ gap: 8 }}>
                        <CaseText heading>{item.title}</CaseText>
                        <CaseText>{item.status.replaceAll('_', ' ')} · {item.severity}{ '\n' }{item.summary}{ '\n' }Updated: {item.updatedAt}</CaseText>
                        <Actions>
                            <PillButton label={`Open ${item.id}`} disabled={!ops.idle(host)} onPress={() => navigate(item.id)} />
                            <PillButton
                                label={mergeSources.includes(item.id) ? '✓ Selected for merge' : 'Select for merge'}
                                disabled={!writable || !item.canManage || mergeSources.length >= 50 && !mergeSources.includes(item.id)}
                                onPress={() => { if (writable) setMergeSources(v => { const next = v.includes(item.id) ? v.filter(id => id !== item.id) : [...v, item.id]; drafts.current.mergeSources = next; return next }) }}
                            />
                        </Actions>
                    </View>
                </GlassCard>)}
                {shown.length > listLimit && <PillButton
                    label='Show more monitoring cases'
                    disabled={!ops.idle(host)}
                    onPress={() => { if (ops.idle(host)) setListLimit(n => n + 50) }}
                />}
                {!!items && !shown.length && <CaseText>No monitoring cases match these filters.</CaseText>}
                {mergeSources.length >= 2 && <GlassCard>
                    <CaseText heading>Merge selected cases</CaseText>
                    <CaseText>Choose the case to keep. Other selected cases must belong to the same health check and organization. Their history and evidence will move to the chosen case.</CaseText>
                    {mergeSources.map(target => <PillButton
                        key={target}
                        label={`Keep ${target} and merge ${mergeSources.length - 1} others`}
                        disabled={!writable}
                        onPress={() => confirm('Merge monitoring cases?', `Keep ${target}; move the other selected cases into it.`, { kind: 'merge', target }, (signal, valid) => services.merge(target, mergeSources.filter(v => v !== target), signal, valid))}
                    />)}
                </GlassCard>}
                {onOpenIntelligence && <PillButton
                    label='Open intelligence cases on website'
                    disabled={!ops.idle(host)}
                    onPress={() => { if (ops.idle(host)) onOpenIntelligence() }}
                />}
            </>}

        </View>

    </Screen>
}
function message(cause: unknown) { return cause instanceof CaseError ? cause.message : 'Cases could not be loaded. Refresh to try again.' }
