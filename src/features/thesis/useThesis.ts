import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { useIsFocused } from '@react-navigation/native'
import type { AppSettings } from '../../types'
import { createThesisApi, ownAccount, ThesisError, type ThesisApi } from './api'
import { sameContent, ThesisState, type ThesisDocument } from './document'
import { nativeRecovery, type RecoveredDraft, type ThesisRecovery } from './recovery'
import { thesisLive, type ThesisLive } from './live'

export type ThesisServices = { api?: ThesisApi; live?: ThesisLive; recovery?: () => Promise<ThesisRecovery> }
export function useThesis(settings: AppSettings, services?: ThesisServices) {
    const focused = useIsFocused()
    const [active, setActive] = useState(AppState.currentState === 'active')
    const [version, render] = useState(0)
    const [error, setError] = useState('')
    const [liveState, setLive] = useState('Connecting')
    const [canEdit, setCanEdit] = useState(false)
    const [loading, setLoading] = useState(true)
    const [host, setHost] = useState(0)
    const [recovered, setRecovered] = useState<RecoveredDraft | null>(null)
    const state = useRef<ThesisState | null>(null)
    const recovery = useRef<ThesisRecovery | null>(null)
    const alive = useRef(false)
    const epoch = useRef(0)
    const generation = useRef(0)
    const pendingRead = useRef(false)
    const readController = useRef<AbortController | null>(null)
    const saveController = useRef<AbortController | null>(null)
    const scope = JSON.stringify([settings.userId, settings.authToken, settings.apiBaseUrl, settings.siteBaseUrl, settings.impersonationToken, settings.impersonatingUserId])
    const api = useMemo(() => services?.api ?? createThesisApi(settings), [scope, services?.api]) // settings change is represented by scope
    const notify = () => render(v => v + 1)
    const renew = () => { generation.current++; setHost(generation.current) }
    const visible = focused && active
    const persist = useCallback(async () => {
        const current = state.current
        if (!current || !recovery.current) return
        try { await recovery.current.save(current.dirty || current.unknown || current.conflict ? current.draft : null, current.unknown || current.pending) }
        catch { if (alive.current) setError('The encrypted draft could not be saved on this device. Keep this screen open until your draft is saved to the service.') }
    }, [])

    const refresh = useCallback(async () => {
        if (!alive.current || pendingRead.current || state.current?.pending) return
        const currentEpoch = epoch.current
        const currentOperation = state.current?.operation ?? 0
        const controller = new AbortController(); readController.current = controller
        pendingRead.current = true
        try {
            ownAccount(settings)
            const [access, value] = await Promise.all([api.access(controller.signal), api.load(controller.signal)])
            if (!alive.current || controller.signal.aborted || epoch.current !== currentEpoch) return
            if (!access.member) throw new ThesisError('Hanasand organization membership is required.', 403)
            setCanEdit(access.canEdit)
            if (!state.current) state.current = new ThesisState(value)
            else state.current.receive(value, !state.current.pending && state.current.operation === currentOperation)
            renew(); notify(); setError('')
            if (!recovery.current) {
                recovery.current = await (services?.recovery ? services.recovery() : nativeRecovery(settings.userId, settings.apiBaseUrl, settings.siteBaseUrl))
                const candidate = await recovery.current.load()
                if (!alive.current || epoch.current !== currentEpoch) return
                if (candidate?.draft && !sameContent(candidate.draft, state.current.draft)) setRecovered(candidate)
            }
            await persist()
        } catch (cause) {
            if (!controller.signal.aborted && alive.current && currentEpoch === epoch.current) {
                setError(cause instanceof Error ? cause.message : 'The thesis could not be loaded.')
                if (cause instanceof ThesisError && [401, 403].includes(cause.status)) { setCanEdit(false); renew() }
            }
        } finally {
            if (readController.current === controller) { readController.current = null; pendingRead.current = false; if (alive.current) setLoading(false) }
        }
    }, [api, scope, persist, services?.recovery])

    const save = useCallback(async () => {
        const model = state.current
        if (!alive.current || !model || !canEdit || recovered || model.pending || model.unknown || model.conflict || !model.dirty) return false
        let sent: ThesisDocument
        try { sent = model.beginSave() } catch (cause) { setError((cause as Error).message); return false }
        const currentEpoch = epoch.current
        const controller = new AbortController(); saveController.current = controller
        renew(); notify(); void persist()
        try {
            const saved = await api.save(sent, controller.signal)
            if (epoch.current !== currentEpoch || !alive.current) return false
            model.saved(sent, saved); setError(''); return true
        } catch (cause) {
            if (epoch.current === currentEpoch && alive.current) {
                model.failed(cause instanceof ThesisError ? cause.current : undefined)
                setError(cause instanceof ThesisError && cause.status === 409 ? cause.message : 'The save outcome is uncertain. Your draft is kept. Refresh and review before another save.')
                if (cause instanceof ThesisError && [401, 403].includes(cause.status)) setCanEdit(false)
            }
            return false
        } finally {
            if (saveController.current === controller) saveController.current = null
            if (epoch.current === currentEpoch && alive.current) { renew(); notify(); void persist() }
        }
    }, [api, canEdit, recovered, persist])

    useEffect(() => { const listener = AppState.addEventListener('change', value => setActive(value === 'active')); return () => listener.remove() }, [])
    useEffect(() => {
        epoch.current++; alive.current = visible; renew()
        if (!visible) return
        setLoading(true); setCanEdit(false); setError(''); setLive('Connecting')
        void refresh()
        const controller = new AbortController()
        let stop: (() => void) | undefined
        const currentEpoch = epoch.current
        void (services?.live ?? thesisLive)(settings, controller.signal, value => {
            if (!alive.current || epoch.current !== currentEpoch) return
            state.current?.receive(value); notify(); void persist()
        }, (message, denied) => {
            if (!alive.current || epoch.current !== currentEpoch) return
            setLive(message)
            if (denied) { setCanEdit(false); renew() }
        }).then(close => { if (controller.signal.aborted) close(); else stop = close }).catch(() => { if (alive.current && epoch.current === currentEpoch) setLive('Live unavailable. Refresh to reconnect.') })
        return () => {
            alive.current = false; epoch.current++; generation.current++
            controller.abort(); stop?.(); readController.current?.abort(); saveController.current?.abort()
            if (state.current?.pending) state.current.failed()
            void persist()
            state.current = null; recovery.current = null; pendingRead.current = false
            setRecovered(null)
        }
    }, [visible, scope, api])

    useEffect(() => {
        if (!visible || !canEdit || recovered || !state.current?.dirty || state.current.pending || state.current.unknown || state.current.conflict) return
        const timer = setTimeout(() => void save(), 5000)
        return () => clearTimeout(timer)
    }, [version, visible, canEdit, recovered, save])

    function edit(value: ThesisDocument, capturedGeneration: number, group = '', structural = false) {
        const model = state.current
        if (!alive.current || capturedGeneration !== generation.current || !canEdit || !model || model.unknown || model.conflict || recovered) return
        try { model.edit(value, group); if (structural) renew(); notify(); void persist() }
        catch (cause) { setError((cause as Error).message) }
    }
    function resolve(useLocal: boolean) { if (!alive.current || !canEdit) return; state.current?.resolve(useLocal); renew(); notify(); void persist() }
    function recover(use: boolean) {
        if (!alive.current || !state.current || !recovered) return
        if (use && recovered.draft) {
            const current = state.current
            current.edit({ ...recovered.draft, revision: current.base.revision })
            current.unknown = recovered.uncertain
            // Recovery always requires an explicit comparison before replacing remote content.
            current.conflict = { ...current.base }
        }
        setRecovered(null); renew(); notify(); void persist()
    }
    return { state: state.current, api, visible, epoch, generation, host, loading, canEdit: canEdit && !loading && !recovered, error, liveState, recovered, refresh, save, edit, resolve, recover, notify, persist, renew }
}
