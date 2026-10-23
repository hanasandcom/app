import { useEffect, useRef, useState } from 'react'
import * as Crypto from 'expo-crypto'
import { Alert, ScrollView, Text, View } from 'react-native'
import { GlassCard, InlineNotice, PillButton } from '../../components/ui'
import { ThesisError, type Inventory, type ReviewEvent, type SourceNode, type ThesisApi } from './api'
import { Actions, ThesisField, ThesisText } from './ui'
import { DependencyGraph } from './DependencyGraph'
import { useAppTheme } from '../../theme/context'

export const reviewStatus = (item: SourceNode) => !item.review ? 'unreviewed' : item.review.review_hash !== item.reviewHash ? 'changed' : item.review.approved ? 'approved' : 'unreviewed'
export function reviewPriority(item: SourceNode, now = Date.now()) {
    if (reviewStatus(item) === 'approved') return 2
    return item.review?.approved && reviewStatus(item) === 'changed' && now - Date.parse(item.review.reviewed_at) < 14 * 86400000 ? 1 : 0
}
type PendingReview = { item: SourceNode; approved: boolean; eventId: string }
export function CodeInventory({ api, canReview, guard, host }: { api: ThesisApi; canReview: boolean; guard: () => boolean; host: number }) {
    const theme = useAppTheme()
    const [inventory, setInventory] = useState<Inventory | null>(null)
    const [detail, setDetail] = useState<{ item: SourceNode; history: ReviewEvent[] } | null>(null)
    const [selected, select] = useState('')
    const [query, setQuery] = useState(''), [kind, setKind] = useState('all'), [filter, setFilter] = useState('all'), [priority, setPriority] = useState(true), [limit, setLimit] = useState(100)
    const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [denied, setDenied] = useState(false)
    const [pending, setPending] = useState<PendingReview | null>(null), [manualChecked, setManualChecked] = useState(false)
    const [moreHistory, setMoreHistory] = useState(false)
    const mounted = useRef(true), epoch = useRef(0), reading = useRef(false), writing = useRef(false), requests = useRef(new Set<AbortController>())
    const latest = useRef({ inventory, detail, selected, canReview, guard, pending, manualChecked, denied })
    latest.current = { inventory, detail, selected, canReview, guard, pending, manualChecked, denied }
    useEffect(() => () => { mounted.current = false; epoch.current++; requests.current.forEach(controller => controller.abort()) }, [])
    function begin() { const controller = new AbortController(); requests.current.add(controller); return controller }
    function failure(cause: unknown) {
        if (!mounted.current) return
        setError((cause as Error).message)
        if (cause instanceof ThesisError && [401, 403].includes(cause.status)) { latest.current.denied = true; setDenied(true) }
    }
    async function load(manual = false) {
        if (reading.current || writing.current || !mounted.current || latest.current.denied && !manual) return
        reading.current = true
        const request = begin(), captured = epoch.current
        try {
            const old = latest.current.inventory
            const result = await api.inventory(request.signal, manual || !old ? undefined : `${old.hash}:${old.revision || ''}`)
            if (request.signal.aborted || !mounted.current || captured !== epoch.current) return
            if (result) setInventory(result)
            setError(''); if (manual) setDenied(false)
        } catch (cause) { if (!request.signal.aborted) failure(cause) }
        finally { requests.current.delete(request); reading.current = false }
    }
    useEffect(() => { void load(); const timer = setInterval(() => void load(), 3000); return () => clearInterval(timer) }, [api])
    async function source(id: string, older = false, manual = false) {
        if (writing.current || !mounted.current) return
        const captured = ++epoch.current, request = begin()
        if (!older) { select(id); setDetail(null) }
        setBusy(true)
        try {
            const result = await api.source(id, request.signal, older ? latest.current.detail?.history.at(-1)?.event_id : undefined)
            if (!mounted.current || request.signal.aborted || captured !== epoch.current) return
            setDetail(older && latest.current.detail?.item.id === id ? { item: result.item, history: [...latest.current.detail.history, ...result.history] } : result)
            setMoreHistory(result.history.length === 50); setError('')
            if (manual) {
                setManualChecked(true)
                const action = latest.current.pending
                if (action && result.history.some(event => event.event_id === action.eventId && event.item_id === action.item.id && event.review_hash === action.item.reviewHash && event.content_hash === action.item.sha256 && event.approved === action.approved)) {
                    setPending(null); setMessage('The previous review is recorded.')
                }
            }
        } catch (cause) { if (!request.signal.aborted && captured === epoch.current) failure(cause) }
        finally { requests.current.delete(request); if (mounted.current && captured === epoch.current) setBusy(false) }
    }
    function eligible(action: PendingReview) {
        const value = latest.current
        const current = value.inventory?.nodes.find(node => node.id === action.item.id)
        return mounted.current && !writing.current && value.canReview && value.guard() && !value.denied
            && value.selected === action.item.id && current?.reviewHash === action.item.reviewHash && current.sha256 === action.item.sha256
            && (!value.inventory?.sync || value.inventory.sync.phase === 'ready' && !value.inventory.sync.error)
            && (!value.pending || value.pending.eventId === action.eventId && value.manualChecked)
    }
    function review(approved: boolean, retry = false) {
        const item = latest.current.detail?.item
        if (!item) return
        const action: PendingReview = retry && latest.current.pending ? latest.current.pending : { item, approved, eventId: Crypto.randomUUID() }
        const captured = epoch.current
        if (!eligible(action)) return
        Alert.alert(action.approved ? 'Approve this source?' : 'Revoke this approval?', `${action.item.file}\n${action.item.sha256}\nRecord your review of the current source and its dependencies.`, [
            { text: 'Cancel', style: 'cancel' },
            { text: retry ? 'Retry same review' : 'Record review', onPress: () => {
                if (captured !== epoch.current || !eligible(action)) return
                writing.current = true; setBusy(true); setManualChecked(false)
                const request = begin()
                void api.review(action.item, action.approved, action.eventId, request.signal).then(receipt => {
                    if (!mounted.current) return
                    setPending(null); setMessage(`Review recorded at ${receipt.reviewed_at}.`); setError('')
                }).catch(cause => {
                    if (!mounted.current) return
                    setPending(action); failure(cause); setMessage('The review outcome is uncertain. Refresh this source before retrying the same review.')
                }).finally(() => {
                    requests.current.delete(request); writing.current = false
                    if (mounted.current) { setBusy(false); void source(action.item.id); void load() }
                })
            } },
        ])
    }
    const nodes = (inventory?.nodes || []).filter(node => (kind === 'all' || node.kind === kind) && (filter === 'all' || reviewStatus(node) === filter) && `${node.title} ${node.file}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => (priority ? reviewPriority(a) - reviewPriority(b) : 0) || a.title.localeCompare(b.title))
    const node = detail?.item
    const currentNode = inventory?.nodes.find(item => item.id === selected)
    const stale = node && (node.reviewHash !== currentNode?.reviewHash || node.sha256 !== currentNode?.sha256)
    return (
        <View style={{ gap: 14 }}>

            <ThesisText heading>Source inventory and review</ThesisText>

            <ThesisText muted>{inventory ? `Release ${inventory.release} · ${inventory.nodes.length} indexed items` : 'Loading source inventory…'}</ThesisText>

            <InlineNotice message={error} />

            <InlineNotice message={message} tone='info' />

            {inventory?.sync && <ThesisText muted>{[inventory.sync.phase, inventory.sync.checkedAt, inventory.sync.warning, inventory.sync.error].filter(Boolean).join(' · ')}</ThesisText>}

            <PillButton
                label='Refresh inventory and selected source'
                disabled={busy}
                onPress={() => { void load(true).then(() => { if (selected) return source(selected, false, true) }) }}
            />

            <ThesisField label='Find source files' value={query} onChange={setQuery} host={host} />

            <Actions>{['all', 'frontend', 'api', 'database', 'source'].map(value => <PillButton
                key={value}
                label={`${kind === value ? '✓ ' : ''}${value}`}
                onPress={() => { setKind(value); setLimit(100) }}
            />)}</Actions>

            <Actions>
                {['all', 'unreviewed', 'changed', 'approved'].map(value => <PillButton
                    key={value}
                    label={`${filter === value ? '✓ ' : ''}${value}`}
                    onPress={() => { setFilter(value); setLimit(100) }}
                />)}
                <PillButton
                    label={priority ? 'Sort alphabetically' : 'Sort by review priority'}
                    onPress={() => setPriority(!priority)}
                />
            </Actions>

            <ThesisText>{nodes.length} matching items</ThesisText>

            {nodes.slice(0, limit).map(item => <PillButton
                key={item.id}
                label={`${reviewStatus(item)} · ${item.title} · ${item.file}`}
                onPress={() => void source(item.id)}
                disabled={busy}
            />)}

            {nodes.length > limit && <PillButton label='Load 100 more items' onPress={() => setLimit(v => v + 100)} />}

            {node && <GlassCard>
                <View style={{ gap: 10 }}>

                    <ThesisText heading>{node.title}</ThesisText>

                    <ThesisText>{node.file}{node.line ? `:${node.line}` : ''}</ThesisText>

                    <ThesisText muted>Content SHA256 {node.sha256}{'\n'}Review hash {node.reviewHash}</ThesisText>

                    {stale && <InlineNotice message='This source changed. Reload it before reviewing.' tone='info' />}

                    <ScrollView horizontal>
                        <Text selectable style={{ color: theme.text, fontFamily: 'Courier', fontSize: 12 }}>{node.content}</Text>
                    </ScrollView>

                    <ThesisText heading>Dependencies</ThesisText>

                    <Actions>{node.dependencies.map(id => <PillButton
                        key={id}
                        label={inventory?.nodes.find(item => item.id === id)?.title || id}
                        onPress={() => void source(id)}
                        disabled={busy}
                    />)}</Actions>

                    {node.unresolved.length > 0 && <ThesisText muted>Inspect manually: {node.unresolved.join(' · ')}</ThesisText>}

                    <Actions key={`${host}:${node.id}:${node.reviewHash}`}>

                        <PillButton
                            label='Approve source'
                            disabled={busy || !canReview || !!pending || !!stale || denied}
                            onPress={() => review(true)}
                        />

                        <PillButton
                            label='Revoke approval'
                            disabled={busy || !canReview || !!pending || !!stale || denied}
                            onPress={() => review(false)}
                        />

                        {pending && <PillButton
                            label='Retry same review'
                            disabled={busy || !manualChecked || pending.item.id !== node.id || !!stale || denied}
                            onPress={() => review(pending.approved, true)}
                        />}
                    </Actions>

                    <ThesisText heading>Review history</ThesisText>

                    {detail.history.map(event => <ThesisText key={event.event_id}>{event.approved ? 'Approved' : 'Revoked'} · {event.reviewer} · {event.reviewed_at}{event.review_hash === node.reviewHash ? ' · current source' : ' · earlier source'}</ThesisText>)}

                    {moreHistory && <PillButton label='Older reviews' disabled={busy} onPress={() => void source(node.id, true)} />}
                </View>
            </GlassCard>}

            {inventory && <DependencyGraph nodes={inventory.nodes} selected={selected} onSelect={id => void source(id)} />}
        </View>
    )
}
