import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native'
import { CalendarClock, Play, RefreshCw } from 'lucide-react-native'
import { createAutomation, deleteAutomation, fetchAutomationDetails, fetchAutomationOverview, runAutomationNow, updateAutomation } from '../lib/api'
import { automationEditError, automationInitialTab, automationReadCurrent, automationSelection, automationSavePayload, defaultJsonRule, monitoringTypes, newAutomationDraft, toAutomationDraft, validateAutomationDraft } from '../lib/automation-contract'
import type { AgentAutomation, AgentAutomationPayload, AgentAutomationRun, AppSettings } from '../types'
import { changeWorkspaceCronJob, loadWorkspaceCronJobs, workspaceAccountKey, type WorkspaceCronJob } from '../lib/workspace-data'
import { GlassCard, InlineNotice, PillButton, Screen } from '../components/ui'
import { spacing, type ThemePalette } from '../theme/tokens'
import { useAppTheme } from '../theme/context'

const defaultRunAt = () => new Date(Date.now() + 5 * 60_000).toISOString()
const defaultTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

export function AutomationsScreen({ settings, section = 'cron', initialAutomationId }: { settings: AppSettings; section?: 'health' | 'cron'; initialAutomationId?: string }) {
    return <AccountAutomations key={JSON.stringify([workspaceAccountKey(settings), settings.authToken, settings.impersonationToken, section, initialAutomationId || ''])} settings={settings} section={section} initialAutomationId={initialAutomationId} />
}

