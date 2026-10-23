import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { useIsFocused } from '@react-navigation/native'
import type { AppSettings } from '../../types'
import { createThesisApi, ownAccount, ThesisError, type ThesisApi } from './api'
import { sameContent, ThesisState, type ThesisDocument } from './document'
import { nativeRecovery, initializeRecovery, type RecoveredDraft, type ThesisRecovery, type RecoveryController } from './recovery'
import { thesisLive, type ThesisLive } from './live'
import { canApplyThesisRead, canEditThesisInput } from './policy'

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
    const [connection, reconnect] = useState(0)
    const state = useRef<ThesisState | null>(null)
    const recovery = useRef<RecoveryController | null>(null)
    const alive = useRef(false)
    const epoch = useRef(0)
    const generation = useRef(0)
    const pendingRead = useRef(false)
    const authorizationVersion = useRef(0)
    const readController = useRef<AbortController | null>(null)
    const saveController = useRef<AbortController | null>(null)
    const scope = JSON.stringify([settings.userId, settings.authToken, settings.apiBaseUrl, settings.siteBaseUrl, settings.impersonationToken, settings.impersonatingUserId])
    const api = useMemo(() => services?.api ?? createThesisApi(settings), [scope, services?.api]) // settings change is represented by scope
    const notify = () => render(v => v + 1)
    const renew = () => { generation.current++; setHost(generation.current) }
    const visible = focused && active
    const persist = useCallback(async () => {
        const current = state.current
        const storage = recovery.current
        const capturedEpoch = epoch.current
        if (!current || !storage) return
        try { await storage.persist(current.dirty || current.unknown || current.conflict ? current.draft : null, current.unknown || current.pending) }
        catch { if (alive.current && epoch.current === capturedEpoch) setError('The encrypted draft could not be saved on this device. Keep this screen open until your draft is saved to the service.') }
    }, [])

    const refresh = useCallback(async () => {
        if (!alive.current || pendingRead.current || state.current?.pending) return
        const currentEpoch = epoch.current
        const currentOperation = state.current?.operation ?? 0
        const authorization = authorizationVersion.current
        const controller = new AbortController(); readController.current = controller
        pendingRead.current = true
        try {
            ownAccount(settings)
            const [access, value] = await Promise.all([api.access(controller.signal), api.load(controller.signal)])
            if (!alive.current || controller.signal.aborted || epoch.current !== currentEpoch) return
            if (!access.member) throw new ThesisError('Hanasand organization membership is required.', 403)
            const validTicket = canApplyThesisRead({ operation: currentOperation, authorization }, { operation: state.current?.operation ?? 0, authorization: authorizationVersion.current, pending: state.current?.pending ?? false })
            if (validTicket) setCanEdit(access.canEdit)
            if (!state.current) state.current = new ThesisState(value)
            else state.current.receive(value, validTicket)
            renew(); notify(); setError('')
            if (!recovery.current) {
                const initialized = await initializeRecovery(
                    services?.recovery ?? (() => nativeRecovery(settings.userId, settings.apiBaseUrl, settings.siteBaseUrl)),
                    state.current.draft,
                    () => alive.current && epoch.current === currentEpoch,
                )
                if (!initialized) return
                const { controller, candidate } = initialized
                recovery.current = controller
                if (candidate?.draft && !sameContent(candidate.draft, state.current.draft)) setRecovered(candidate)
            }
            reconnect(v => v + 1)
            await persist()
        } catch (cause) {
            if (!controller.signal.aborted && alive.current && currentEpoch === epoch.current) {
                setError(cause instanceof Error ? cause.message : 'The thesis could not be loaded.')
                if (cause instanceof ThesisError && [401, 403].includes(cause.status)) { authorizationVersion.current++; setCanEdit(false); renew() }
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
                const beforeSubmission = cause instanceof ThesisError && cause.submitted === false
                model.failed(cause instanceof ThesisError ? cause.current : undefined, !beforeSubmission)
                setError(beforeSubmission ? 'The save was cancelled before submission. Your draft is kept.' : cause instanceof ThesisError && cause.status === 409 ? cause.message : 'The save outcome is uncertain. Your draft is kept. Refresh and review before another save.')
                if (cause instanceof ThesisError && [401, 403].includes(cause.status)) { authorizationVersion.current++; setCanEdit(false) }
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
        return () => {
            alive.current = false; epoch.current++; generation.current++
            readController.current?.abort(); saveController.current?.abort()
            if (state.current?.pending) state.current.failed()
            void persist()
            state.current = null; recovery.current = null; pendingRead.current = false
            setRecovered(null)
        }
    }, [visible, scope, api])

    useEffect(() => {
        if (!visible || !state.current || !connection) return
        const controller = new AbortController()
        let stop: (() => void) | undefined
        const currentEpoch = epoch.current
        void (services?.live ?? thesisLive)(settings, controller.signal, value => {
            if (!alive.current || epoch.current !== currentEpoch) return
            const model = state.current
            const previousConflict = model?.conflict
            const previousDraft = model?.draft
            model?.receive(value)
            if (model && (previousConflict !== model.conflict || previousDraft && !sameContent(previousDraft, model.draft))) renew()
            notify(); void persist()
        }, (message, denied) => {
            if (!alive.current || epoch.current !== currentEpoch) return
            setLive(message)
            if (denied) { authorizationVersion.current++; setCanEdit(false); renew() }
        }).then(close => { if (controller.signal.aborted) close(); else stop = close }).catch(() => { if (alive.current && epoch.current === currentEpoch) setLive('Live unavailable. Refresh to reconnect.') })
        return () => { controller.abort(); stop?.() }
    }, [visible, scope, api, connection])

    useEffect(() => {
        if (!visible || !canEdit || recovered || !state.current?.dirty || state.current.pending || state.current.unknown || state.current.conflict) return
        const timer = setTimeout(() => void save(), 5000)
        return () => clearTimeout(timer)
    }, [version, visible, canEdit, recovered, save])

    function edit(value: ThesisDocument, capturedGeneration: number, group = '', structural = false) {
        const model = state.current
        if (!model || !canEditThesisInput({ alive: alive.current, generation: capturedGeneration, currentGeneration: generation.current, canEdit, unknown: model.unknown, conflict: !!model.conflict, recovering: !!recovered })) return
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
        recovery.current?.decide()
        setRecovered(null); renew(); notify(); void persist()
    }
    return { state: state.current, api, visible, epoch, generation, host, loading, canEdit: canEdit && !loading && !recovered, error, liveState, recovered, refresh, save, edit, resolve, recover, notify, persist, renew }
}
