import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, AppState, TextInput, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import * as Crypto from 'expo-crypto'
import type { AppSettings } from '../types'
import { GlassCard, InlineNotice, PillButton, Screen, StatChip } from '../components/ui'
import { useAppTheme } from '../theme/context'
import { loadPrivacy, performPrivacyAction, type PrivacyTransport } from '../features/privacy/api'
import { PrivacyController } from '../features/privacy/controller'
import { sharePrivacyExport } from '../features/privacy/export'
import { canUsePrivacyAction, privacyScope, text, type PrivacyAction, type PrivacyExport, type PrivacyRow, type PrivacyState, PrivacyError } from '../features/privacy/model'
import { countLabel, PrivacyHistory, PrivacyRecordDetail, PrivacyText } from '../features/privacy/PrivacyHistory'

type Props = { settings: AppSettings; transport?: PrivacyTransport; exportFile?: typeof sharePrivacyExport }
export function OrganizationPrivacyScreen(props: Props) { return <PrivacyWorkspace key={privacyScope(props.settings)} {...props} /> }
function PrivacyWorkspace({ settings, transport, exportFile = sharePrivacyExport }: Props) {
    const theme = useAppTheme(), controller = useRef(new PrivacyController())
    const [snapshot, setSnapshot] = useState<PrivacyState | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState('')
    const [tab, setTab] = useState<'summary' | 'runs' | 'requests' | 'items'>('summary'), [detail, setDetail] = useState<PrivacyRow | null>(null)
    const [confirmation, setConfirmation] = useState(''), [password, setPassword] = useState(''), [exported, setExported] = useState<PrivacyExport | null>(null)
    const [, render] = useState(0), focused = useRef(false), foreground = useRef(AppState.currentState === 'active'), mounted = useRef(true)
    const draft = useRef({ confirmation, password, version: 0 }), snapshotRef = useRef(snapshot)
    const panel = useRef<'summary' | 'runs' | 'requests' | 'items'>('summary')
    snapshotRef.current = snapshot
    const ops = controller.current, captured = ops.generation
    function publish() { if (mounted.current) render(value => value + 1) }
    function clearPassword() { draft.current.password = ''; draft.current.version++; setPassword('') }
    function hide() {
        ops.hide(); clearPassword(); setExported(null); setSnapshot(null); setDetail(null); setError(''); setNotice(''); publish()
    }
    async function refresh(generation: number, manual: boolean, offset = 0) {
        if (!settings.selectedOrganizationId || settings.selectedOrganizationId === 'personal') return
        const read = ops.beginRead(generation, manual)
        if (!read) return
        clearPassword(); setError(''); setDetail(null); publish()
        try {
            const state = await loadPrivacy(settings, read.controller.signal, offset, { transport })
            const previousUnknown = ops.unknown
            if (!ops.finishRead(read.ticket, state)) return
            setSnapshot(state)
            if (ops.unknown) setNotice('The earlier outcome is still unconfirmed. It may be outside the latest 20 records. Do not submit it again.')
            else if (previousUnknown) setNotice(previousUnknown.action === 'export'
                ? 'The earlier export request is recorded. Its archive cannot be recovered from history; review the request status before explicitly creating another export.'
                : 'The earlier request is recorded. Review its current status in the history; processing or automatic retries may continue.')
        } catch (cause) {
            if (ops.failRead(read.ticket)) setError(message(cause))
        } finally { publish() }
    }
    useFocusEffect(useCallback(() => {
        mounted.current = true; focused.current = true; ops.visible = foreground.current
        if (ops.visible) void refresh(ops.generation, false)
        return () => { focused.current = false; hide() }
    }, []))
    useEffect(() => {
        mounted.current = true
        const subscription = AppState.addEventListener('change', state => {
            const wasForeground = foreground.current
            foreground.current = state === 'active'
            if (!foreground.current) hide()
            else if (!wasForeground && focused.current) { ops.visible = true; void refresh(ops.generation, false) }
        })
        return () => { mounted.current = false; ops.hide(); draft.current.password = ''; subscription.remove() }
    }, [])
    const ownOrganization = !!settings.selectedOrganizationId && settings.selectedOrganizationId !== 'personal'
    const disabled = !ops.usable(captured), canAct = (action: PrivacyAction) => !disabled && !ops.locked && canUsePrivacyAction(settings, snapshot, action)
    function confirmAction(action: PrivacyAction) {
        const state = snapshotRef.current, generation = captured, version = draft.current.version
        if (!state || panel.current !== 'summary' || !canAct(action)) return
        if (action === 'delete' && (draft.current.confirmation !== state.organization.name || !draft.current.password)) return
        Alert.alert(action === 'delete' ? 'Request privacy deletion?' : action === 'run_retention' ? 'Run retention now?' : 'Export organization data?',
            action === 'delete' ? `Delete eligible data for ${state.organization.name}. Protected evidence remains. Access to the organization may be removed.`
                : action === 'run_retention' ? `Purge eligible data older than ${state.organization.retentionDays} days for ${state.organization.name}. Protected records remain.`
                    : `Create a privacy request and prepare a file containing ${state.organization.name} data to share or save.`, [
                { text: 'Cancel', style: 'cancel' },
                { text: action === 'delete' ? 'Request deletion' : 'Continue', style: action === 'delete' ? 'destructive' : 'default', onPress: () => {
                    if (!ops.usable(generation) || ops.locked || panel.current !== 'summary' || snapshotRef.current !== state || version !== draft.current.version) return
                    void submit(state, action, generation)
                } },
            ])
    }
    async function submit(state: PrivacyState, action: PrivacyAction, generation: number) {
        if (!canUsePrivacyAction(settings, state, action)) return
        const requestId = Crypto.randomUUID(), deletion = action === 'delete' ? { confirmation: draft.current.confirmation, currentPassword: draft.current.password } : undefined
        const write = ops.beginWrite(generation, { action, requestId })
        if (!write) return
        clearPassword(); setError(''); setNotice(''); setExported(null); publish()
        try {
            const receipt = await performPrivacyAction(settings, state, action, requestId, write.controller.signal, deletion, { transport })
            if (!ops.finishWrite(write.generation, true)) return
            if (receipt.state) setSnapshot(receipt.state)
            setNotice(receipt.status === 'failed' ? 'The saved request reports a failure. Retention may retry automatically; review the history before taking another action.'
                : receipt.status === 'running' ? 'The request is saved and processing continues. Refresh to review progress.'
                    : action === 'delete' ? 'Privacy deletion completed. Protected evidence remains; organization access may now be removed.'
                        : action === 'export' ? 'The export is ready. Share or save the JSON file below.' : 'The retention run completed. Refresh to review the records.')
            if (receipt.exported) setExported(receipt.exported)
        } catch (cause) {
            const uncertain = !(cause instanceof PrivacyError) || cause.uncertain
            if (ops.finishWrite(write.generation, !uncertain)) setError(message(cause))
        } finally { publish() }
    }
    async function share() {
        if (!exported || !ops.usable(captured)) return
        const generation = captured
        try { await exportFile(exported, () => ops.current(generation)) }
        catch (cause) { if (ops.current(generation)) setError(message(cause)) }
    }
    function updateInput(field: 'confirmation' | 'password', value: string) {
        if (!ops.usable(captured) || ops.locked || panel.current !== 'summary' || !canUsePrivacyAction(settings, snapshotRef.current, 'delete')) return
        draft.current[field] = value; draft.current.version++
        if (field === 'password') setPassword(value); else setConfirmation(value)
    }
    function navigate(next: typeof tab, item: PrivacyRow | null = null) {
        if (!ops.navigate(captured)) return
        panel.current = next
        clearPassword(); draft.current.confirmation = ''; setConfirmation('')
        setTab(next); setDetail(item); publish()
    }
    return <Screen title='Privacy & retention' subtitle={snapshot?.organization.name || 'Organization data and protection'} right={<PillButton key={`refresh-${captured}`} label={ops.reading ? 'Loading…' : 'Refresh'} disabled={disabled || !ownOrganization} onPress={() => void refresh(captured, true)} />}>
        {!ownOrganization && <InlineNotice tone='info' message='Select an organization to view its privacy and retention.' />}
        {!!error && <InlineNotice message={error} />}
        {!!notice && <InlineNotice tone='info' message={notice} />}
        {ops.locked && <InlineNotice tone='info' message={ops.unknown ? 'The previous request may have been saved. Use Refresh to check its exact history before another action. Missing history or lost access does not confirm success.' : 'Refresh and review current permissions before another action.'} />}
        <View key={`privacy-hosts-${captured}`} style={{ gap: 14 }}>
            {snapshot && <>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {(['summary', 'runs', 'requests', 'items'] as const).map(value => <PillButton key={value} label={{ summary: 'Summary', runs: 'Runs', requests: 'Requests', items: 'Records' }[value]} disabled={disabled} onPress={() => navigate(value)} />)}
                </View>
                {detail ? <PrivacyRecordDetail item={detail} onBack={() => navigate(tab)} /> : tab === 'summary' ? <>
                    <GlassCard>
                        <PrivacyText title>{snapshot.organization.retentionDays} day retention policy</PrivacyText>
                        <PrivacyText>Organization status: {snapshot.organization.status}</PrivacyText>
                        <PrivacyText>{text(snapshot.protection.explanation) || 'Protection details are unavailable.'}</PrivacyText>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                            {['deleted', 'redacted', 'protected', 'failed', 'retried'].map(value => <StatChip key={value} label={value} value={countLabel(snapshot.runs[0]?.[`${value}_count`])} />)}
                        </View>
                    </GlassCard>
                    <GlassCard>
                        <PrivacyText title>Protected evidence</PrivacyText>
                        {Object.entries({ protected_events: 'Protected records', access_recovery_holds: 'Access recovery holds', immutable_system_events: 'Immutable system events', immutable_webhook_audit_events: 'Immutable webhook audit events', immutable_log_events: 'Immutable log events' }).map(([key, label]) => <PrivacyText key={key}>{label}: {countLabel(snapshot.protection[key])}</PrivacyText>)}
                    </GlassCard>
                    <GlassCard>
                        <PrivacyText title>Organization privacy actions</PrivacyText>
                        <PrivacyText>Retention removes eligible data under the current policy. Export includes sensitive organization data. Deletion requires an owner and your current password.</PrivacyText>
                        <PillButton label='Export data' disabled={!canAct('export')} onPress={() => confirmAction('export')} />
                        <PillButton label='Run purge now' disabled={!canAct('run_retention')} onPress={() => confirmAction('run_retention')} />
                        <PrivacyText>Type {snapshot.organization.name} to confirm deletion</PrivacyText>
                        <TextInput accessibilityLabel='Organization name confirmation' value={confirmation} onChangeText={value => updateInput('confirmation', value)} editable={canAct('delete')} autoCorrect={false} autoCapitalize='none' style={{ color: theme.text, borderColor: theme.surfaceBorder, borderWidth: 1, borderRadius: 12, padding: 14, minHeight: 48 }} />
                        <PrivacyText>Current password</PrivacyText>
                        <TextInput accessibilityLabel='Current password' value={password} onChangeText={value => updateInput('password', value)} editable={canAct('delete')} secureTextEntry textContentType='password' autoCorrect={false} autoCapitalize='none' autoComplete='current-password' style={{ color: theme.text, borderColor: theme.surfaceBorder, borderWidth: 1, borderRadius: 12, padding: 14, minHeight: 48 }} />
                        <PillButton label={ops.pending ? 'Submitting…' : 'Request deletion'} tone='danger' disabled={!canAct('delete') || confirmation !== snapshot.organization.name || !password} onPress={() => confirmAction('delete')} />
                    </GlassCard>
                </> : <>
                    <PrivacyHistory rows={snapshot[tab]} kind={tab} onOpen={item => navigate(tab, item)} />
                    {tab === 'items' && <View style={{ gap: 8 }}>
                        <PrivacyText>Records {snapshot.page.offset + (snapshot.items.length ? 1 : 0)}–{snapshot.page.offset + snapshot.items.length}</PrivacyText>
                        <PillButton label='Previous records' disabled={disabled || snapshot.page.offset === 0} onPress={() => void refresh(captured, false, Math.max(0, snapshot.page.offset - 50))} />
                        <PillButton label='Next records' disabled={disabled || snapshot.page.nextOffset === null || snapshot.page.nextOffset > 100000} onPress={() => void refresh(captured, false, snapshot.page.nextOffset!)} />
                        {snapshot.page.nextOffset !== null && snapshot.page.nextOffset > 100000 && <PrivacyText>Later records are outside the available history window.</PrivacyText>}
                    </View>}
                </>}
            </>}
            {exported && <GlassCard><PrivacyText title>Export ready</PrivacyText><PrivacyText>SHA256 {exported.checksum}</PrivacyText><PillButton label='Share or save export' disabled={disabled} onPress={() => void share()} /></GlassCard>}
        </View>
    </Screen>
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : 'Privacy is unavailable. Refresh to retry.' }