function AccountAutomations({ settings, section, initialAutomationId }: { settings: AppSettings; section: 'health' | 'cron'; initialAutomationId?: string }) {
    const theme = useAppTheme()
    const styles = useMemo(() => createStyles(theme), [theme])
    const [automations, setAutomations] = useState<AgentAutomation[]>([])
    const [runs, setRuns] = useState<AgentAutomationRun[]>([])
    const [cronJobs, setCronJobs] = useState<WorkspaceCronJob[]>([])
    const [cronError, setCronError] = useState('')
    const [automationError, setAutomationError] = useState('')
    const [runsError, setRunsError] = useState('')
    const [cronBusy, setCronBusy] = useState('')
    const [cronDrafts, setCronDrafts] = useState<Record<string, string>>({})
    const [showEditor, setShowEditor] = useState(false)
    const [tab, setTab] = useState<'cron' | 'personal'>(() => automationInitialTab(section))
    const [canManageSystem, setCanManageSystem] = useState(false)
    const active = useRef(true)
    const detailsSequence = useRef(0)
    const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const [selectedId, setSelectedId] = useState(initialAutomationId || '')
    const [busy, setBusy] = useState('')
    const [draft, setDraft] = useState<AgentAutomationPayload>(() => newAutomationDraft(section, defaultTimezone()))

    const selected = automations.find(item => item.id === selectedId) || null
    const cronRunning = cronJobs.filter(job => job.running).length
    const cronWithErrors = cronJobs.filter(job => !!job.lastError || ['failed', 'error'].includes(job.status.toLowerCase())).length

    useEffect(() => {
        active.current = true
        void load()
        if (section === 'cron') void loadCronJobs()
        return () => { active.current = false; detailsSequence.current += 1; if (retryTimer.current) clearTimeout(retryTimer.current) }
    }, [])

    async function loadCronJobs(attempt = 0) {
        if (retryTimer.current) clearTimeout(retryTimer.current)
        setCronBusy('load')
        setCronError('')
        try {
            const result = await loadWorkspaceCronJobs(settings)
            if (!active.current) return
            setCronJobs(result.jobs)
            if (!result.ready) {
                setCronError('Live job status is refreshing.')
                if (attempt < 3) retryTimer.current = setTimeout(() => void loadCronJobs(attempt + 1), 1500)
            }
        } catch (error) { if (active.current) setCronError(error instanceof Error ? error.message : 'Unable to load cron jobs.') }
        finally { if (active.current) setCronBusy('') }
    }

    async function load(selectId = selectedId) {
        if (!active.current) return
        const request = ++detailsSequence.current
        setBusy('load')
        setAutomationError('')
        try {
            const overview = await fetchAutomationOverview(settings, section === 'cron' ? 'personal' : undefined)
            const next = overview.automations
            if (!automationReadCurrent(active.current, request, detailsSequence.current)) return
            setCanManageSystem(overview.canManageSystem)
            setAutomations(next)
            const selection = automationSelection(next, selectId, !!initialAutomationId)
            const nextSelected = selection.id
            setSelectedId(nextSelected)
            setRuns([])
            setRunsError('')
            if (selection.missing) {
                setShowEditor(false)
                setAutomationError(`Requested health check ${selectId} is unavailable for this account.`)
                return
            }
            if (nextSelected) {
                const details = await fetchAutomationDetails(settings, nextSelected)
                if (!automationReadCurrent(active.current, request, detailsSequence.current)) return
                if (initialAutomationId && (!details.automation || details.automation.id !== nextSelected)) {
                    setShowEditor(false)
                    setAutomationError(`Requested health check ${nextSelected} is unavailable for this account.`)
                    return
                }
                setRuns(details.runs)
                if (details.automation) {
                    setDraft(toAutomationDraft(details.automation))
                    if (initialAutomationId) setShowEditor(true)
                    setAutomations(rows => rows.map(row => row.id === details.automation!.id ? details.automation! : row))
                }
            } else {
                setRuns([])
            }
        } catch (error) {
            if (automationReadCurrent(active.current, request, detailsSequence.current)) {
                if (initialAutomationId) setShowEditor(false)
                setAutomationError(error instanceof Error ? error.message : section === 'health' ? 'Unable to load health checks.' : 'Unable to load personal jobs.')
            }
        } finally {
            if (automationReadCurrent(active.current, request, detailsSequence.current)) setBusy('')
        }
    }

    async function selectAutomation(automation: AgentAutomation) {
        const request = ++detailsSequence.current
        setRuns([])
        setRunsError('')
        setShowEditor(true)
        setSelectedId(automation.id)
        setDraft(toAutomationDraft(automation))
        setBusy(`select-${automation.id}`)
        try {
            const details = await fetchAutomationDetails(settings, automation.id)
            if (automationReadCurrent(active.current, request, detailsSequence.current)) {
                setRuns(details.runs)
                if (details.automation) {
                    setDraft(toAutomationDraft(details.automation))
                    setAutomations(rows => rows.map(row => row.id === details.automation!.id ? details.automation! : row))
                }
            }
        } catch (error) {
            if (automationReadCurrent(active.current, request, detailsSequence.current)) setRunsError(error instanceof Error ? error.message : 'Unable to load runs.')
        } finally {
            if (automationReadCurrent(active.current, request, detailsSequence.current)) setBusy('')
        }
    }

    async function save() {
        if (busy) return
        const validation = validateAutomationDraft(draft, selected, canManageSystem)
        if (validation) { Alert.alert('Check settings', validation); return }
        const payload = automationSavePayload(draft)
        setBusy('save')
        try {
            const automation = selected
                ? await updateAutomation(settings, selected.id, payload)
                : await createAutomation(settings, payload)
            if (!active.current) return
            setSelectedId(automation?.id || '')
            if (automation) setDraft(toAutomationDraft(automation))
            await load(automation?.id || '')
        } catch (error) {
            Alert.alert('Unable to save automation', error instanceof Error ? error.message : 'Request failed.')
        } finally {
            if (active.current) setBusy('')
        }
    }

    async function remove() {
        if (!selected || busy) return
        setBusy('delete')
        try {
            await deleteAutomation(settings, selected.id)
            if (!active.current) return
            newAutomation()
            await load('')
        } catch (error) {
            Alert.alert('Unable to remove automation', error instanceof Error ? error.message : 'Request failed.')
        } finally {
            if (active.current) setBusy('')
        }
    }

    async function runNow() {
        if (!selected || busy) return
        setBusy('run')
        try {
            await runAutomationNow(settings, selected.id)
            if (!active.current) return
            await load(selected.id)
        } catch (error) {
            Alert.alert('Unable to queue run', error instanceof Error ? error.message : 'Request failed.')
        } finally {
            if (active.current) setBusy('')
        }
    }

    async function changeCron(job: WorkspaceCronJob, patch: { schedule?: string, enabled?: boolean, action?: 'run_now' }) {
        if (cronBusy) return
        setCronBusy(job.id)
        setCronError('')
        try { setCronJobs(await changeWorkspaceCronJob(settings, job, patch)) }
        catch (error) { setCronError(error instanceof Error ? error.message : 'Unable to update cron job.') }
        finally { setCronBusy('') }
    }

    function newAutomation() {
        detailsSequence.current += 1
        setBusy(value => value === 'load' || value.startsWith('select-') ? '' : value)
        setAutomationError('')
        setRunsError('')
        setShowEditor(true)
        setSelectedId('')
        setRuns([])
        setDraft(newAutomationDraft(section, defaultTimezone()))
    }

    return (
        <Screen title={section === 'health' ? 'Health Checks' : 'Cron Jobs'} subtitle={section === 'health' ? 'Service checks and alerts' : 'Scheduled jobs'}>
            {section === 'cron' && <View style={styles.actions}>
                <PillButton label='Cron Jobs' tone={tab === 'cron' ? 'accent' : 'default'} onPress={() => setTab('cron')} small />
                <PillButton label='Personal jobs' tone={tab === 'personal' ? 'accent' : 'default'} onPress={() => setTab('personal')} small />
            </View>}
            {tab === 'cron' ? <>
                <GlassCard style={styles.editor}>
                    <Text style={styles.sectionTitle}>Cron Jobs · {cronJobs.length}</Text>
                    {!!cronJobs.length && <Text style={styles.cardMeta}>{cronRunning} running · {cronWithErrors} reporting errors</Text>}
                    <PillButton label={cronBusy === 'load' ? 'Loading…' : 'Refresh cron jobs'} disabled={!!cronBusy} small onPress={() => void loadCronJobs()} />
                    <InlineNotice message={cronError} />
                    {!cronJobs.length && !cronBusy && !cronError && <Text style={styles.cardBody}>No system cron jobs are available for this account.</Text>}
                </GlassCard>
                {cronJobs.map(job => <GlassCard key={job.id} style={styles.editor}>
                    <Text style={styles.cardMeta}>{job.category} · {job.service || job.host || 'System'}</Text>
                    <Text style={styles.cardTitle}>{job.name}</Text>
                    <Text style={styles.cardBody}>{job.description}</Text>
                    <Text style={styles.cardMeta}>{job.running ? 'Running' : job.status} · {job.schedule || 'No schedule'}</Text>
                    <Text style={styles.cardMeta}>Last run: {formatDate(job.lastRunAt)}</Text>
                    <Text style={styles.cardMeta}>Next run: {formatDate(job.nextRunAt)}</Text>
                    {!!job.lastError && <InlineNotice message={job.lastError} />}
                    {!!job.logExcerpt && <Text style={styles.cardBody} numberOfLines={4}>{job.logExcerpt}</Text>}
                    {job.controls.includes('edit_schedule') && <Field disabled={!!cronBusy} label='Schedule' value={cronDrafts[job.id] ?? job.schedule} onChangeText={value => setCronDrafts(current => ({ ...current, [job.id]: value }))} />}
                    <View style={styles.actions}>
                        {job.controls.includes('edit_schedule') && <PillButton label='Save schedule' small disabled={!!cronBusy || !(cronDrafts[job.id] ?? job.schedule).trim()} onPress={() => void changeCron(job, { schedule: cronDrafts[job.id] ?? job.schedule })} />}
                        {(job.enabled ? ['pause', 'disable'] : ['resume', 'enable']).some(control => job.controls.includes(control)) && <PillButton label={job.enabled ? 'Pause' : 'Enable'} small disabled={!!cronBusy} onPress={() => void changeCron(job, { enabled: !job.enabled })} />}
                        {job.controls.includes('run_now') && <PillButton label='Run now' small disabled={!!cronBusy || job.running} onPress={() => Alert.alert('Run job now?', job.name, [{ text: 'Cancel', style: 'cancel' }, { text: 'Run now', onPress: () => void changeCron(job, { action: 'run_now' }) }])} />}
                        {!job.controls.length && <Text style={styles.cardMeta}>View only</Text>}
                    </View>
                </GlassCard>)}
            </> : <>
                <View style={styles.actions}>
                    <PillButton label={section === 'health' ? 'New health check' : 'New personal job'} onPress={newAutomation} small disabled={!!busy} />
                    <PillButton label={busy === 'load' ? 'Loading…' : section === 'health' ? 'Refresh health checks' : 'Refresh personal jobs'} disabled={!!busy} onPress={() => void load()} small />
                </View>
                <InlineNotice message={automationError} />
                <View style={styles.automationList}>
                    {automations.map(automation => (
                        <GlassCard key={automation.id} style={[styles.automationCard, automation.id === selectedId && styles.selectedCard]}>
                            <Text style={styles.cardTitle} numberOfLines={1}>{automation.name}</Text>
                            <Text style={styles.cardBody} numberOfLines={2}>{automation.prompt}</Text>
                            <Text style={styles.cardMeta}>{automationActionLabel(automation.actionType)} · {monitoringLabel(automation.monitoringType)}</Text>
                            <Text style={styles.cardMeta}>{automation.status} · {automation.lastStatus || 'Not run yet'}</Text>
                            {!!automation.targetUrl && <Text style={styles.cardBody} numberOfLines={2}>{automation.targetUrl}</Text>}
                            <Text style={styles.cardMeta}>{formatSchedule(automation)}</Text>
                            <PillButton label='Edit' disabled={!!busy} onPress={() => void selectAutomation(automation)} small />
                        </GlassCard>
                    ))}
                    {!automations.length && busy === 'load' && (
                        <GlassCard style={styles.emptyCard}>
                            <Text style={styles.cardTitle}>{section === 'health' ? 'Loading health checks…' : 'Loading jobs…'}</Text>
                            <Text style={styles.cardBody}>Checking the latest data from Hanasand.</Text>
                        </GlassCard>
                    )}
                    {!automations.length && busy !== 'load' && !automationError && (
                        <GlassCard style={styles.emptyCard}>
                            <Text style={styles.cardTitle}>{section === 'health' ? 'No health checks yet' : 'No jobs yet'}</Text>
                            <Text style={styles.cardBody}>Create one and the server will run it even if this app is closed.</Text>
                        </GlassCard>
                    )}
                </View>

                {showEditor && <GlassCard style={styles.editor}>
                    <View style={styles.editorHeader}>
                        <CalendarClock color={theme.textMuted} size={18} />
                        <Text style={styles.sectionTitle}>{selected ? 'Edit automation' : 'New automation'}</Text>
                    </View>
                    <Field disabled={!!busy} label='Name' value={draft.name} onChangeText={name => setDraft({ ...draft, name })} />
                    <Field disabled={!!busy} label='Description' value={draft.prompt} onChangeText={prompt => setDraft({ ...draft, prompt })} multiline />
                    <View style={styles.row}>
                        <PillButton disabled={!!busy || draft.monitoringType === 'push'} label={draft.scheduleKind === 'interval' ? 'Recurring' : 'Once'} onPress={() => setDraft({ ...draft, scheduleKind: draft.scheduleKind === 'interval' ? 'once' : 'interval' })} small />
                        {(['agent_prompt', 'system_alert', 'echo', ...(canManageSystem ? ['mail_health_check'] : [])] as AgentAutomationPayload['actionType'][]).map(action => <PillButton key={action} label={action === 'agent_prompt' ? 'Monitoring' : action === 'system_alert' ? 'Scheduled message' : action === 'mail_health_check' ? 'Mail health' : 'History reminder'} tone={draft.actionType === action ? 'accent' : 'default'} disabled={!!busy || selected?.monitoringType === 'push' || selected?.actionType === 'organization_report'} onPress={() => setDraft({ ...draft, actionType: action, ...(action !== 'agent_prompt' && draft.monitoringType === 'push' ? { monitoringType: 'fetch' } : {}) })} small />)}
                        <PillButton disabled={!!busy} label={draft.status === 'active' ? 'Active' : 'Paused'} onPress={() => setDraft({ ...draft, status: draft.status === 'active' ? 'paused' : 'active' })} small />
                        <PillButton disabled={!!busy} label={`Notify ${draft.notifyOn || 'failure'}`} onPress={() => setDraft({ ...draft, notifyOn: draft.notifyOn === 'failure' ? 'always' : draft.notifyOn === 'always' ? 'never' : 'failure' })} small />
                    </View>
                    <InlineNotice message={automationEditError(draft)} />
                    {draft.actionType === 'organization_report' && <Text style={styles.cardMeta}>Organization report · {draft.organizationId}</Text>}
                    {draft.actionType === 'agent_prompt' && <MonitoringFields draft={draft} selected={selected} disabled={!!busy} onChange={setDraft} />}
                    <Field disabled={!!busy} label='Timezone' value={draft.timezone || 'UTC'} onChangeText={timezone => setDraft({ ...draft, timezone })} />
                    <Field disabled={!!busy} label={canManageSystem ? 'Notification destinations · one per line' : 'Discord webhook URLs · one per line'} value={(draft.notificationDestinations || []).join('\n')} onChangeText={value => { const destinations = value.split('\n').map(item => item.trim()).filter(Boolean); setDraft({ ...draft, notificationDestinations: destinations, modelName: destinations[0] || null }) }} multiline />
                    {draft.notifyOn !== 'never' && !draft.modelName && <Text style={styles.cardMeta}>No delivery destination configured.</Text>}
                    {draft.scheduleKind === 'interval' ? (
                        <Field disabled={!!busy || draft.monitoringType === 'push'} label='Interval · minutes' keyboardType='number-pad' value={draft.intervalMinutes === null || draft.intervalMinutes === undefined ? '' : String(draft.intervalMinutes)} onChangeText={value => setDraft({ ...draft, intervalMinutes: value === '' ? null : Number(value) })} />
                    ) : (
                        <Field disabled={!!busy} label='Run at ISO time' value={draft.runAt || defaultRunAt()} onChangeText={runAt => setDraft({ ...draft, runAt })} />
                    )}
                    <View style={styles.actions}>
                        <PillButton label={busy === 'save' ? 'Saving' : selected ? 'Save changes' : 'Create'} onPress={() => void save()} tone='accent' disabled={!!busy || !!automationEditError(draft)} />
                        {selected ? <PillButton label='Run' disabled={!!busy} onPress={() => Alert.alert('Run this check now?', selected.name, [{ text: 'Cancel', style: 'cancel' }, { text: 'Run now', onPress: () => void runNow() }])} small /> : null}
                        {selected ? <PillButton label='Delete' disabled={!!busy} onPress={() => Alert.alert('Delete this automation?', selected.name, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => void remove() }])} tone='danger' small /> : null}
                    </View>
                    <InlineNotice message={selected?.pausedReason || undefined} tone='info' />
                </GlassCard>}

                <GlassCard>
                    <View style={styles.editorHeader}>
                        <Play color={theme.textMuted} size={18} />
                        <Text style={styles.sectionTitle}>Run history</Text>
                        <RefreshCw color={theme.textMuted} size={16} />
                    </View>
                    <InlineNotice message={runsError} />
                    {!!runsError && selected && <PillButton label='Retry run history' small onPress={() => void selectAutomation(selected)} />}
                    {runs.map(run => (
                        <View key={run.id} style={styles.runRow}>
                            <Text style={styles.cardMeta}>{formatDate(run.startedAt)} · {run.status}</Text>
                            {run.status === 'failed'
                                ? <InlineNotice message={run.error || run.result || 'Run failed.'} />
                                : <Text style={styles.cardBody}>{run.result || 'Running...'}</Text>}
                        </View>
                    ))}
                    {!runs.length && !runsError && (!initialAutomationId || showEditor) && <Text style={styles.cardBody}>No runs recorded yet.</Text>}
                </GlassCard>
            </>}
        </Screen>
    )
}

