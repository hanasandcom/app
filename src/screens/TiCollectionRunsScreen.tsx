import { useEffect, useMemo, useRef, useState } from 'react'
import { AppState, Text, View } from 'react-native'
import { useIsFocused } from '@react-navigation/native'
import type { AppSettings } from '../types'
import { GlassCard, InlineNotice, PillButton, Screen, SectionTitle, StatChip } from '../components/ui'
import { useAppTheme } from '../theme/context'
import { loadTiCollectionRuns, tiRunsAccountKey, type TiCollectionRunsPage } from '../lib/ti-runs'

type Snapshot = { page: number; data: TiCollectionRunsPage | null; loading: boolean; error: string }
export function TiCollectionRunsScreen({ settings }: { settings: AppSettings }) {
    return <TiCollectionRunsWorkspace key={tiRunsAccountKey(settings)} settings={settings} />
}

function TiCollectionRunsWorkspace({ settings }: { settings: AppSettings }) {
    const theme = useAppTheme(), focused = useIsFocused()
    const [foreground, setForeground] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive')
    const [page, setPage] = useState(1), [revision, setRevision] = useState(0)
    const [snapshot, setSnapshot] = useState<Snapshot>({ page: 1, data: null, loading: true, error: '' })
    const epoch = useRef(0), read = useRef<AbortController | null>(null)
    const current = snapshot.page === page ? snapshot : null
    const data = current?.data || null, loading = !current || current.loading
    const meta = useMemo(() => ({ color: theme.textMuted, fontSize: 13, lineHeight: 19 }), [theme.textMuted])
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
        setSnapshot(previous => ({ page, data: previous.page === page ? previous.data : null, loading: true, error: '' }))
        void loadTiCollectionRuns(settings, page, controller.signal).then(value => {
            if (!controller.signal.aborted && generation === epoch.current) setSnapshot({ page, data: value, loading: false, error: '' })
        }).catch(reason => {
            if (!controller.signal.aborted && generation === epoch.current) setSnapshot(previous => ({ page, data: previous.page === page ? previous.data : null, loading: false, error: reason instanceof Error ? reason.message : 'Collection history is unavailable.' }))
        })
        return () => { controller.abort(); epoch.current++ }
    }, [focused, foreground, page, revision, settings])

    const runs = data?.runs || []
    const totals = {
        active: runs.filter(run => run.status === 'queued' || run.status === 'running').length,
        completed: runs.filter(run => run.status === 'completed').length,
        failed: runs.filter(run => run.status === 'failed').length,
        evidence: runs.reduce((sum, run) => sum + run.captures, 0),
    }
    const nextPage = data?.nextPage || (data && data.page * data.limit < data.total ? data.page + 1 : null)

    return <Screen title='TI collection' subtitle='Global collector run history · internal access required' right={<PillButton small label={loading ? 'Loading…' : 'Refresh'} disabled={loading} onPress={() => setRevision(value => value + 1)} />}>
        {!!current?.error && <InlineNotice message={current.error} />}
        {data && <GlassCard style={{ gap: 12 }}>
            <SectionTitle eyebrow='Collection history' title={`${data.total.toLocaleString()} total runs`} body={`Page ${data.page} · ${data.runs.length} shown`} />
            <View style={row}>
                <StatChip label='Active' value={String(totals.active)} />
                <StatChip label='Completed' value={String(totals.completed)} />
                <StatChip label='Failed' value={String(totals.failed)} />
                <StatChip label='Captures' value={totals.evidence.toLocaleString()} />
            </View>
            <View style={row}>
                <PillButton small label='Previous page' disabled={loading || !data.previousPage} onPress={() => { if (data.previousPage) setPage(data.previousPage) }} />
                <PillButton small label='Next page' disabled={loading || !nextPage} onPress={() => { if (nextPage) setPage(nextPage) }} />
            </View>
        </GlassCard>}
        {!data && loading && <Text accessibilityRole='progressbar' style={meta}>Loading collection history…</Text>}
        {!data && !loading && <GlassCard><Text style={meta}>Collection history is unavailable. Refresh to try again.</Text></GlassCard>}
        {data && <GlassCard style={{ gap: 14 }}>
            <SectionTitle eyebrow='Collector activity' title={`${runs.length} runs`} body='Newest collection activity first.' />
            {!runs.length && <Text style={meta}>No collection runs are recorded for this page.</Text>}
            {runs.map(run => <View key={run.id} style={{ gap: 6, paddingVertical: 12, borderBottomWidth: 1, borderColor: theme.surfaceBorderSoft }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <Text numberOfLines={2} style={{ flex: 1, color: theme.text, fontSize: 15, fontWeight: '700' }}>{run.sourceName}</Text>
                    <Text style={{ color: run.status === 'failed' ? theme.danger : run.status === 'completed' ? theme.success : theme.accent, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }}>{run.status}</Text>
                </View>
                <Text style={meta}>{run.sourceFamily} · {run.trigger} · {formatDate(run.startedAt)}</Text>
                <Text style={meta}>{run.captures.toLocaleString()} captures · {run.screenshots.toLocaleString()} screenshots · {run.rows.toLocaleString()} rows</Text>
                {!!run.finishedAt && <Text style={meta}>Finished {formatDate(run.finishedAt)}</Text>}
            </View>)}
            <View style={row}>
                <PillButton small label='Previous page' disabled={loading || !data.previousPage} onPress={() => { if (data.previousPage) setPage(data.previousPage) }} />
                <PillButton small label='Next page' disabled={loading || !nextPage} onPress={() => { if (nextPage) setPage(nextPage) }} />
            </View>
        </GlassCard>}
    </Screen>
}

function formatDate(value: string) {
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Oslo' }) : 'not recorded'
}
