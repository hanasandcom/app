import { useEffect, useRef, useState } from 'react'
import { AppState, Text } from 'react-native'
import { useIsFocused } from '@react-navigation/native'
import type { AppSettings } from '../types'
import { DatabaseBrowser } from '../components/DatabaseBrowser'
import { DatabaseQuery } from '../components/DatabaseQuery'
import { GlassCard, InlineNotice, PillButton, Screen, SectionTitle } from '../components/ui'
import { useAppTheme } from '../theme/context'
import { databaseBytes, databaseScope, DatabaseError, executeDatabaseSql, loadCoreDatabaseRows, loadDatabaseAccess, loadDatabaseHealth, loadDatabaseOverview, type DatabaseAccess, type DatabaseOverview } from '../lib/database-operations'

export function DatabaseScreen({ settings }: { settings: AppSettings }) { return <DatabaseWorkspace key={databaseScope(settings)} settings={settings} /> }
function DatabaseWorkspace({ settings }: { settings: AppSettings }) {
    const theme = useAppTheme(), focused = useIsFocused()
    const [revision, setRevision] = useState(0), [page, setPage] = useState<DatabaseOverview | null>(null), [access, setAccess] = useState<DatabaseAccess | null>(null)
    const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(''), [health, setHealth] = useState(''), [reviewRequired, setReviewRequired] = useState(false), [queries, setQueries] = useState(false)
    const [signal, setSignal] = useState(new AbortController().signal), [reviewEpoch, setReviewEpoch] = useState(0)
    const active = useRef(false), epoch = useRef(0), controller = useRef<AbortController | null>(null), writing = useRef(false), live = useRef(true), blocked = useRef(false)
    const meta = { color: theme.textMuted, lineHeight: 20 }
    function invalidate() { active.current = false; epoch.current++; controller.current?.abort(); setPage(null); setAccess(null); setReviewEpoch(epoch.current) }
    useEffect(() => { live.current = true; const subscription = AppState.addEventListener('change', state => { if (state !== 'active') invalidate(); else setRevision(value => value + 1) }); return () => { live.current = false; epoch.current++; controller.current?.abort(); subscription.remove() } }, [])
    useEffect(() => {
        if (!focused || AppState.currentState !== 'active') { invalidate(); return }
        active.current = true; const current = ++epoch.current, cancel = new AbortController(); controller.current = cancel; setSignal(cancel.signal); setReviewEpoch(current); setLoading(true); setError(''); setAccess(null)
        void Promise.all([loadDatabaseOverview(settings, cancel.signal), loadDatabaseAccess(settings, cancel.signal).catch(() => null), loadDatabaseHealth(settings, cancel.signal).catch(() => null)]).then(([overview, permissions, check]) => {
            if (!live.current || cancel.signal.aborted || epoch.current !== current) return
            setPage(overview); setAccess(permissions); setHealth(check?.ok ? `Connected to ${check.database || 'Core'} · ${check.checked_at || overview.generatedAt}` : 'Connection check unavailable'); setQueries(false)
        }).catch(cause => { if (!cancel.signal.aborted && current === epoch.current) setError(message(cause)) }).finally(() => { if (!cancel.signal.aborted && current === epoch.current) setLoading(false) })
        return () => { active.current = false; epoch.current++; cancel.abort() }
    }, [focused, revision])
    function refresh() { if (writing.current) return; active.current = false; epoch.current++; controller.current?.abort(); setReviewEpoch(epoch.current); blocked.current = false; setReviewRequired(false); setRevision(value => value + 1) }
    async function runSql(sql: string, reviewed: number) {
        if (writing.current || blocked.current || !active.current || reviewed !== epoch.current || !access?.canWrite || !controller.current) return null
        writing.current = true; setBusy(true); setError(''); const current = epoch.current
        try { const result = await executeDatabaseSql(settings, access, sql, controller.current.signal); return active.current && current === epoch.current ? result : null }
        catch (cause) { if (live.current && current === epoch.current) setError(message(cause)); if (!(cause instanceof DatabaseError) || cause.uncertain || cause.status === 401 || cause.status === 403) { blocked.current = true; if (live.current) setReviewRequired(true) }; return null }
        finally { writing.current = false; if (live.current) { setBusy(false); if (current !== epoch.current) { blocked.current = true; setReviewRequired(true) } } }
    }
    async function inspect(schema: string, table: string, limit: number, reviewed: number) {
        if (busy || loading || !active.current || reviewed !== epoch.current) return null
        setLoading(true); setError('')
        try { const value = await loadCoreDatabaseRows(settings, schema, table, limit, controller.current?.signal); return active.current && reviewed === epoch.current ? value : null }
        catch (cause) { if (reviewed === epoch.current) setError(message(cause)); return null }
        finally { if (reviewed === epoch.current) setLoading(false) }
    }
    async function showQueries() {
        if (loading || busy || !active.current) return
        const current = epoch.current; setLoading(true)
        try { const value = await loadDatabaseOverview(settings, controller.current?.signal, true); if (current === epoch.current && active.current) { setPage(value); setQueries(true) } } catch (cause) { if (current === epoch.current) setError(message(cause)) } finally { if (current === epoch.current) setLoading(false) }
    }
    return <Screen title='Database' subtitle='Hanasand infrastructure · Core SQL target' right={<PillButton small label='Refresh' disabled={busy || loading} onPress={refresh} />}>
        <InlineNotice message={error} />{reviewRequired && <InlineNotice message='A statement may have executed. Refresh and review the current database state before another SQL submission. Closing the screen does not cancel server work.' />}{loading && <Text style={meta}>Loading database information…</Text>}
        {page && <><GlassCard style={{ gap: 10 }}><SectionTitle title={page.status === 'healthy' ? 'Database overview' : 'Database unavailable'} eyebrow={page.generatedAt} body={page.health?.message} /><Text style={meta}>{health}</Text><Text style={meta}>Database storage: {databaseBytes(page.totalSizeBytes)} · Active queries: {page.querySummary?.count ?? page.activeQueries ?? 'Unavailable'}</Text>{page.storage && <><Text style={meta}>Disk free: {databaseBytes(page.storage.disk.availableBytes)} / {databaseBytes(page.storage.disk.totalBytes)}</Text><Text style={meta}>Growth/day: {databaseBytes(page.storage.disk.dailyGrowthBytes)} · Full in: {page.storage.disk.daysUntilFull == null ? 'Not reported' : `${page.storage.disk.daysUntilFull.toFixed(1)} days`}</Text><Text style={meta}>Sample: {page.storage.sampledAt}{page.storage.stale ? ' · Stale' : ''}</Text></>}</GlassCard>
            <DatabaseBrowser settings={settings} instances={page.storage?.instances || []} stale={!page.storage || Boolean(page.storage.stale)} signal={signal} />
            <GlassCard style={{ gap: 10 }}><SectionTitle title='Active queries' eyebrow={`${page.querySummary?.longRunningCount ?? page.queries?.filter(query => query.isLongRunning).length ?? 0} long-running`} /><PillButton label='Load active query details' disabled={busy || loading} onPress={() => void showQueries()} />{queries && (page.queries || []).map((query, index) => <GlassCard key={index}><Text style={meta}>{query.database || 'Unknown database'} · {query.user || 'Unknown user'} · {query.state || 'Unknown state'} · {query.durationSeconds ?? '?'} seconds</Text><Text selectable style={{ color: theme.text }}>{query.query || 'Query text unavailable'}</Text></GlassCard>)}</GlassCard>
            {!access?.canWrite && <Text style={meta}>SQL is read-only for this session. Active Hanasand editing access must be verified, and impersonation must be off.</Text>}
            <DatabaseQuery disabled={!active.current || !access?.canWrite || busy || loading || reviewRequired} readDisabled={!active.current || busy || loading || reviewRequired} reviewEpoch={reviewEpoch} onRun={runSql} onInspect={inspect} />
        </>}
    </Screen>
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : 'Database information is unavailable. Refresh to try again.' }