function MonitoringFields({ draft, selected, disabled, onChange }: { draft: AgentAutomationPayload; selected: AgentAutomation | null; disabled: boolean; onChange: (next: AgentAutomationPayload) => void }) {
    const theme = useAppTheme()
    const styles = useMemo(() => createStyles(theme), [theme])
    const [advanced, setAdvanced] = useState(false)
    const type = draft.monitoringType || 'fetch'
    const rule = draft.jsonRule || defaultJsonRule
    const patchRule = (change: Partial<typeof rule>) => onChange({ ...draft, jsonRule: { ...rule, ...change } })
    return <View style={styles.editor}>
        <Text style={styles.label}>Check type</Text>
        <View style={styles.actions}>{monitoringTypes.map(value => <PillButton key={value} label={value === 'push' ? 'External events' : value.toUpperCase()} small tone={type === value ? 'accent' : 'default'} disabled={disabled || selected?.monitoringType === 'push' || value === 'push' && !!selected} onPress={() => onChange({ ...draft, monitoringType: value, ...(value === 'push' ? { targetUrl: '', timeoutSeconds: 180, retryCount: 0, intervalMinutes: 1, scheduleKind: 'interval', expectedDown: false, upsideDown: false } : { timeoutSeconds: 5 }) })} />)}</View>
        <Field disabled={disabled || selected?.monitoringType === 'push'} label={type === 'push' ? 'Source ID' : type === 'tcp' || type === 'ssh' ? 'Host and optional port' : 'URL to check'} value={draft.targetUrl || ''} onChangeText={targetUrl => onChange({ ...draft, targetUrl })} />
        {type === 'push' && <Text style={styles.cardMeta}>External events use a one-minute heartbeat. Existing source IDs and check types cannot be changed.</Text>}
        {type === 'json' && <>
            <Field disabled={disabled} label='JSON field · dots for nested fields, * for array items' value={rule.path} onChangeText={path => patchRule({ path })} />
            <Text style={styles.label}>Combine values</Text>
            <View style={styles.actions}>{(['max', 'min', 'avg', 'first'] as const).map(aggregate => <PillButton key={aggregate} label={aggregate} tone={rule.aggregate === aggregate ? 'accent' : 'default'} disabled={disabled} small onPress={() => patchRule({ aggregate })} />)}</View>
            <Text style={styles.label}>Alert when</Text>
            <View style={styles.actions}>{([['gt', '>'], ['gte', '≥'], ['lt', '<'], ['lte', '≤'], ['eq', '='], ['ne', '≠']] as const).map(([operator, label]) => <PillButton key={operator} label={label} tone={rule.operator === operator ? 'accent' : 'default'} disabled={disabled} small onPress={() => patchRule({ operator })} />)}</View>
            <Field disabled={disabled} label='Comparison value' value={String(rule.value)} onChangeText={raw => patchRule({ value: raw.trim() && Number.isFinite(Number(raw)) ? Number(raw) : raw === 'true' ? true : raw === 'false' ? false : raw })} />
        </>}
        <Field disabled={disabled} label={type === 'push' ? 'Mark offline after · seconds' : 'Response timeout · seconds'} keyboardType='number-pad' value={draft.timeoutSeconds === null || draft.timeoutSeconds === undefined ? '' : String(draft.timeoutSeconds)} onChangeText={value => onChange({ ...draft, timeoutSeconds: value === '' ? null : Number(value) })} />
        {type !== 'push' && <>
            <Field disabled={disabled} label='Retries before failure · 0 to 5' keyboardType='number-pad' value={draft.retryCount === null || draft.retryCount === undefined ? '' : String(draft.retryCount)} onChangeText={value => onChange({ ...draft, retryCount: value === '' ? null : Number(value) })} />
            <PillButton label={advanced ? 'Hide request options' : 'Request options'} small disabled={disabled} onPress={() => setAdvanced(value => !value)} />
            {advanced && <>
                <Field disabled={disabled} label='User agent' value={draft.userAgent || ''} onChangeText={userAgent => onChange({ ...draft, userAgent })} />
                <View style={styles.actions}>
                    {([['followRedirects', 'Follow redirects'], ['expectedDown', 'Expected down'], ['upsideDown', 'Invert result'], ['notifyWarnings', 'Notify warnings']] as const).map(([key, label]) => <PillButton key={key} label={`${label}: ${draft[key] ? 'Yes' : 'No'}`} tone={draft[key] ? 'accent' : 'default'} small disabled={disabled} onPress={() => onChange({ ...draft, [key]: !draft[key] })} />)}
                </View>
                <Text style={styles.cardMeta}>Expected down treats downtime as maintenance. Invert result reverses the expected result. Warnings report successful checks taking at least one second.</Text>
            </>}
        </>}
    </View>
}

