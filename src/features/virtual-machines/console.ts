// Protocol source: Core6b handlers/vms/console.ts, consoleSession.ts, lxdConsole.ts and frontend/utils/vms/prepareConsole.ts.
import type { AppSettings } from '../../types'
import * as api from './api'
import { name, object, requireCurrent, requireManage, string } from './model'
import { VmError, utf8Size, vmUrl } from './transport'
import type { VmController, VmOperation } from './controller'
// Structurally matches the sealed terminal/channel.ts interface; no dependency on its in-progress implementation.
export type ConsoleEvent = { type: 'state'; state: 'connecting' | 'ready' | 'closed'; message?: string } | { type: 'output'; data: string }
export type ConsoleSocket = {
    readyState: number; bufferedAmount: number
    onopen: (() => void) | null; onmessage: ((event: { data: unknown }) => void) | null
    onclose: ((event: { code: number }) => void) | null; onerror: (() => void) | null
    send(data: string): void; close(): void
}
export type ConsoleDependencies = {
    loadVm: typeof api.loadVm; loadPublicServices: typeof api.loadPublicServices; power: typeof api.power
    proof: (token: string, method: string, url: string) => Promise<{ proof: string }>
    socket: (url: string, headers?: Record<string, string>) => ConsoleSocket
}
export type ConsoleOptions = {
    dependencies?: Partial<ConsoleDependencies>
    deadlines?: { prepare?: number; proof?: number }
    onBootOutput?: (data: string) => void; onBootStatus?: (message: string) => void; onClear?: () => void
}
export type VmConsole = {
    id: string; opened: Promise<void>
    subscribe(listener: (event: ConsoleEvent) => void): () => void
    input(data: string): boolean; resize(cols: number, rows: number): void; close(): void
}
let sessionSequence = 0
const defaults: ConsoleDependencies = {
    loadVm: api.loadVm, loadPublicServices: api.loadPublicServices, power: api.power,
    proof: async (...args) => (await import('../../lib/device-proof')).createDeviceProof(...args),
    socket: (url, headers) => {
        // React Native's WebSocket accepts handshake headers in its third argument.
        // The API allows the same first-party Origin that the website console sends.
        const NativeWebSocket = WebSocket as unknown as new (url: string, protocols?: string | string[], options?: { headers?: Record<string, string> }) => WebSocket
        return new NativeWebSocket(url, [], headers ? { headers } : undefined) as unknown as ConsoleSocket
    },
}
// Opening is an explicit user action. A stopped VM is started only after a fresh,
// exact-target permission check; the console handshake itself is a reconnectable session.
export function openVmConsole(settings: AppSettings, ops: VmController, operation: VmOperation, nonce: string, options: ConsoleOptions = {}): VmConsole {
    const s = { ...settings }, target = name(operation.target)
    if (operation.kind !== 'console' || operation.consoleMayStart !== true || !ops.operationCurrent(operation) || !ops.sessionCurrent(s)) throw new VmError('Review opening this console and its possible VM start first.', 403)
    if (s.userId.length > 200 || s.authToken.length > 512) throw new VmError('The signed-in session is not supported by this console.', 403)
    if (!/^[a-f0-9-]{36}$/i.test(nonce) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(target) || ['root', 'nobody'].includes(target)) throw new VmError('The console session or VM login name is invalid.')
    const dependencies = { ...defaults, ...options.dependencies }, controller = new AbortController()
    const listeners = new Set<(event: ConsoleEvent) => void>(), queue: string[] = []
    let state: ConsoleEvent & { type: 'state' } = { type: 'state', state: 'connecting', message: 'Checking current VM access…' }
    let socket: ConsoleSocket | undefined, closed = false, accepted = false, sent = false, effect = false, queueBytes = 0, sessionBytes = 0
    let width = 100, height = 30, windowAt = Date.now(), inputBytes = 0, inputs = 0, resizes = 0
    let flushTimer: ReturnType<typeof setTimeout> | undefined, reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let connectSocket: () => Promise<void> = async () => {}
    let resolveOpened: () => void = () => {}, rejectOpened: (error: VmError) => void = () => {}, settled = false
    const opened = new Promise<void>((resolve, reject) => { resolveOpened = resolve; rejectOpened = reject })
    void opened.catch(() => {}) // The caller still receives the original rejection; never log private console data.
    const current = () => !closed && ops.sessionCurrent(s) && (accepted || ops.operationCurrent(operation))
    const emit = (event: ConsoleEvent) => { for (const listener of [...listeners]) { try { listener(event) } catch { close('Console display failed. Reopen manually.'); break } } }
    function change(next: typeof state) { state = next; emit(state) }
    function close(message = 'Console closed. Reopen explicitly when ready.') {
        if (closed) return
        closed = true; state = { type: 'state', state: 'closed', message }; clearTimeout(prepareTimer); clearTimeout(flushTimer); clearTimeout(reconnectTimer)
        controller.abort(); operation.signal.removeEventListener('abort', abort); removePrivate()
        queue.length = 0; queueBytes = 0
        if (socket) { socket.onopen = null; socket.onmessage = null; socket.onclose = null; socket.onerror = null; try { socket.close() } catch { /* Closed transport cannot be reused. */ } }
        if (!settled) { settled = true; rejectOpened(new VmError(effect ? 'Console opening outcome is unknown. Review current VM state before another attempt.' : message, 0, effect)) }
        try { options.onClear?.() } catch { /* Private state cleanup cannot prevent socket closure. */ }
        emit(state); listeners.clear()
    }
    const abort = () => close('Console paused because its view or account changed.')
    const removePrivate = ops.onClearPrivate(abort)
    operation.signal.addEventListener('abort', abort, { once: true })
    const reconnect = () => {
        if (closed || reconnectTimer) return
        change({ type: 'state', state: 'connecting', message: 'Connection lost. Reconnecting automatically…' })
        reconnectTimer = setTimeout(() => { reconnectTimer = undefined; void connectSocket().catch(() => close('Console access could not be refreshed. Reopen the console to try again.')) }, 2000)
    }
    const flush = () => {
        flushTimer = undefined
        if (!current() || !listeners.size) return
        let bytes = 0
        while (queue.length && bytes < 65536 && current()) { const data = queue.shift()!; const length = utf8Size(data); queueBytes -= length; bytes += length; emit({ type: 'output', data }) }
        if (queue.length && listeners.size && current()) flushTimer = setTimeout(flush, 0)
    }
    const output = (data: string) => {
        const bytes = utf8Size(data)
        if (queueBytes + bytes > 1024 * 1024) { close('Console output reached its display limit. Reopen manually.'); return }
        for (let offset = 0; offset < data.length;) {
            let end = Math.min(offset + 8192, data.length)
            const last = data.charCodeAt(end - 1)
            if (end < data.length && last >= 0xd800 && last <= 0xdbff) end--
            queue.push(data.slice(offset, end)); offset = end
        }
        queueBytes += bytes
        if (listeners.size && !flushTimer) flushTimer = setTimeout(flush, 0)
    }
    function send(value: object) {
        if (!current() || socket?.readyState !== 1) return false
        const data = JSON.stringify(value)
        if (utf8Size(data) > 32768 || socket.bufferedAmount > 1024 * 1024) { close('Console input cannot be delivered safely. Reopen manually.'); return false }
        try { socket.send(data); return true } catch { close('Console input delivery is unconfirmed. Reopen manually.'); return false }
    }
    const prepareTimer = setTimeout(() => close('Console preparation timed out. Review the VM before reopening.'), options.deadlines?.prepare ?? 180000)
    void (async () => {
        if (!current()) { close('Console opening was cancelled.'); return }
        const vm = await dependencies.loadVm(s, target, controller.signal)
        if (!current()) return
        let permission = await dependencies.loadPublicServices(s, target, controller.signal)
        if (!current()) return
        const value = requireCurrent(s, vm); requireManage(s, permission, target)
        if (value.deleted_at) throw new VmError('Restore this VM before opening its console.')
        if (value.status?.toLowerCase() === 'stopped') {
            effect = true; change({ type: 'state', state: 'connecting', message: 'Starting the VM as reviewed…' })
            await dependencies.power(s, vm, permission, 'start', controller.signal)
            // The start request returned a receipt. Later WebSocket authentication,
            // readiness, and transport failures do not make that VM action uncertain.
            effect = false
            if (!current()) return
            permission = await dependencies.loadPublicServices(s, target, controller.signal)
            if (!current()) return
            requireManage(s, permission, target)
        }
        const targetUrl = vmUrl(s, `ws/vm/${encodeURIComponent(target)}/console`)
        const socketUrl = targetUrl.replace(/^https:/, 'wss:')
        clearTimeout(prepareTimer)
        connectSocket = async () => {
            if (!current() || closed) return
            if (permission && Date.now() - permission.checkedAt > 20000) {
                const latestVm = await dependencies.loadVm(s, target, controller.signal)
                permission = await dependencies.loadPublicServices(s, target, controller.signal)
                if (!current()) return
                const latest = requireCurrent(s, latestVm); requireManage(s, permission, target)
                if (latest.deleted_at) throw new VmError('Restore this VM before opening its console.')
            }
            let proofTimer: ReturnType<typeof setTimeout> | undefined
            let abortProof: () => void = () => {}
            const stopped = new Promise<never>((_, reject) => { abortProof = () => reject(new VmError('Console authentication cancelled.')) })
            controller.signal.addEventListener('abort', abortProof, { once: true })
            const timeout = new Promise<never>((_, reject) => { proofTimer = setTimeout(() => reject(new VmError('Console authentication timed out.')), options.deadlines?.proof ?? 10000) })
            let proof: { proof: string }
            try { proof = await Promise.race([dependencies.proof(s.authToken, 'GET', targetUrl), timeout, stopped]) } finally { clearTimeout(proofTimer); controller.signal.removeEventListener('abort', abortProof) }
            if (!current()) return
            requireManage(s, permission, target)
            if (typeof proof.proof !== 'string' || proof.proof.length > 8192) throw new VmError('Console authentication could not be prepared.')
            if (socket) { socket.onopen = null; socket.onmessage = null; socket.onclose = null; socket.onerror = null; try { socket.close() } catch { /* Replaced sockets cannot be reused. */ } }
            sent = false
            const activeSocket = dependencies.socket(socketUrl, { origin: 'https://hanasand.com' })
            socket = activeSocket
            activeSocket.onopen = () => {
                if (!current() || sent || socket !== activeSocket) return
                try { requireManage(s, permission, target) } catch { close('Console permission expired. Refresh VM access before reconnecting.'); return }
                sent = true
                send({ type: 'auth', id: s.userId, token: s.authToken, dpop: proof.proof })
            }
            activeSocket.onmessage = event => {
                if (!current()) return
                try {
                    if (!sent || typeof event.data !== 'string' || utf8Size(event.data) > 256 * 1024) throw new Error()
                    sessionBytes += utf8Size(event.data)
                    if (sessionBytes > 64 * 1024 * 1024) { close('Console output reached the session limit. Reopen manually.'); return }
                    const message = object(JSON.parse(event.data))
                    if (message.type === 'ready') {
                        if (message.username !== target) throw new Error()
                        accepted = true
                        change({ type: 'state', state: 'ready', message: 'Console connected' })
                        if (!settled) { settled = true; resolveOpened() }
                        send({ type: 'resize', cols: width, rows: height })
                    } else if (message.type === 'output') output(string(message.data, 262144))
                    else if (message.type === 'status') change({ type: 'state', state: 'connecting', message: string(message.message, 512) })
                    else if (message.type === 'boot-output') options.onBootOutput?.(string(message.data, 65536))
                    else if (message.type === 'boot-error') options.onBootStatus?.('Boot log is unavailable; the guest console remains separate.')
                    else if (message.type === 'error') close('Console access could not be opened. Refresh VM access and try again.')
                    else if (message.type === 'closed') reconnect()
                    else throw new Error()
                } catch { close('The VM console returned an invalid message. Reopen manually.') }
            }
            activeSocket.onclose = event => {
                if (socket !== activeSocket || closed) return
                if (event.code === 1008) close('Console authorization ended. Refresh VM access before reconnecting.')
                else reconnect()
            }
            activeSocket.onerror = () => { if (socket === activeSocket && !closed) reconnect() }
        }
        await connectSocket()
    })().catch(error => close(error instanceof VmError && !error.uncertain ? error.message : 'Console preparation failed. Review current VM state.'))
    return {
        id: `${nonce}:${++sessionSequence}:${target}`, opened,
        subscribe(listener) { try { listener(state) } catch { close('Console display failed. Reopen manually.'); return () => {} } if (closed) return () => {}; listeners.add(listener); if (queue.length && !flushTimer) flushTimer = setTimeout(flush, 0); return () => { listeners.delete(listener) } },
        input(data) {
            if (!current() || state.state !== 'ready' || typeof data !== 'string' || utf8Size(data) > 16384) return false
            if (Date.now() - windowAt >= 1000) { windowAt = Date.now(); inputBytes = 0; inputs = 0; resizes = 0 }
            const bytes = utf8Size(data)
            if (inputs >= 256 || inputBytes + bytes > 256 * 1024) return false
            inputs++; inputBytes += bytes
            return send({ type: 'input', data })
        },
        resize(cols, rows) {
            if (!current() || !Number.isInteger(cols) || !Number.isInteger(rows) || cols < 20 || cols > 500 || rows < 8 || rows > 200) return
            if (cols === width && rows === height) return
            if (Date.now() - windowAt >= 1000) { windowAt = Date.now(); inputBytes = 0; inputs = 0; resizes = 0 }
            if (resizes >= 20) return
            resizes++; width = cols; height = rows
            if (state.state === 'ready') send({ type: 'resize', cols, rows })
        },
        close: () => close(),
    }
}
