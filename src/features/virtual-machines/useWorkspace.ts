import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, AppState } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { randomUUID } from 'expo-crypto'
import type { AppSettings } from '../../types'
import { VmController, type VmOperation, type VmOperationKind } from './controller'
import { emptySnapshot, preserveVmSnapshot, readVmWorkspace } from './read'
import { acceptsVmResult, freshVmOperation, type FreshVm } from './action'
import { canCreateVm } from './authority'
import { ownAccount, VmError } from './transport'
import type { VmConsole } from './console'
import type { VmServices } from './services'
export function useVmWorkspace(settings: AppSettings, services: VmServices) {
    const ops = useRef(new VmController(settings)).current
    const [snapshot, setSnapshot] = useState(emptySnapshot), [selected, setSelected] = useState('')
    const [message, setMessage] = useState(''), [error, setError] = useState(''), [visible, setVisible] = useState(false)
    const [secret, setSecret] = useState(''), [connection, setConnection] = useState(''), [channel, setChannel] = useState<VmConsole | null>(null)
    const [boot, setBoot] = useState(''), [bootStatus, setBootStatus] = useState('')
    const [, render] = useState(0), mounted = useRef(true), focused = useRef(false), foreground = useRef(AppState.currentState === 'active')
    const selection = useRef(''), privateEpoch = useRef(0)
    const publish = () => { if (mounted.current) render(n => n + 1) }
    useEffect(() => ops.onClearPrivate(() => {
        privateEpoch.current++; setSecret(''); setConnection(''); setChannel(null); setBoot(''); setBootStatus('')
    }), [ops])
    const refresh = useCallback(async (generation: number, manual: boolean, target = selection.current, previous?: ReturnType<typeof emptySnapshot>) => {
        const read = ops.beginRead(generation, manual, target)
        if (!read) return
        setError(''); publish()
        try {
            const value = await readVmWorkspace(settings, read, services, partial => {
                if (ops.current(read.generation)) setSnapshot(previous => preserveVmSnapshot(previous, partial))
            }, previous)
            if (!ops.current(read.generation)) return
            setSnapshot(value)
            if (read.intent && value.vm) { selection.current = read.target; setSelected(read.target) }
            ops.finishRead(read, { target: read.target, authorized: value.reads.inventory && (!read.kind || !['create', 'reprovision', 'setup_plan'].includes(read.kind) || canCreateVm(settings, value.organizations)), reads: value.reads })
        } catch {
            if (ops.current(read.generation)) {
                setError('VM information could not be loaded.')
                ops.finishRead(read, { target: read.target, authorized: false, reads: emptySnapshot().reads })
            }
        } finally { publish() }
    }, [ops, settings, services])
    useFocusEffect(useCallback(() => {
        mounted.current = true; focused.current = true; ops.visible = foreground.current; setVisible(ops.visible)
        if (ops.visible) void refresh(ops.generation, false)
        return () => { focused.current = false; ops.hide(); setVisible(false); publish() }
    }, [ops, refresh]))
    useEffect(() => {
        const sub = AppState.addEventListener('change', state => {
            foreground.current = state === 'active'
            if (state !== 'active') { ops.hide(); setVisible(false); setSnapshot(emptySnapshot()); publish() }
            else if (focused.current) { ops.visible = true; setVisible(true); void refresh(ops.generation, false) }
        })
        return () => { mounted.current = false; ops.hide(); sub.remove() }
    }, [ops, refresh])
    const select = (generation: number, target: string) => {
        const switchedDuringRead = snapshot.reads.inventory && ops.reading && ops.switchTarget(generation)
        if (!switchedDuringRead && !ops.context(generation)) return
        const workspace = { ...snapshot, vm: null, management: null, details: null, metrics: null, errors: [], reads: { ...snapshot.reads, target: false, management: false, details: false, services: false } }
        selection.current = target; setSelected(target); setMessage(''); setSnapshot(workspace); publish(); void refresh(ops.generation, false, target, workspace)
    }
    const request = (generation: number, kind: VmOperationKind, target: string, title: string, explanation: string,
        run: (op: VmOperation, grant: FreshVm) => Promise<string>, possibleStart = false, confirm = true) => {
        const review = ops.review(generation, kind, target, possibleStart)
        if (!review) return
        const dispatch = () => {
            const op = ops.begin(review, randomUUID())
            if (!op) return
            setError(''); setMessage(''); publish()
            void (async () => {
                try {
                    const grant = await freshVmOperation(settings, services, ops, op)
                    const result = await run(op, grant)
                    if (ops.finish(op, true) && kind !== 'console') setMessage(result)
                } catch (cause) {
                    // Only a verified non-dispatch/rejection may clear an intent; transport uncertainty stays scoped across remounts.
                    const definite = cause instanceof VmError ? !cause.uncertain : kind === 'console'
                    if (!definite && kind === 'console') ops.rememberUncertain(op)
                    if (ops.finish(op, definite)) setError(definite
                        ? cause instanceof Error ? cause.message : 'The VM console could not be opened. Try again.'
                        : kind === 'console' ? 'The VM could not be confirmed as started. Refresh its status before reconnecting.'
                            : 'The operation outcome is unknown. Refresh current state before trying again.')
                } finally { publish() }
            })()
        }
        if (!confirm) { dispatch(); return }
        Alert.alert(title, explanation, [{ text: 'Cancel', style: 'cancel' }, { text: 'Confirm', style: ['delete', 'stop_all'].includes(kind) ? 'destructive' : 'default', onPress: dispatch }])
    }
    const openConsole = (generation: number) => request(generation, 'console', selected, 'Open VM console', 'Opening the console may start this VM if it is stopped.', async op => {
        const ownedEpoch = privateEpoch.current
        const live = services.openConsole(settings, ops, op, randomUUID(), {
            onBootOutput: data => { if (ops.sessionCurrent(settings) && privateEpoch.current === ownedEpoch) setBoot(value => `${value}${data}`.slice(-32768)) },
            onBootStatus: status => { if (ops.sessionCurrent(settings) && privateEpoch.current === ownedEpoch) setBootStatus(status) },
            onClear: () => { if (privateEpoch.current === ownedEpoch) { setChannel(null); setBoot(''); setBootStatus('') } },
        })
        if (ops.operationCurrent(op)) setChannel(live)
        await live.opened
        return ''
    }, true, false)
    return { ops, snapshot, selected, message, error, visible, secret, connection, channel, boot, bootStatus,
        refresh, select, request, openConsole, publish,
        setSecret: (op: VmOperation, value: string) => { if (acceptsVmResult(ops, op, settings)) setSecret(value) },
        setConnection: (op: VmOperation, value: string) => { if (acceptsVmResult(ops, op, settings)) setConnection(value) },
        dismissPrivate: () => { channel?.close(); setSecret(''); setConnection(''); setChannel(null); setBoot(''); setBootStatus('') },
        writable: ownAccount(settings) && visible && ops.idle(ops.generation) && !ops.locked,
    }
}
export type VmWorkspace = ReturnType<typeof useVmWorkspace>