function Field({ label, value, onChangeText, multiline = false, keyboardType, disabled }: { label: string, value: string, onChangeText: (value: string) => void, multiline?: boolean, keyboardType?: 'default' | 'number-pad', disabled?: boolean }) {
    const theme = useAppTheme()
    const styles = useMemo(() => createStyles(theme), [theme])
    return (
        <View style={styles.field}>
            <Text style={styles.label}>{label}</Text>
            <TextInput
                editable={!disabled}
                value={value}
                onChangeText={onChangeText}
                multiline={multiline}
                keyboardType={keyboardType || 'default'}
                autoCapitalize='none'
                style={[styles.input, multiline && styles.textarea]}
                placeholderTextColor={theme.textMuted}
            />
        </View>
    )
}


function formatDate(value?: string | null) {
    if (!value) return 'Not scheduled'
    return new Date(value).toLocaleString()
}

function formatSchedule(automation: AgentAutomation) {
    return automation.scheduleKind === 'once'
        ? `Once · ${formatDate(automation.runAt)}`
        : `Every ${automation.intervalMinutes || 0} min · ${formatDate(automation.nextRunAt)} · ${automation.timezone || 'UTC'}`
}

function automationActionLabel(action: AgentAutomation['actionType']) {
    switch (action) {
        case 'agent_prompt': return 'Monitoring'
        case 'echo': return 'History reminder'
        case 'mail_health_check': return 'Mail health'
        case 'system_alert': return 'Scheduled message'
        case 'organization_report': return 'Organization report'
    }
}

