import { useEffect, useRef, useState } from 'react'
import { AppState, Text, type ScrollView } from 'react-native'
import { useIsFocused } from '@react-navigation/native'
import type { AppSettings } from '../types'
import { BackupActions } from '../components/BackupActions'
import { BackupFiles, BackupHistory } from '../components/BackupFiles'
import { GlassCard, InlineNotice, PillButton, Screen, SectionTitle } from '../components/ui'
import { useAppTheme } from '../theme/context'
import { databaseScope, DatabaseError, loadBackupDashboard, loadDatabaseAccess, performBackupAction, type BackupDashboard, type BackupDraft, type DatabaseAccess } from '../lib/database-operations'

export function BackupsScreen({ settings }: { settings: AppSettings }) { return <BackupWorkspace key={databaseScope(settings)} settings={settings} /> }
function BackupWorkspace({ settings }: { settings: AppSettings }) {
    const theme = useAppTheme(), focused = useIsFocused()
    const [revision, setRevision] = useState(0), [page, setPage] = useState<BackupDashboard | null>(null), [access, setAccess] = useState<DatabaseAccess | null>(null), [file, setFile] = useState('')
    const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [reviewRequired, setReviewRequired] = useState(false), [reviewEpoch, setReviewEpoch] = useState(0)
    const scroll = useRef<ScrollView>(null)
    const active = useRef(false), epoch = useRef(0), controller = useRef<AbortController | null>(null), writing = useRef(false), live = useRef(true), blocked = useRef(false)
    const meta = { color: theme.textMuted, lineHeight: 20 }
    function invalidate() { active.current = false; epoch.current++; controller.current?.abort(); setPage(null); setAccess(null); setFile(''); setNotice(''); setReviewEpoch(epoch.current) }
    useEffect(() => { live.current = true; const subscription = AppState.addEventListener('change', state => { if (state !== 'active') invalidate(); else setRevision(value => value + 1) }); return () => { live.current = false; epoch.current++; controller.current?.abort(); subscription.remove() } }, [])
    useEffect(() => {
        if (!focused || AppState.currentState !== 'active') { invalidate(); return }
        active.current = true; const current = ++epoch.current, cancel = new AbortController(); controller.current = cancel; setReviewEpoch(current); setLoading(true); setError(''); setAccess(null)
        void Promise.all([loadBackupDashboard(settings, cancel.signal), loadDatabaseAccess(settings, cancel.signal).catch(() => null)]).then(([dashboard, permissions]) => {
            if (!live.current || cancel.signal.aborted || epoch.current !== current) return
            setPage(dashboard); setAccess(permissions); setFile(previous => dashboard.files.some(item => item.file === previous) ? previous : '')
        }).catch(cause => { if (!cancel.signal.aborted && current === epoch.current) setError(message(cause)) }).finally(() => { if (!cancel.signal.aborted && current === epoch.current) setLoading(false) })
        return () => { active.current = false; epoch.current++; cancel.abort() }
    }, [focused, revision])
    function refresh() { if (writing.current) return; active.current = false; epoch.current++; controller.current?.abort(); setReviewEpoch(epoch.current); blocked.current = false; setReviewRequired(false); setRevision(value => value + 1) }
    async function run(draft: BackupDraft, reviewed: number) {
        if (writing.current || blocked.current || !active.current || reviewed !== epoch.current || !page || !access?.canWrite || !controller.current) return
        writing.current = true; setBusy(true); setError(''); setNotice(''); const current = epoch.current
        try {
            const result = await performBackupAction(settings, access, page, draft, controller.current.signal)
            if (live.current && current === epoch.current && active.current) { setNotice(`${result.message} Status: ${result.operation.status}.`); setReviewRequired(true); blocked.current = true }
        } catch (cause) {
            if (live.current && current === epoch.current) setError(message(cause))
            if (!(cause instanceof DatabaseError) || cause.uncertain || cause.status === 409 || cause.status === 401 || cause.status === 403) { blocked.current = true; if (live.current) setReviewRequired(true) }
        } finally { writing.current = false; if (live.current) { setBusy(false); if (current !== epoch.current) { blocked.current = true; setReviewRequired(true) } } }
    }
    const disabled = !active.current || !access?.canWrite || busy || loading || reviewRequired || Boolean(page?.backups.some(service => service.currentOperation)) || Boolean(page?.errors.length)
    return <Screen scrollViewRef={scroll} title='Backups' subtitle='Configured Core database · Hanasand infrastructure' right={<PillButton small label='Refresh' disabled={busy || loading} onPress={refresh} />}>
        <InlineNotice message={error} /><InlineNotice message={notice} tone='success' />{reviewRequired && <InlineNotice message='Refresh and review the current archives and operation history before another submission. Server operations may continue after this screen closes.' />}{loading && <Text style={meta}>Loading backup information…</Text>}
        {page && <>{page.errors.map((value, index) => <InlineNotice key={index} message={value} />)}{page.backups.map(service => <GlassCard key={service.id} style={{ gap: 10 }}><SectionTitle title={service.database || service.name} eyebrow={service.status} />
            <Text style={meta}>Last attempt: {service.lastAttempt || 'Never'}{`\nLast success: ${service.lastSuccess || 'Never'}\nLast failure: ${service.lastFailure || 'Never'}`}</Text>
            <Text style={meta}>Schedule: {service.scheduleEnabled ? `${service.schedule || 'Automatic'} ${service.scheduleTimezone || 'UTC'}` : 'Paused'}{`\nNext run: ${service.nextBackup || 'Not scheduled'}\nRetention: ${service.retention || 'Not reported'}\nStorage: ${service.storageTarget || 'Not reported'}`}</Text>
            <Text style={meta}>Latest archive: {service.latestFile || 'Not recorded'} · {service.latestSize || 'Size unavailable'} · {service.latestDuration || 'Duration unavailable'}</Text>
            {service.retentionOutcome && <Text style={meta}>Retention: {service.retentionOutcome.examined} examined / {service.retentionOutcome.deleted} deleted · Cutoff {service.retentionOutcome.cutoffAt}</Text>}
            <Text selectable style={meta}>Latest checksum: {service.latestChecksum || 'Not recorded'}{`\nVerified: ${service.latestVerifiedAt || 'Not recorded'}\nRelease: ${service.releaseCommit || 'Not recorded'}`}</Text>
            {service.currentOperation && <InlineNotice message={`${service.currentOperation.kind} is ${service.currentOperation.status}: ${service.currentOperation.stage}. Refresh to follow progress.`} />}{(service.error || service.lastError) && <InlineNotice message={service.error || service.lastError || ''} />}
        </GlassCard>)}
        {!access?.canWrite && <Text style={meta}>Backup changes require verified active Hanasand owner, administrator or editor access. Impersonation is read-only.</Text>}
        <BackupActions dashboard={page} file={file} disabled={disabled} reviewEpoch={reviewEpoch} onRun={(draft, reviewed) => void run(draft, reviewed)} />
        <BackupFiles files={page.files} selected={file} onSelect={value => { if (!writing.current && !loading) { setFile(value); setReviewEpoch(++epoch.current); scroll.current?.scrollTo({ y: 0, animated: false }) } }} />
        <BackupHistory operations={page.backups.flatMap(service => service.operations)} />
        </>}
    </Screen>
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : 'Backup information is unavailable. Refresh to try again.' }
