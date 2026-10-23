import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, AppState, Switch, Text, TextInput, View } from 'react-native'
import { useIsFocused } from '@react-navigation/native'
import type { AppSettings } from '../types'
import { GlassCard, InlineNotice, PillButton, Screen, SectionTitle } from '../components/ui'
import { useAppTheme } from '../theme/context'
import { createScannerApi, scannerEngineLabel, scannerHasActiveWork, type ScannerAsset, type ScannerDashboard, type ScannerEngineId, type ScannerFinding, type ScannerRun } from '../features/scanner/api'

const launchableEngines: ScannerEngineId[] = ['nmap', 'naabu', 'tenable-vm', 'gvm', 'zap', 'testssl', 'nuclei']
const runningStatuses = new Set(['queued', 'running', 'cancelling', 'pending'])

export function SecurityScannerScreen({ settings }: { settings: AppSettings }) {
    const key = JSON.stringify([settings.apiBaseUrl, settings.userId, settings.authToken, settings.selectedOrganizationId, settings.impersonationToken])
    return <ScannerWorkspace key={key} settings={settings} />
}

function ScannerWorkspace({ settings }: { settings: AppSettings }) {
    const theme = useAppTheme(), focused = useIsFocused()
    const [foreground, setForeground] = useState(AppState.currentState === 'active')
    const [dashboard, setDashboard] = useState<ScannerDashboard | null>(null)
    const [hostname, setHostname] = useState(''), [authorized, setAuthorized] = useState<Record<string, boolean>>({})
    const [assessmentEngines, setAssessmentEngines] = useState<ScannerEngineId[]>(['nmap'])
    const [loading, setLoading] = useState(true), [busy, setBusy] = useState(''), [error, setError] = useState(''), [revision, setRevision] = useState(0)
    const mounted = useRef(true), pending = useRef(false), activeWork = useRef(false)
    const organizationId = settings.selectedOrganizationId
    const api = useMemo(() => { try { return createScannerApi(settings) } catch { return null } }, [settings])
    const personal = !organizationId || organizationId === 'personal'

    useEffect(() => {
        mounted.current = true
        const subscription = AppState.addEventListener('change', state => setForeground(state === 'active'))
        return () => { mounted.current = false; subscription.remove() }
    }, [])

    const refresh = useCallback(async (quiet = false) => {
        if (!api || personal) {
            setLoading(false)
            if (!personal && (!settings.userId || !settings.authToken)) setError('Sign in to use Security Scanner.')
            return
        }
        if (pending.current) return
        pending.current = true
        if (!quiet) setLoading(true)
        try {
            const data = await api.getDashboard()
            if (!mounted.current) return
            setDashboard(data); activeWork.current = scannerHasActiveWork(data); setError(data.scannerError || '')
        } catch (cause) {
            if (!mounted.current) return
            setError(cause instanceof Error ? cause.message : 'Scanner service is unavailable.')
        } finally {
            pending.current = false
            if (mounted.current) setLoading(false)
        }
    }, [api, personal, settings.authToken, settings.userId])

    useEffect(() => {
        if (!focused || !foreground || personal) return
        let timer: ReturnType<typeof setTimeout> | undefined
        let active = true
        const poll = async () => {
            await refresh(true)
            if (!active) return
            timer = setTimeout(() => { void poll() }, activeWork.current ? 8_000 : 30_000)
        }
        void refresh().finally(() => { if (active) timer = setTimeout(() => { void poll() }, activeWork.current ? 8_000 : 30_000) })
        return () => { active = false; if (timer) clearTimeout(timer) }
    }, [focused, foreground, personal, revision, refresh])

    async function createAsset() {
        const value = hostname.trim().toLowerCase()
        if (!api || busy || !value || value.length > 253) return
        setBusy('asset'); setError('')
        try { await api.createAsset(value); setHostname(''); setRevision(current => current + 1) }
        catch (cause) { setError(cause instanceof Error ? cause.message : 'The asset could not be added.') }
        finally { setBusy('') }
    }

    function verifyAsset(asset: ScannerAsset) {
        Alert.alert('Verify domain control?', `Scanner will check the DNS TXT record for ${asset.hostname}. Publish the record shown below first.`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Check DNS record', onPress: () => { void (async () => {
                if (!api || busy) return
                setBusy(asset.id); setError('')
                try { await api.verifyAsset(asset.id); setRevision(value => value + 1) }
                catch (cause) { setError(cause instanceof Error ? cause.message : 'DNS verification could not be completed.') }
                finally { setBusy('') }
            })() } },
        ])
    }

    function launchScan(asset: ScannerAsset, engine: ScannerEngineId) {
        if (!api || busy || asset.verificationStatus !== 'verified' || (!asset.scanAuthorizedAt && authorized[asset.id] !== true)) return
        const enabledTemplates = (dashboard?.tenableScans || []).filter(scan => scan.enabled)
        if (engine === 'tenable-vm' && !enabledTemplates.length) { setError('No enabled Tenable VM scan template is available for this organization.'); return }
        const template = enabledTemplates[0]
        Alert.alert(`Run ${scannerEngineLabel(engine)} scan?`, `This queues work on Hanasand’s scanner server for ${asset.hostname}. Confirm that you have authorization to scan this domain.`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Queue scan', onPress: () => { void (async () => {
                if (!api || busy) return
                setBusy(`${asset.id}:${engine}`); setError('')
                try { await api.startScan(asset.id, engine, true, template?.id); setRevision(value => value + 1) }
                catch (cause) { setError(cause instanceof Error ? cause.message : `${scannerEngineLabel(engine)} scan could not start.`) }
                finally { setBusy('') }
            })() } },
        ])
    }

    function cancelRun(run: ScannerRun) {
        if (!api || busy) return
        Alert.alert('Cancel this scan?', `${scannerEngineLabel(run.engine)} on ${run.target} will be asked to stop.`, [
            { text: 'Keep running', style: 'cancel' },
            { text: 'Cancel scan', style: 'destructive', onPress: () => { void (async () => {
                if (!api || busy) return
                setBusy(run.id); setError('')
                try { await api.cancelRun(run.id); setRevision(value => value + 1) }
                catch (cause) { setError(cause instanceof Error ? cause.message : 'The scan could not be cancelled.') }
                finally { setBusy('') }
            })() } },
        ])
    }

    function updateFinding(finding: ScannerFinding, status: string) {
        if (!api || busy) return
        Alert.alert(`${status.replaceAll('_', ' ')}?`, `Update “${finding.title}” for ${finding.asset}?`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Update finding', onPress: () => { void (async () => {
                if (!api || busy) return
                setBusy(finding.id); setError('')
                try { await api.updateFinding(finding.id, status); setRevision(value => value + 1) }
                catch (cause) { setError(cause instanceof Error ? cause.message : 'The finding could not be updated.') }
                finally { setBusy('') }
            })() } },
        ])
    }

    function scheduleAsset(asset: ScannerAsset, enabled: boolean) {
        if (!api || busy) return
        const action = enabled ? 'Enable daily Nmap scans' : 'Pause recurring scans'
        Alert.alert(`${action}?`, enabled
            ? `This will run a standard Nmap scan on ${asset.hostname} every 24 hours from Hanasand’s scanner server. Confirm you control this domain or have permission to scan it.`
            : `Future scheduled scans for ${asset.hostname} will be paused.`, [
            { text: 'Cancel', style: 'cancel' },
            { text: action, onPress: () => { void (async () => {
                if (!api || busy) return
                setBusy(`${asset.id}:schedule`); setError('')
                try { await api.scheduleAsset(asset.id, { enabled, intervalMinutes: enabled ? 1440 : asset.intervalMinutes || 1440, authorized: true }); setRevision(value => value + 1) }
                catch (cause) { setError(cause instanceof Error ? cause.message : 'The scan schedule could not be updated.') }
                finally { setBusy('') }
            })() } },
        ])
    }

    function startAssessment() {
        if (!api || busy || !dashboard) return
        const assets = dashboard.assets.filter(asset => asset.verificationStatus === 'verified')
        const engines = dashboard.engines.filter(engine => engine.status === 'available' && assessmentEngines.includes(engine.id as ScannerEngineId)).map(engine => engine.id as ScannerEngineId)
        if (!assets.length) { setError('Verify at least one asset before starting an assessment.'); return }
        if (!engines.length) { setError('Select an available scan engine for this assessment.'); return }
        Alert.alert('Start security assessment?', `This queues ${engines.map(scannerEngineLabel).join(', ')} scans for ${assets.length} verified organization assets on Hanasand’s scanner server. Confirm that you are authorized to scan all selected domains.`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Queue assessment', onPress: () => { void (async () => {
                if (!api || busy) return
                setBusy('assessment'); setError('')
                try { await api.startAssessment(assets.map(asset => asset.id), engines, true); setRevision(value => value + 1) }
                catch (cause) { setError(cause instanceof Error ? cause.message : 'The security assessment could not start.') }
                finally { setBusy('') }
            })() } },
        ])
    }

    function cancelAssessment(assessmentId: string) {
        if (!api || busy) return
        Alert.alert('Cancel assessment?', 'The server will be asked to cancel the assessment and its queued scan jobs.', [
            { text: 'Keep running', style: 'cancel' },
            { text: 'Cancel assessment', style: 'destructive', onPress: () => { void (async () => {
                if (!api || busy) return
                setBusy(assessmentId); setError('')
                try { await api.cancelAssessment(assessmentId); setRevision(value => value + 1) }
                catch (cause) { setError(cause instanceof Error ? cause.message : 'The assessment could not be cancelled.') }
                finally { setBusy('') }
            })() } },
        ])
    }

    return <Screen title='Security Scanner' subtitle={personal ? 'Select an organization workspace to continue' : 'Organization-scoped · runs on Hanasand servers'} right={<PillButton small label={loading ? 'Loading…' : 'Refresh'} disabled={loading || personal} onPress={() => setRevision(value => value + 1)} />}>
        {personal && <InlineNotice tone='info' message='Choose an organization workspace from the workspace selector to view and run security scans.' />}
        {!!error && <InlineNotice title='Scanner service' message={error} />}
        {!personal && loading && !dashboard && <ActivityIndicator accessibilityLabel='Loading scanner workspace' color={theme.accent} />}
        {!personal && !loading && !dashboard && <GlassCard style={{ gap: 8 }}><SectionTitle eyebrow='Scanner workspace' title='No scanner data yet' body='Refresh to check the organization scanner API. No scan is started automatically.' /><PillButton label='Try again' onPress={() => setRevision(value => value + 1)} /></GlassCard>}
        {!!dashboard && <>
            <GlassCard style={{ gap: 12 }}>
                <SectionTitle eyebrow='Organization assets' title={`${dashboard.assets.length} ${dashboard.assets.length === 1 ? 'asset' : 'assets'}`} body='Add an owned domain, publish its DNS proof, then queue scans against verified assets.' />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <TextInput accessibilityLabel='Domain to add' value={hostname} onChangeText={setHostname} autoCapitalize='none' autoCorrect={false} keyboardType='url' placeholder='example.com' placeholderTextColor={theme.textSoft} style={{ flex: 1, minHeight: 44, borderWidth: 1, borderColor: theme.surfaceBorderSoft, borderRadius: 14, paddingHorizontal: 12, color: theme.text, backgroundColor: theme.backgroundRaised }} />
                    <PillButton small label={busy === 'asset' ? 'Adding…' : 'Add domain'} disabled={!hostname.trim() || !!busy} onPress={() => void createAsset()} />
                </View>
            </GlassCard>
            {dashboard.assets.map(asset => <GlassCard key={asset.id} style={{ gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                    <View style={{ flex: 1, gap: 3 }}><Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>{asset.hostname}</Text><Text style={{ color: asset.verificationStatus === 'verified' ? theme.success : theme.warning, fontSize: 12, fontWeight: '700' }}>{asset.verificationStatus === 'verified' ? 'Verified' : asset.verificationStatus === 'disabled' ? 'Disabled' : 'DNS verification needed'}</Text></View>
                    {asset.verificationStatus !== 'verified' && <PillButton small label={busy === asset.id ? 'Checking…' : 'Check DNS'} disabled={!!busy} onPress={() => verifyAsset(asset)} />}
                </View>
                {asset.verificationStatus !== 'verified' && <View style={{ gap: 5, padding: 10, borderRadius: 12, backgroundColor: theme.backgroundRaised }}>
                    <Text style={{ color: theme.textMuted, fontSize: 12 }}>Publish this DNS TXT record</Text>
                    <Text selectable style={{ color: theme.text, fontSize: 12 }}>Name: {asset.verificationRecordName}</Text>
                    <Text selectable style={{ color: theme.text, fontSize: 12 }}>Value: {asset.verificationRecordValue}</Text>
                </View>}
                {asset.verificationStatus === 'verified' && !asset.scanAuthorizedAt && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Switch accessibilityLabel={`Confirm authorization to scan ${asset.hostname}`} value={authorized[asset.id] === true} onValueChange={value => setAuthorized(current => ({ ...current, [asset.id]: value }))} trackColor={{ true: theme.accent }} /><Text style={{ flex: 1, color: theme.textMuted, fontSize: 12, lineHeight: 18 }}>I have permission to scan this domain.</Text></View>}
                {asset.verificationStatus === 'verified' && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {dashboard.engines.filter(engine => launchableEngines.includes(engine.id as ScannerEngineId)).map(engine => {
                        const enabled = engine.status === 'available' && !busy && (!!asset.scanAuthorizedAt || authorized[asset.id] === true)
                        return <PillButton key={engine.id} small label={busy === `${asset.id}:${engine.id}` ? 'Queueing…' : scannerEngineLabel(engine.id)} disabled={!enabled} onPress={() => launchScan(asset, engine.id as ScannerEngineId)} />
                    })}
                </View>}
                {asset.verificationStatus === 'verified' && <View style={{ gap: 5, paddingTop: 4 }}>
                    <Text style={{ color: theme.textMuted, fontSize: 12 }}>{asset.scheduleEnabled ? `Daily Nmap schedule · next ${formatDate(asset.nextRunAt || '')}` : 'No recurring scan schedule'}</Text>
                    <PillButton small label={busy === `${asset.id}:schedule` ? 'Saving…' : asset.scheduleEnabled ? 'Pause schedule' : 'Enable daily Nmap'} disabled={!!busy} onPress={() => scheduleAsset(asset, !asset.scheduleEnabled)} />
                </View>}
            </GlassCard>)}
            <GlassCard style={{ gap: 10 }}>
                <SectionTitle eyebrow='Assessment' title='Queue scans across verified assets' body='A single server-side assessment groups engine runs and reports their progress together.' />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {dashboard.engines.filter(engine => launchableEngines.includes(engine.id as ScannerEngineId)).map(engine => {
                        const selected = assessmentEngines.includes(engine.id as ScannerEngineId)
                        return <View key={engine.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><Switch accessibilityLabel={`Include ${engine.name} in assessment`} value={selected} disabled={engine.status !== 'available'} onValueChange={value => setAssessmentEngines(current => value ? [...new Set([...current, engine.id as ScannerEngineId])] : current.filter(id => id !== engine.id))} trackColor={{ true: theme.accent }} /><Text style={{ color: engine.status === 'available' ? theme.textMuted : theme.textSoft, fontSize: 12 }}>{engine.name}</Text></View>
                    })}
                </View>
                <PillButton label={busy === 'assessment' ? 'Queueing…' : 'Start assessment'} disabled={!!busy || !dashboard.assets.some(asset => asset.verificationStatus === 'verified')} onPress={startAssessment} />
                {dashboard.assessments.map(assessment => <View key={assessment.id} style={{ gap: 5, paddingVertical: 10, borderTopWidth: 1, borderColor: theme.surfaceBorderSoft }}>
                    <View style={{ flexDirection: 'row', gap: 8 }}><Text style={{ flex: 1, color: theme.text, fontWeight: '700' }}>Assessment · {assessment.status}</Text><Text style={{ color: theme.textSoft, fontSize: 11 }}>{formatDate(assessment.createdAt)}</Text></View>
                    {assessment.jobs.slice(0, 12).map(job => <Text key={job.id} style={{ color: theme.textMuted, fontSize: 12 }}>{scannerEngineLabel(job.engine)} · {job.asset} · {job.status}{job.error ? ` · ${job.error}` : ''}</Text>)}
                    {runningStatuses.has(assessment.status.toLowerCase()) && <PillButton small tone='danger' label={busy === assessment.id ? 'Cancelling…' : 'Cancel assessment'} disabled={!!busy} onPress={() => cancelAssessment(assessment.id)} />}
                </View>)}
            </GlassCard>
            <GlassCard style={{ gap: 10 }}>
                <SectionTitle eyebrow='Live work' title={`${dashboard.runs.length} recent scans`} body='Status refreshes while this screen is open. Jobs execute on the Hanasand scanner server.' />
                {!dashboard.runs.length && <Text style={{ color: theme.textMuted, fontSize: 13 }}>No recent scans for this organization.</Text>}
                {dashboard.runs.slice(0, 30).map(run => <View key={run.id} style={{ gap: 4, paddingVertical: 10, borderTopWidth: 1, borderColor: theme.surfaceBorderSoft }}>
                    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><Text style={{ flex: 1, color: theme.text, fontSize: 14, fontWeight: '700' }}>{scannerEngineLabel(run.engine)} · {run.target}</Text><Text style={{ color: runningStatuses.has(run.status.toLowerCase()) ? theme.warning : theme.textMuted, fontSize: 12, textTransform: 'capitalize' }}>{run.status}</Text></View>
                    {!!run.error && <Text style={{ color: theme.danger, fontSize: 12 }}>{run.error}</Text>}
                    <Text style={{ color: theme.textSoft, fontSize: 11 }}>{formatDate(run.startedAt || run.createdAt)}{run.finishedAt ? ` · Finished ${formatDate(run.finishedAt)}` : ''}</Text>
                    {runningStatuses.has(run.status.toLowerCase()) && <PillButton small label={busy === run.id ? 'Cancelling…' : 'Cancel scan'} tone='danger' disabled={!!busy} onPress={() => cancelRun(run)} />}
                </View>)}
            </GlassCard>
            <GlassCard style={{ gap: 8 }}>
                <SectionTitle eyebrow='Engines' title='Server availability' body='Unavailable engines cannot be queued. Scanner API and worker health come from the selected organization’s server response.' />
                {dashboard.engines.map(engine => <View key={engine.id} style={{ flexDirection: 'row', gap: 8, paddingVertical: 6, borderTopWidth: 1, borderColor: theme.surfaceBorderSoft }}><Text style={{ flex: 1, color: theme.text, fontSize: 13 }}>{engine.name}</Text><Text style={{ color: engine.status === 'available' ? theme.success : theme.textMuted, fontSize: 12 }}>{engine.status}</Text></View>)}
            </GlassCard>
            {!!dashboard.findings.length && <GlassCard style={{ gap: 8 }}><SectionTitle eyebrow='Findings' title={`${dashboard.findings.length} current findings`} body='Review severity and update each finding’s triage state.' />{dashboard.findings.slice(0, 30).map(finding => <View key={finding.id} style={{ gap: 5, paddingVertical: 8, borderTopWidth: 1, borderColor: theme.surfaceBorderSoft }}><Text style={{ color: theme.text, fontSize: 13, fontWeight: '700' }}>{finding.title}</Text><Text style={{ color: theme.textMuted, fontSize: 12 }}>{finding.asset} · {scannerEngineLabel(finding.engine)} · {finding.severity} · {finding.status.replaceAll('_', ' ')}</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{[['in_progress', 'In progress'], ['accepted_risk', 'Accept risk'], ['false_positive', 'False positive'], ['resolved', 'Resolved']].filter(([status]) => status !== finding.status).map(([status, label]) => <PillButton key={status} small label={busy === finding.id ? 'Saving…' : label} disabled={!!busy} onPress={() => updateFinding(finding, status)} />)}</View></View>)}</GlassCard>}
        </>}
    </Screen>
}

function formatDate(value: string) {
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Date unavailable'
}
