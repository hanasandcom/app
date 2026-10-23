import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, AppState, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { randomUUID } from 'expo-crypto'
import type { AppSettings } from '../types'
import { GlassCard, InlineNotice, PillButton, Screen } from '../components/ui'
import { SystemController, type SystemIntent } from '../features/system/controller'
import { applyLive, bytes, intentScope, measured, ownAccount, staleTelemetry, systemScope, SystemError, type Access, type Container, type RuntimeLogs, type Storage, type Telemetry } from '../features/system/model'
import { systemServices, type SystemServices } from '../features/system/services'
import { StoragePanel } from '../features/system/StoragePanel'
import { ContainersPanel } from '../features/system/ContainersPanel'
import { pollStorage } from '../features/system/storage-poll'
import { SystemActions, SystemText } from '../features/system/ui'
export type SystemScreenProps = { settings: AppSettings; mode: 'overview' | 'containers'; onOpenLogs: (service?: string) => void; onOpenVms: () => void; services?: SystemServices }
export function SystemScreen(props: SystemScreenProps) { return <SystemWorkspace key={`${systemScope(props.settings)}:${props.mode}`} {...props} /> }
function SystemWorkspace({ settings, mode, onOpenLogs, onOpenVms, services: injected }: SystemScreenProps) {
    const services = useMemo(() => injected || systemServices(settings), [injected, settings])
    const ops = useRef(new SystemController(intentScope(settings))).current
    const [access, setAccess] = useState<Access | null>(null), [snapshot, setSnapshot] = useState<Telemetry | null>(null), [storage, setStorage] = useState<Storage | null>(null)
    const [error, setError] = useState(''), [notice, setNotice] = useState(''), [storageError, setStorageError] = useState('')
    const [visible, setVisible] = useState(false), [auto, setAuto] = useState(true), [reconnect, setReconnect] = useState(0), [liveStatus, setLiveStatus] = useState('Not connected')
    const [selected, setSelected] = useState(''), [logs, setLogs] = useState<RuntimeLogs | null>(null), [logsError, setLogsError] = useState(''), [logsBusy, setLogsBusy] = useState(false)
    const [, render] = useState(0), [statistics, setStatistics] = useState(true)
    const mounted = useRef(true), focused = useRef(false), foreground = useRef(AppState.currentState === 'active'), logRequest = useRef<AbortController | null>(null)
    const latest = useRef({ access, snapshot, storage, selected }); latest.current = { access, snapshot, storage, selected }
    const publish = () => { if (mounted.current) render(n => n + 1) }
    const captured = ops.generation
    function hide() { ops.hide(); logRequest.current?.abort(); logRequest.current = null; setVisible(false); setAccess(null); setSnapshot(null); setStorage(null); setLogs(null); setSelected(''); setLogsBusy(false); publish() }
    async function refresh(generation: number, manual: boolean) {
        const read = ops.beginRead(generation, manual)
        if (!read) return
        logRequest.current?.abort(); setLogs(null); setLogsError(''); setError(''); setStorageError(''); setAccess(null); publish()
        let complete = false, canRead = false
        try {
            const permission = await services.access(read.controller.signal)
            if (!ops.current(read.ticket.generation)) return
            setAccess(permission)
            canRead = permission.canRead && permission.scope === systemScope(settings)
            if (!canRead) { setSnapshot(null); setStorage(null); return }
            const [telemetry, disk] = await Promise.allSettled([services.telemetry(read.controller.signal), mode === 'overview' || ops.unknown?.kind === 'cleanup' ? services.storage(read.controller.signal) : Promise.resolve(null)])
            if (!ops.current(read.ticket.generation)) return
            if (telemetry.status === 'fulfilled') { setSnapshot(telemetry.value); latest.current.snapshot = telemetry.value } else { setSnapshot(null); setError(message(telemetry.reason)) }
            if (disk.status === 'fulfilled') setStorage(disk.value); else { setStorage(null); setStorageError(message(disk.reason)) }
            const unknown = ops.unknown
            complete = telemetry.status === 'fulfilled' && (!unknown || unknown.kind !== 'cleanup' || disk.status === 'fulfilled' && disk.value !== null)
        } catch (cause) { if (ops.current(read.ticket.generation)) setError(message(cause)) }
        finally { if (ops.finishRead(read.ticket, complete, canRead)) publish() }
    }
    useFocusEffect(useCallback(() => {
        mounted.current = true; focused.current = true; ops.visible = foreground.current; setVisible(ops.visible)
        if (ops.visible) void refresh(ops.generation, false)
        return () => { focused.current = false; hide() }
    }, [services]))
    useEffect(() => {
        mounted.current = true
        const subscription = AppState.addEventListener('change', state => {
            const previous = foreground.current; foreground.current = state === 'active'
            if (!foreground.current) hide()
            else if (!previous && focused.current) { ops.visible = true; setVisible(true); void refresh(ops.generation, false) }
        })
        return () => { mounted.current = false; ops.hide(); logRequest.current?.abort(); subscription.remove() }
    }, [services])
    useEffect(() => {
        if (!visible || !auto || !access?.canWrite || !ownAccount(settings)) return
        const controller = new AbortController()
        let stop = () => {}
        const current = () => mounted.current && ops.visible && !controller.signal.aborted
        void services.live(controller.signal, {
            data: value => { if (!current() || ops.reading || ops.writing) return; const previous = latest.current.snapshot; if (!previous) return; try { const next = applyLive(previous, value); latest.current.snapshot = next; setSnapshot(next) } catch (cause) { setError(message(cause)); controller.abort(); stop() } },
            status: value => { if (current()) setLiveStatus(value) },
            error: cause => { if (!current()) return; setError(message(cause)); if (cause.status === 403) { ops.needsReview = true; setAccess(null); publish() } },
        }).then(close => { if (controller.signal.aborted) close(); else stop = close }).catch(cause => { if (current()) setError(message(cause)) })
        return () => { controller.abort(); stop() }
    }, [visible, auto, access?.canWrite, reconnect, services])
    useEffect(() => {
        if (!visible || mode !== 'overview' || !access?.canRead || access.scope !== systemScope(settings)) return
        return pollStorage({
            load: services.storage,
            current: () => mounted.current && ops.current(captured),
            busy: () => ops.reading || ops.writing,
            value: () => latest.current.storage,
            data: value => { latest.current.storage = value; setStorage(value); setStorageError('') },
            error: cause => {
                setStorageError(message(cause))
                if (cause instanceof SystemError && [401, 403].includes(cause.status)) { ops.needsReview = true; setAccess(null); publish() }
            },
        })
    }, [visible, mode, access, captured, services, settings])
    async function runtimeLogs(id: string, generation: number) {
        if (!ops.usable(generation)) return
        const container = latest.current.snapshot?.containers.find(c => c.id === id)
        if (!container) return
        logRequest.current?.abort(); const controller = new AbortController(); logRequest.current = controller
        setLogsBusy(true); setLogsError(''); setLogs(null)
        try { const value = await services.logs(container.name, controller.signal); if (!controller.signal.aborted && ops.current(generation) && latest.current.selected === id) setLogs(value) }
        catch (cause) { if (!controller.signal.aborted && ops.current(generation)) setLogsError(message(cause)) }
        finally { if (logRequest.current === controller) { logRequest.current = null; if (mounted.current) setLogsBusy(false) } }
    }
    function select(id: string) {
        if (!ops.context(captured)) return
        logRequest.current?.abort(); latest.current.selected = id; setSelected(id); setLogs(null); publish()
        void runtimeLogs(id, ops.generation)
    }
    const writable = ops.usable(captured) && !ops.locked && !!access?.canWrite && ownAccount(settings) && !!snapshot && !staleTelemetry(snapshot)
    function review(kind: SystemIntent['kind'], container?: Container) {
        if (!writable || kind === 'restart' && (!container || selected !== container.id) || kind === 'cleanup' && (!storage || storage.stale || storage.running || storage.queued || !!storage.error)) return
        const generation = captured, target = container?.id || 'docker-storage', name = container?.name
        Alert.alert(kind === 'restart' ? `Restart ${name}?` : 'Clear unused Docker storage?', kind === 'restart' ? 'Active requests may be interrupted. Closing this screen does not cancel the restart.' : 'The host cleanup service will clear eligible build cache and unused images, preserving its rollback policy.', [
            { text: 'Cancel', style: 'cancel' }, { text: kind === 'restart' ? 'Restart' : 'Queue cleanup', style: 'destructive', onPress: () => {
                const current = latest.current
                if (!ops.usable(generation) || ops.locked || !current.access?.canWrite || !current.snapshot || staleTelemetry(current.snapshot)
                    || kind === 'restart' && (current.selected !== target || !current.snapshot.containers.some(c => c.id === target && c.name === name))) return
                void perform({ token: randomUUID(), kind, target }, generation)
            } },
        ])
    }
    async function perform(intent: SystemIntent, generation: number) {
        const current = latest.current
        if (!current.access || !current.snapshot || !ownAccount(settings)) return
        const write = ops.beginWrite(generation, intent)
        if (!write) { setError('A previous action remains unresolved, or the unresolved action limit was reached.'); return }
        logRequest.current?.abort(); setLogsBusy(false); setError(''); setNotice(''); publish()
        try {
            const permission = await services.access(write.controller.signal)
            if (!ops.current(write.generation) || !permission.canWrite || permission.scope !== systemScope(settings)) throw new SystemError('Current editing access could not be verified.', 403)
            if (intent.kind === 'restart') await services.restart(permission, current.snapshot, intent.target, write.controller.signal)
            else if (current.storage) await services.cleanup(permission, current.storage, write.controller.signal)
            else throw new SystemError('Current storage figures are unavailable.')
            if (ops.finishWrite(write.generation, intent, true)) setNotice(intent.kind === 'restart' ? 'Restart request accepted. Refresh to inspect current state; completion is not confirmed.' : 'Cleanup queued. Refresh to inspect host progress.')
        } catch (cause) {
            const confirmedNoWrite = cause instanceof SystemError && !cause.uncertain
            if (ops.finishWrite(write.generation, intent, confirmedNoWrite)) setError(message(cause))
        } finally { publish() }
    }
    function acknowledge() {
        const intent = ops.unknown, generation = captured
        if (!intent || !ops.canAcknowledge || !ops.usable(generation)) return
        Alert.alert('Finish reviewing the uncertain action?', 'A fresh read cannot prove whether the previous action ran. Review the current state. This clears the local barrier for a new action; it does not retry or confirm the previous action.', [
            { text: 'Cancel', style: 'cancel' }, { text: 'I reviewed the state', onPress: () => { if (ops.acknowledge(generation, intent.token)) { setNotice('Review acknowledged. No previous action was repeated.'); publish() } } },
        ])
    }
    return <Screen title={mode === 'overview' ? 'System' : 'Containers'} subtitle='Hanasand infrastructure · Core runtime' right={<PillButton key={`refresh:${captured}`} label={ops.reading ? 'Loading…' : 'Refresh'} disabled={!ops.usable(captured)} onPress={() => void refresh(captured, true)} />}>
        {!!error && <InlineNotice message={error} />}{!!notice && <InlineNotice tone='info' message={notice} />}
        {ops.locked && <GlassCard>
            <View style={{ gap: 10 }}>
                <SystemText>{ops.unknown ? `Outcome unknown: ${ops.unknown.kind} · ${ops.unknown.target}. Refresh manually and review current state. No automatic retry will occur.` : 'Refresh manually before another action.'}</SystemText>{ops.canAcknowledge && <PillButton key={`ack:${captured}`} label='Review uncertain action' onPress={acknowledge} />}</View>
        </GlassCard>}
        {!visible ? <SystemText>System operations are paused while hidden.</SystemText> : access?.canRead === false ? <GlassCard>
            <View style={{ gap: 10 }}>
                <SystemText>Your session does not have internal system visibility. Continue to your virtual machines.</SystemText>
                <PillButton label='Open virtual machines' onPress={() => { if (ops.usable(captured)) onOpenVms() }} />
            </View>
        </GlassCard> : <>
            <SystemActions key={`telemetry:${captured}`}>
                <PillButton label={auto ? 'Pause live telemetry' : 'Enable live telemetry'} disabled={!ops.usable(captured)} onPress={() => { if (ops.context(captured)) { setAuto(!auto); publish() } }} />
                <PillButton label='Reconnect live' disabled={!ops.usable(captured) || !access?.canWrite || !auto} onPress={() => { if (ops.context(captured)) { setReconnect(n => n + 1); publish() } }} />{mode === 'overview' && <PillButton label={statistics ? 'Hide statistics' : 'Show statistics'} onPress={() => setStatistics(!statistics)} />}</SystemActions>
            <SystemText>{access?.canWrite ? liveStatus : 'Live stream requires editing access; permitted reads remain available through Refresh.'}</SystemText>
            {(settings.impersonationToken || settings.impersonatingUserId) && <InlineNotice message='Actions and live telemetry are unavailable while impersonating.' />}
            {snapshot && <>
                {staleTelemetry(snapshot) && <InlineNotice message='The system snapshot is stale. Refresh before taking action.' />}
                {!!snapshot.reason && <InlineNotice message={snapshot.reason} />}{!!snapshot.dockerReason && <InlineNotice message={snapshot.dockerReason} />}
                {mode === 'overview' && statistics && <GlassCard>
                    <View style={{ gap: 8 }}>
                        <SystemText heading>System statistics</SystemText>
                        <SystemText>CPU load (1 / 5 / 15 min): {snapshot.load.length ? snapshot.load.map(v => measured(v)).join(' / ') : 'Unavailable'}{ '\n' }Memory {bytes(snapshot.memoryUsed)} / {bytes(snapshot.memoryTotal)} · {measured(snapshot.memoryPercent, '%')}{ '\n' }Containers {snapshot.containers.filter(c => c.state.toLowerCase() === 'running').length} running / {snapshot.containers.filter(c => !['exited', 'dead', 'removing'].includes(c.state.toLowerCase())).length} active{ '\n' }VMs {measured(snapshot.vmCount)} · {measured(snapshot.runningVms)} running · {measured(snapshot.stoppedVms)} stopped{ '\n' }Sample {snapshot.generatedAt}</SystemText>
                        <PillButton label='Open virtual machines' onPress={() => { if (ops.usable(captured)) onOpenVms() }} />
                    </View>
                </GlassCard>}
                {mode === 'containers' && <ContainersPanel snapshot={snapshot} selected={selected} logs={logs} logsBusy={logsBusy} logsError={logsError} host={captured} canWrite={writable} onSelect={select} onRestart={c => review('restart', c)} onLogs={() => void runtimeLogs(selected, captured)} onOpenLogs={service => { if (ops.usable(captured)) onOpenLogs(service) }} />}
            </>}
            {mode === 'overview' && <>
                <InlineNotice message={storageError} />{storage && <StoragePanel value={storage} host={captured} canWrite={writable} onCleanup={() => review('cleanup')} />}</>}
        </>}
    </Screen>
}
function message(e: unknown) { return e instanceof SystemError ? e.message : 'System operations are unavailable. Refresh to try again.' }
