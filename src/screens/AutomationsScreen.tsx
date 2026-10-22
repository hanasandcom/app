import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { CalendarClock, Play, RefreshCw } from 'lucide-react-native'
import { createAutomation, deleteAutomation, fetchAutomationDetails, fetchAutomations, runAutomationNow, updateAutomation } from '../lib/api'
import type { AgentAutomation, AgentAutomationPayload, AgentAutomationRun, AppSettings } from '../types'
import { changeWorkspaceCronJob, loadWorkspaceCronJobs, workspaceAccountKey, type WorkspaceCronJob } from '../lib/workspace-data'
import { GlassCard, InlineNotice, PillButton, Screen } from '../components/ui'
import { spacing, type ThemePalette } from '../theme/tokens'
import { useAppTheme } from '../theme/context'

const defaultRunAt = () => new Date(Date.now() + 5 * 60_000).toISOString()
const defaultTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

export function AutomationsScreen({ settings }: { settings: AppSettings }) {
    return <AccountAutomations key={workspaceAccountKey(settings)} settings={settings} />
}

function AccountAutomations({ settings }: { settings: AppSettings }) {
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
    const [tab, setTab] = useState<'cron' | 'personal'>('cron')
    const active = useRef(true)
    const detailsSequence = useRef(0)
    const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const [selectedId, setSelectedId] = useState('')
    const [busy, setBusy] = useState('')
    const [draft, setDraft] = useState<AgentAutomationPayload>({
        name: 'Check in later',
        prompt: '',
        scheduleKind: 'interval',
        intervalMinutes: 30,
        runAt: defaultRunAt(),
        status: 'active',
        actionType: 'agent_prompt',
        timezone: defaultTimezone(),
        modelName: null,
        notifyOn: 'failure',
    })

    const selected = automations.find(item => item.id === selectedId) || null

    useEffect(() => {
        active.current = true
        void load()
        void loadCronJobs()
        return () => { active.current = false; if (retryTimer.current) clearTimeout(retryTimer.current) }
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
        setBusy('load')
        setAutomationError('')
        try {
            const next = await fetchAutomations(settings)
            if (!active.current) return
            setAutomations(next)
            const nextSelected = selectId || next[0]?.id || ''
            setSelectedId(nextSelected)
            if (nextSelected) {
                const details = await fetchAutomationDetails(settings, nextSelected)
                if (!active.current) return
                setRuns(details.runs)
                if (details.automation) setDraft(toDraft(details.automation))
            } else {
                setRuns([])
            }
        } catch (error) {
            if (active.current) setAutomationError(error instanceof Error ? error.message : 'Unable to load personal jobs.')
        } finally {
            setBusy('')
        }
    }

    async function selectAutomation(automation: AgentAutomation) {
        const request = ++detailsSequence.current
        setRuns([])
        setRunsError('')
        setShowEditor(true)
        setSelectedId(automation.id)
        setDraft(toDraft(automation))
        setBusy(`select-${automation.id}`)
        try {
            const details = await fetchAutomationDetails(settings, automation.id)
            if (active.current && request === detailsSequence.current) setRuns(details.runs)
        } catch (error) {
            if (active.current && request === detailsSequence.current) setRunsError(error instanceof Error ? error.message : 'Unable to load runs.')
        } finally {
            setBusy('')
        }
    }

    async function save() {
        if (busy) return
        if (!draft.name.trim() || !draft.prompt.trim()) { Alert.alert('Name and prompt required', 'Add a name and prompt for this job.'); return }
        if (draft.scheduleKind === 'interval' && (!draft.intervalMinutes || draft.intervalMinutes < 1)) { Alert.alert('Invalid interval', 'Enter an interval of at least one minute.'); return }
        if (draft.scheduleKind === 'once' && (!draft.runAt || !Number.isFinite(Date.parse(draft.runAt)))) { Alert.alert('Invalid time', 'Enter a valid run time.'); return }
        setBusy('save')
        try {
            const automation = selected
                ? await updateAutomation(settings, selected.id, draft)
                : await createAutomation(settings, draft)
            setSelectedId(automation?.id || '')
            if (automation) setDraft(toDraft(automation))
            await load(automation?.id || '')
        } catch (error) {
            Alert.alert('Unable to save automation', error instanceof Error ? error.message : 'Request failed.')
        } finally {
            setBusy('')
        }
    }

    async function remove() {
        if (!selected || busy) return
        setBusy('delete')
        try {
            await deleteAutomation(settings, selected.id)
            newAutomation()
            await load('')
        } catch (error) {
            Alert.alert('Unable to remove automation', error instanceof Error ? error.message : 'Request failed.')
        } finally {
            setBusy('')
        }
    }

    async function runNow() {
        if (!selected || busy) return
        setBusy('run')
        try {
            await runAutomationNow(settings, selected.id)
            await load(selected.id)
        } catch (error) {
            Alert.alert('Unable to queue run', error instanceof Error ? error.message : 'Request failed.')
        } finally {
            setBusy('')
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
        setShowEditor(true)
        setSelectedId('')
        setRuns([])
        setDraft({
            name: 'Check in later',
            prompt: '',
            scheduleKind: 'interval',
            intervalMinutes: 30,
            runAt: defaultRunAt(),
            status: 'active',
            actionType: 'agent_prompt',
            timezone: defaultTimezone(),
            modelName: null,
            notifyOn: 'failure',
        })
    }

    return (
        <Screen title='Automations' subtitle='Scheduled jobs'>
            <View style={styles.actions}>
                <PillButton label='Cron Jobs' tone={tab === 'cron' ? 'accent' : 'default'} onPress={() => setTab('cron')} small />
                <PillButton label='Personal jobs' tone={tab === 'personal' ? 'accent' : 'default'} onPress={() => setTab('personal')} small />
            </View>
            {tab === 'cron' ? <>
                <GlassCard style={styles.editor}>
                    <Text style={styles.sectionTitle}>Cron Jobs · {cronJobs.length}</Text>
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
                    <PillButton label='New personal job' onPress={newAutomation} small disabled={!!busy} />
                    <PillButton label={busy === 'load' ? 'Loading…' : 'Refresh personal jobs'} disabled={!!busy} onPress={() => void load()} small />
                </View>
                <InlineNotice message={automationError} />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.automationRail}>
                    {automations.map(automation => (
                        <GlassCard key={automation.id} style={[styles.automationCard, automation.id === selectedId && styles.selectedCard]}>
                            <Text style={styles.cardTitle} numberOfLines={1}>{automation.name}</Text>
                            <Text style={styles.cardBody} numberOfLines={2}>{automation.prompt}</Text>
                            <Text style={styles.cardMeta}>{formatSchedule(automation)}</Text>
                            <PillButton label='Edit' disabled={!!busy} onPress={() => void selectAutomation(automation)} small />
                        </GlassCard>
                    ))}
                    {!automations.length && (
                        <GlassCard style={styles.emptyCard}>
                            <Text style={styles.cardTitle}>No jobs yet</Text>
                            <Text style={styles.cardBody}>Create one and the server will run it even if this app is closed.</Text>
                        </GlassCard>
                    )}
                </ScrollView>

                {showEditor && <GlassCard style={styles.editor}>
                    <View style={styles.editorHeader}>
                        <CalendarClock color={theme.textMuted} size={18} />
                        <Text style={styles.sectionTitle}>{selected ? 'Edit automation' : 'New automation'}</Text>
                    </View>
                    <Field disabled={!!busy} label='Name' value={draft.name} onChangeText={name => setDraft({ ...draft, name })} />
                    <Field disabled={!!busy} label='Prompt' value={draft.prompt} onChangeText={prompt => setDraft({ ...draft, prompt })} multiline />
                    <View style={styles.row}>
                        <PillButton label={draft.scheduleKind === 'interval' ? 'Recurring' : 'Once'} onPress={() => setDraft({ ...draft, scheduleKind: draft.scheduleKind === 'interval' ? 'once' : 'interval' })} small />
                        <PillButton label={draft.actionType === 'agent_prompt' ? 'Agent' : 'Echo test'} onPress={() => setDraft({ ...draft, actionType: draft.actionType === 'agent_prompt' ? 'echo' : 'agent_prompt' })} small />
                        <PillButton label={draft.status === 'active' ? 'Active' : 'Paused'} onPress={() => setDraft({ ...draft, status: draft.status === 'active' ? 'paused' : 'active' })} small />
                        <PillButton label={`Notify ${draft.notifyOn || 'failure'}`} onPress={() => setDraft({ ...draft, notifyOn: draft.notifyOn === 'failure' ? 'always' : draft.notifyOn === 'always' ? 'never' : 'failure' })} small />
                    </View>
                    <Field disabled={!!busy} label='Timezone' value={draft.timezone || 'UTC'} onChangeText={timezone => setDraft({ ...draft, timezone })} />
                    <Field disabled={!!busy} label='Model preference' value={draft.modelName || ''} onChangeText={modelName => setDraft({ ...draft, modelName: modelName.trim() || null })} />
                    {draft.scheduleKind === 'interval' ? (
                        <Field disabled={!!busy} label='Every minutes' keyboardType='number-pad' value={`${draft.intervalMinutes || 30}`} onChangeText={value => setDraft({ ...draft, intervalMinutes: Number(value) || 30 })} />
                    ) : (
                        <Field disabled={!!busy} label='Run at ISO time' value={draft.runAt || defaultRunAt()} onChangeText={runAt => setDraft({ ...draft, runAt })} />
                    )}
                    <View style={styles.actions}>
                        <PillButton label={busy === 'save' ? 'Saving' : selected ? 'Save' : 'Create'} onPress={() => void save()} tone='accent' disabled={!!busy} />
                        {selected ? <PillButton label='Run' disabled={!!busy} onPress={() => Alert.alert('Run personal job now?', selected.name, [{ text: 'Cancel', style: 'cancel' }, { text: 'Run now', onPress: () => void runNow() }])} small /> : null}
                        {selected ? <PillButton label='Delete' disabled={!!busy} onPress={() => Alert.alert('Delete personal job?', selected.name, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => void remove() }])} tone='danger' small /> : null}
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
                    {!runs.length && <Text style={styles.cardBody}>No runs recorded yet.</Text>}
                </GlassCard>
            </>}
        </Screen>
    )
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
                style={[styles.input, multiline && styles.textarea]}
                placeholderTextColor={theme.textMuted}
            />
        </View>
    )
}

function toDraft(automation: AgentAutomation): AgentAutomationPayload {
    return {
        name: automation.name,
        prompt: automation.prompt,
        scheduleKind: automation.scheduleKind,
        intervalMinutes: automation.intervalMinutes || 30,
        runAt: automation.runAt || defaultRunAt(),
        status: automation.status === 'paused' ? 'paused' : 'active',
        actionType: automation.actionType,
        timezone: automation.timezone || defaultTimezone(),
        modelName: automation.modelName || null,
        notifyOn: automation.notifyOn || 'failure',
    }
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

function createStyles(theme: ThemePalette) {
    return StyleSheet.create({
        actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
        automationRail: { gap: spacing.md, paddingVertical: spacing.sm },
        automationCard: { width: 250, gap: spacing.sm },
        selectedCard: { borderColor: theme.accent },
        emptyCard: { width: 260, gap: spacing.sm },
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
