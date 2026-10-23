import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, AppState } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { randomUUID } from 'expo-crypto'
import type { AppSettings } from '../../types'
import { AccountController, type Intent, type Operation } from './controller'
import { acceptsAccountResult, freshAccountWrite } from './actions'
import { ServiceAccountError, type Access, type Directory } from './model'
import type { Services } from './api'
export function useAccounts(settings: AppSettings, services: Services) {
    const controller = useRef(new AccountController(settings)).current
    const [directory, setDirectory] = useState<Directory | null>(null), [access, setAccess] = useState<Access | null>(null)
    const [message, setMessage] = useState(''), [error, setError] = useState(''), [secret, setSecret] = useState(''), [visible, setVisible] = useState(false)
    const [, render] = useState(0), focused = useRef(false), foreground = useRef(AppState.currentState === 'active'), mounted = useRef(true)
    const publish = () => { if (mounted.current) render(n => n + 1) }
    const clearPrivate = () => setSecret('')
    const hide = () => { controller.hide(); setVisible(false); setSecret(''); setAccess(null); setDirectory(null); publish() }
    const refresh = useCallback(async (generation: number, manual: boolean) => {
        const ticket = controller.beginRead(generation, manual)
        if (!ticket) return
        setSecret(''); setAccess(null); setError(''); publish()
        let permission: Access | null = null, result: Directory | null = null
        try {
            permission = await services.loadAccess(settings, ticket.signal)
            if (!controller.current(ticket.generation)) return
            setAccess(permission)
            if (!permission.canRead) { setDirectory(null); setError('Active Hanasand access is required.'); return }
            result = await services.loadDirectory(settings, ticket.signal)
            if (controller.current(ticket.generation)) setDirectory(result)
        } catch { if (controller.current(ticket.generation)) { setDirectory(null); setError('Service accounts could not be loaded. Refresh to try again.') } }
        finally { if (controller.finishRead(ticket, permission, result)) publish() }
    }, [controller, settings, services])
    useFocusEffect(useCallback(() => {
        mounted.current = true; focused.current = true; controller.visible = foreground.current; setVisible(controller.visible)
        if (controller.visible) void refresh(controller.generation, false)
        return () => { focused.current = false; hide() }
    }, [controller, refresh]))
    useEffect(() => {
        const subscription = AppState.addEventListener('change', state => {
            foreground.current = state === 'active'
            if (state !== 'active') hide()
            else if (focused.current) { controller.visible = true; setVisible(true); void refresh(controller.generation, false) }
        })
        return () => { mounted.current = false; controller.hide(); subscription.remove() }
    }, [controller, refresh])
    const request = (generation: number, action: Intent['action'], target: string, explanation: string,
        run: (op: Operation, grant: Awaited<ReturnType<typeof freshAccountWrite>>) => Promise<string>) => {
        const review = controller.review(generation, action, target)
        if (!review) return
        Alert.alert(action === 'create' ? 'Create service account?' : action === 'update' ? 'Update service account?' : 'Revoke service account?', explanation,
            [{ text: 'Cancel', style: 'cancel' }, { text: 'Confirm', style: action === 'revoke' ? 'destructive' : 'default', onPress: () => {
                const operation = controller.begin(review, randomUUID())
                if (!operation) return
                setSecret(''); setError(''); setMessage(''); publish()
                void (async () => {
                    try {
                        const grant = await freshAccountWrite(settings, services, controller, operation)
                        const result = await run(operation, grant)
                        if (controller.finish(operation, true)) setMessage(result)
                    } catch (cause) {
                        const definite = cause instanceof ServiceAccountError && !cause.uncertain
                        if (controller.finish(operation, definite)) setError(definite ? cause.message : 'The outcome is unknown. Do not repeat the original request. Refresh the full account list and review it before another action.')
                    } finally { publish() }
                })()
            } }])
    }
    return { controller, directory, access, visible, message, error, secret, refresh, request, publish, clearPrivate,
        acceptSecret: (op: Operation, value: string) => { if (acceptsAccountResult(settings, controller, op)) setSecret(value) },
        writable: visible && controller.idle(controller.generation) && controller.canWrite && !controller.locked }
}
export type AccountsWorkspace = ReturnType<typeof useAccounts>