function monitoringLabel(type: AgentAutomation['monitoringType']) {
    switch (type) {
        case 'fetch': return 'HTTP check'
        case 'post': return 'HTTP check'
        case 'tcp': return 'TCP check'
        case 'ssh': return 'SSH check'
        case 'json': return 'JSON check'
        case 'push': return 'External events'
    }
}

function createStyles(theme: ThemePalette) {
    return StyleSheet.create({
        actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
        automationList: { gap: spacing.sm, paddingVertical: spacing.sm },
        automationCard: { gap: spacing.sm },
        selectedCard: { borderColor: theme.surfaceBorder, backgroundColor: theme.surfaceStrong },
        emptyCard: { gap: spacing.sm },
        editor: { gap: spacing.md },
        editorHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
        sectionTitle: { color: theme.text, fontSize: 17, fontWeight: '700' },
        cardTitle: { color: theme.text, fontSize: 16, fontWeight: '700' },
        cardBody: { color: theme.textMuted, fontSize: 13, lineHeight: 20 },
        cardMeta: { color: theme.textSoft, fontSize: 12 },
        field: { gap: spacing.xs },
        label: { color: theme.textSoft, fontSize: 12, fontWeight: '700' },
        input: {
            backgroundColor: theme.surface,
            borderColor: theme.surfaceBorder,
            borderRadius: 12,
            borderWidth: 1,
            color: theme.text,
            minHeight: 44,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
        },
        textarea: { minHeight: 110, textAlignVertical: 'top' },
        row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
        runRow: {
            borderTopColor: theme.surfaceBorder,
            borderTopWidth: 1,
            gap: spacing.xs,
            paddingVertical: spacing.sm,
        },
    })
}
