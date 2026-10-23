import { fetch as expoFetch } from 'expo/fetch'
import type { AppSettings } from '../types'
import { apiFetch } from './api'

export type TrafficBatch = { iso: string; count: number; max_id: string; timestamp: string }
export type TrafficEvent = { event: string; data: string }
export class TrafficStreamError extends Error { constructor(message: string, readonly status = 0) { super(message) } }
export const trafficStreamingFetch = expoFetch as unknown as typeof fetch
const maxLine = 32768, maxEvent = 65536, maxChunk = 262144
// SSE dispatches only on blank lines; an incomplete event at EOF is discarded.
export function createTrafficSseParser(onEvent: (event: TrafficEvent) => void) {
    let buffer = '', event = '', data: string[] = [], size = 0
    function line(value: string) {
        if (!value) {
            if (data.length) onEvent({ event: event || 'message', data: data.join('\n') })
            event = ''; data = []; size = 0; return
        }
        if (value.startsWith(':')) return
        const colon = value.indexOf(':'), field = colon < 0 ? value : value.slice(0, colon)
        let content = colon < 0 ? '' : value.slice(colon + 1); if (content.startsWith(' ')) content = content.slice(1)
        if (field === 'event') { if (content.length > 100) throw new TrafficStreamError('Invalid traffic stream event.'); event = content }
        if (field === 'data') { size += content.length + 1; if (size > maxEvent) throw new TrafficStreamError('Traffic stream event exceeded its limit.'); data.push(content) }
    }
    return {
        push(chunk: string) {
            if (chunk.length > maxChunk) throw new TrafficStreamError('Traffic stream chunk exceeded its limit.')
            buffer += chunk
            for (;;) {
                const index = buffer.search(/[\r\n]/)
                if (index < 0 || buffer[index] === '\r' && index === buffer.length - 1) break
                if (index > maxLine) throw new TrafficStreamError('Traffic stream line exceeded its limit.')
                const length = buffer[index] === '\r' && buffer[index + 1] === '\n' ? 2 : 1
                line(buffer.slice(0, index)); buffer = buffer.slice(index + length)
            }
            if (buffer.length > maxLine + 1) throw new TrafficStreamError('Traffic stream buffer exceeded its limit.')
        },
    }
}
function safeId(value: unknown): string {
    if (typeof value !== 'string' || !/^[1-9]\d{0,15}$/.test(value) || !Number.isSafeInteger(Number(value))) throw new TrafficStreamError('Traffic stream cursor is invalid.')
    return value
}
export function parseTrafficBatch(value: string): TrafficBatch[] {
    const body: unknown = JSON.parse(value)
    if (!Array.isArray(body) || body.length > 250) throw new TrafficStreamError('Traffic stream batch is invalid.')
    const seen = new Set<string>()
    const batch = body.map(item => {
        if (!item || typeof item !== 'object') throw new TrafficStreamError('Traffic stream batch is invalid.')
        const row = item as Record<string, unknown>
        if (typeof row.iso !== 'string' || !/^[A-Z]{2}$/.test(row.iso) || seen.has(row.iso) || !Number.isSafeInteger(row.count) || Number(row.count) < 1 || Number(row.count) > 1000 || typeof row.timestamp !== 'string' || row.timestamp.length > 100) throw new TrafficStreamError('Traffic stream batch is invalid.')
        seen.add(row.iso)
        const timestamp = row.timestamp.replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T').replace(/([+-]\d{2})$/, '$1:00')
        if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) throw new TrafficStreamError('Traffic stream timestamp is invalid.')
        return { iso: row.iso as string, count: Number(row.count), max_id: safeId(row.max_id), timestamp: new Date(timestamp).toISOString() }
    })
    if (batch.reduce((sum, item) => sum + item.count, 0) > 1000) throw new TrafficStreamError('Traffic stream batch exceeded its request limit.')
    return batch
}
export async function openTrafficStream(settings: AppSettings, input: { domain: string; after?: string }, callbacks: { onReady: () => void; onBatch: (batch: TrafficBatch[]) => void }, signal: AbortSignal, transport: typeof fetch = trafficStreamingFetch) {
    if (!settings.userId || !settings.authToken) throw new TrafficStreamError('Sign in to view live traffic.', 401)
    const base = new URL(settings.apiBaseUrl)
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new TrafficStreamError('Live traffic requires a secure API address.')
    if (input.domain.length > 253 || [...input.domain].some(char => char.charCodeAt(0) < 33 || char.charCodeAt(0) === 127) || /[/?#\\]/.test(input.domain)) throw new TrafficStreamError('Select a valid traffic domain.')
    const params = new URLSearchParams(); if (input.domain) params.set('domain', input.domain); if (input.after) params.set('after', safeId(input.after))
    const controller = new AbortController(), cancel = () => controller.abort()
    let cursor = Number(input.after || 0)
    let reason = new TrafficStreamError('Live traffic read was canceled.'), timer: ReturnType<typeof setTimeout>, reader: ReadableStreamDefaultReader<Uint8Array> | undefined, response: Response | undefined
    let rejectAbort!: (reason: Error) => void
    const aborted = new Promise<never>((_, reject) => { rejectAbort = reject })
    void aborted.catch(() => {})
    const onAbort = () => rejectAbort(reason)
    controller.signal.addEventListener('abort', onAbort)
    const arm = (timeout: number) => { clearTimeout(timer); timer = setTimeout(() => { reason = new TrafficStreamError('Live traffic stopped responding.'); controller.abort() }, timeout) }
    if (signal.aborted) cancel(); else signal.addEventListener('abort', cancel)
    try {
        if (controller.signal.aborted) throw reason
        arm(20000)
        const pending = apiFetch(settings, `${settings.apiBaseUrl.replace(/\/+$/, '')}/traffic/live${params.toString() ? `?${params}` : ''}`, { signal: controller.signal, credentials: 'omit', redirect: 'error', headers: { Accept: 'text/event-stream', Authorization: `Bearer ${settings.authToken}`, id: settings.userId } }, transport)
        void pending.then(response => { if (controller.signal.aborted) void response.body?.cancel().catch(() => {}) }, () => {})
        response = await Promise.race([pending, aborted])
        if (!response.ok) throw new TrafficStreamError(response.status === 401 || response.status === 403 ? 'Sign in or refresh access before reconnecting live traffic.' : `Live traffic is unavailable (${response.status}).`, response.status)
        if (!response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream') || !response.body?.getReader) throw new TrafficStreamError('Live streaming is unavailable; snapshots remain available.')
        reader = response.body.getReader(); arm(45000)
        const parser = createTrafficSseParser(({ event, data }) => {
            if (controller.signal.aborted) return
            if (event === 'traffic-error') throw new TrafficStreamError('The live traffic feed reported an error.')
            if (event === 'ready') { const status: unknown = JSON.parse(data); if (status && typeof status === 'object' && (status as { status?: unknown }).status === 'connected') callbacks.onReady(); else throw new TrafficStreamError('Invalid live traffic readiness response.') }
            if (event === 'traffic') { const batch = parseTrafficBatch(data).filter(item => Number(item.max_id) > cursor); if (batch.length) { cursor = Math.max(cursor, ...batch.map(item => Number(item.max_id))); callbacks.onBatch(batch) } }
        })
        const decoder = new TextDecoder('utf-8', { fatal: true })
        for (;;) {
            const chunk = await Promise.race([reader.read(), aborted])
            if (controller.signal.aborted) throw reason
            if (chunk.done) throw new TrafficStreamError('The live traffic connection closed.')
            if (chunk.value.byteLength > maxChunk) throw new TrafficStreamError('Traffic stream chunk exceeded its limit.')
            arm(45000); parser.push(decoder.decode(chunk.value, { stream: true }))
        }
    } catch (cause) {
        if (cause instanceof TrafficStreamError) throw cause
        throw new TrafficStreamError('The live traffic feed could not be read.')
    } finally {
        clearTimeout(timer!); signal.removeEventListener('abort', cancel); controller.signal.removeEventListener('abort', onAbort); controller.abort()
        if (reader) { void reader.cancel().catch(() => {}); try { reader.releaseLock() } catch { /* A canceled native read can still be settling. */ } }
        else if (response?.body) void response.body.cancel().catch(() => {})
    }
}
