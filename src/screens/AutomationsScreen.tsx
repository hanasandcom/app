import { useEffect, useMemo, useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { CalendarClock, Play, RefreshCw } from 'lucide-react-native'
import { createAutomation, deleteAutomation, fetchAutomationDetails, fetchAutomations, fetchManagedCronJobs, runAutomationNow, updateAutomation, updateManagedCronJob } from '../lib/api'
import type { AgentAutomation, AgentAutomationPayload, AgentAutomationRun, AppSettings, ManagedCronJob } from '../types'
import { GlassCard, InlineNotice, PillButton, Screen } from '../components/ui'
import { spacing, type ThemePalette } from '../theme/tokens'
import { useAppTheme } from '../theme/context'

const defaultRunAt = () => new Date(Date.now() + 5 * 60_000).toISOString()
const defaultTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

export function AutomationsScreen({ settings }: { settings: AppSettings }) {
    const theme = useAppTheme()
    const styles = useMemo(() => createStyles(theme), [theme])
    const [automations, setAutomations] = useState<AgentAutomation[]>([])
    const [runs, setRuns] = useState<AgentAutomationRun[]>([])
    const [cronJobs, setCronJobs] = useState<ManagedCronJob[]>([])
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
        void load()
        void loadCronJobs()
    }, [])

    async function loadCronJobs() {
        try {
            setCronJobs(await fetchManagedCronJobs(settings))
        } catch {
            setCronJobs([])
        }
    }

    async function load(selectId = selectedId) {
        setBusy('load')
        try {
            const next = await fetchAutomations(settings)
            setAutomations(next)
            const nextSelected = selectId || next[0]?.id || ''
            setSelectedId(nextSelected)
            if (nextSelected) {
                const details = await fetchAutomationDetails(settings, nextSelected)
                setRuns(details.runs)
            } else {
                setRuns([])
            }
        } catch (error) {
            Alert.alert('Unable to load automations', error instanceof Error ? error.message : 'Request failed.')
        } finally {
            setBusy('')
        }
    }

    async function selectAutomation(automation: AgentAutomation) {
        setSelectedId(automation.id)
        setDraft(toDraft(automation))
        setBusy(`select-${automation.id}`)
        try {
            const details = await fetchAutomationDetails(settings, automation.id)
            setRuns(details.runs)
        } catch (error) {
            Alert.alert('Unable to load runs', error instanceof Error ? error.message : 'Request failed.')
        } finally {
            setBusy('')
        }
    }

    async function save() {
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
        if (!selected) return
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
        if (!selected) return
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

    async function toggleCron(job: ManagedCronJob) {
        setBusy(`cron-${job.id}`)
        try {
            setCronJobs(await updateManagedCronJob(settings, job.id, { schedule: job.schedule, enabled: !job.enabled }))
        } catch (error) {
            Alert.alert('Unable to update cron job', error instanceof Error ? error.message : 'Request failed.')
        } finally {
            setBusy('')
        }
    }

    function newAutomation() {
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
        <Screen title='Automations' subtitle='Server-side agent jobs'>
            <View style={styles.actions}>
                <PillButton label='New' onPress={newAutomation} small />
                <PillButton label={busy === 'load' ? 'Loading' : 'Refresh'} onPress={() => void load()} small />
            </View>

            {!!cronJobs.length && (
                <GlassCard style={styles.editor}>
                    <View style={styles.editorHeader}>
                        <CalendarClock color={theme.textMuted} size={18} />
                        <Text style={styles.sectionTitle}>System cron</Text>
                    </View>
                    {cronJobs.map(job => (
                        <View key={job.id} style={styles.runRow}>
                            <Text style={styles.cardTitle}>{job.name}</Text>
                            <Text style={styles.cardMeta}>{job.host} · {job.enabled ? 'enabled' : 'paused'} · {job.schedule}</Text>
                            <Text style={styles.cardBody}>{job.lastLogLine || 'No log line found.'}</Text>
                            <PillButton label={job.enabled ? 'Pause' : 'Enable'} onPress={() => void toggleCron(job)} small />
                        </View>
                    ))}
                </GlassCard>
            )}

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.automationRail}>
                {automations.map(automation => (
                    <GlassCard key={automation.id} style={[styles.automationCard, automation.id === selectedId && styles.selectedCard]}>
                        <Text style={styles.cardTitle} numberOfLines={1}>{automation.name}</Text>
                        <Text style={styles.cardBody} numberOfLines={2}>{automation.prompt}</Text>
                        <Text style={styles.cardMeta}>{formatSchedule(automation)}</Text>
                        <PillButton label='Edit' onPress={() => void selectAutomation(automation)} small />
                    </GlassCard>
                ))}
                {!automations.length && (
                    <GlassCard style={styles.emptyCard}>
                        <Text style={styles.cardTitle}>No jobs yet</Text>
                        <Text style={styles.cardBody}>Create one and the server will run it even if this app is closed.</Text>
                    </GlassCard>
                )}
            </ScrollView>

            <GlassCard style={styles.editor}>
                <View style={styles.editorHeader}>
                    <CalendarClock color={theme.textMuted} size={18} />
                    <Text style={styles.sectionTitle}>{selected ? 'Edit automation' : 'New automation'}</Text>
                </View>
                <Field label='Name' value={draft.name} onChangeText={name => setDraft({ ...draft, name })} />
                <Field label='Prompt' value={draft.prompt} onChangeText={prompt => setDraft({ ...draft, prompt })} multiline />
                <View style={styles.row}>
                    <PillButton label={draft.scheduleKind === 'interval' ? 'Recurring' : 'Once'} onPress={() => setDraft({ ...draft, scheduleKind: draft.scheduleKind === 'interval' ? 'once' : 'interval' })} small />
                    <PillButton label={draft.actionType === 'agent_prompt' ? 'Agent' : 'Echo test'} onPress={() => setDraft({ ...draft, actionType: draft.actionType === 'agent_prompt' ? 'echo' : 'agent_prompt' })} small />
                    <PillButton label={draft.status === 'active' ? 'Active' : 'Paused'} onPress={() => setDraft({ ...draft, status: draft.status === 'active' ? 'paused' : 'active' })} small />
                    <PillButton label={`Notify ${draft.notifyOn || 'failure'}`} onPress={() => setDraft({ ...draft, notifyOn: draft.notifyOn === 'failure' ? 'always' : draft.notifyOn === 'always' ? 'never' : 'failure' })} small />
                </View>
                <Field label='Timezone' value={draft.timezone || 'UTC'} onChangeText={timezone => setDraft({ ...draft, timezone })} />
                <Field label='Model preference' value={draft.modelName || ''} onChangeText={modelName => setDraft({ ...draft, modelName: modelName.trim() || null })} />
                {draft.scheduleKind === 'interval' ? (
                    <Field label='Every minutes' keyboardType='number-pad' value={`${draft.intervalMinutes || 30}`} onChangeText={value => setDraft({ ...draft, intervalMinutes: Number(value) || 30 })} />
                ) : (
                    <Field label='Run at ISO time' value={draft.runAt || defaultRunAt()} onChangeText={runAt => setDraft({ ...draft, runAt })} />
                )}
                <View style={styles.actions}>
                    <PillButton label={busy === 'save' ? 'Saving' : selected ? 'Save' : 'Create'} onPress={() => void save()} tone='accent' />
                    {selected ? <PillButton label='Run' onPress={() => void runNow()} small /> : null}
                    {selected ? <PillButton label='Delete' onPress={() => void remove()} tone='danger' small /> : null}
                </View>
                <InlineNotice message={selected?.pausedReason || undefined} tone='info' />
            </GlassCard>

            <GlassCard>
                <View style={styles.editorHeader}>
                    <Play color={theme.textMuted} size={18} />
                    <Text style={styles.sectionTitle}>Run history</Text>
                    <RefreshCw color={theme.textMuted} size={16} />
                </View>
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
        </Screen>
    )
}

function Field({ label, value, onChangeText, multiline = false, keyboardType }: { label: string, value: string, onChangeText: (value: string) => void, multiline?: boolean, keyboardType?: 'default' | 'number-pad' }) {
    const theme = useAppTheme()
    const styles = useMemo(() => createStyles(theme), [theme])
    return (
        <View style={styles.field}>
            <Text style={styles.label}>{label}</Text>
            <TextInput
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
