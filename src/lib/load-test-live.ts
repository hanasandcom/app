import type { AppSettings } from '../types'
import { boundLoadOutput, loadBytes, loadEndpoint, loadId, loadNumber, loadRecord, LoadTestError, parseLoadSummary, type LoadTest } from './load-tests'

export type LoadSocket = { onopen: (() => void) | null; onmessage: ((event: { data: unknown }) => void) | null; onclose: (() => void) | null; onerror: (() => void) | null; close: () => void }
export type LoadSocketTransport = (url: string) => LoadSocket
export type LoadLiveEvent = { kind: 'join'; participants: number } | { kind: 'log' | 'error'; message: string } | { kind: 'done'; code: number; summary: LoadTest['summary']; durationMs: number | null }
export function parseLoadLiveEvent(input: unknown): LoadLiveEvent {
    if (typeof input !== 'string' || loadBytes(input) > 65536) throw new LoadTestError('Live output exceeded the 64 KiB frame limit.')
    let row: Record<string, unknown>
    try { row = loadRecord(JSON.parse(input)) } catch { throw new LoadTestError('Invalid live output.') }
    if (row.type === 'join' && typeof row.participants === 'number' && Number.isInteger(row.participants) && row.participants >= 0) return { kind: 'join', participants: row.participants }
    const data = loadRecord(row.data)
    if (row.type === 'update') {
        if ((data.type === 'log' || data.type === 'error') && typeof data.message === 'string') return { kind: data.type, message: data.message.slice(0, 8000) }
        if (data.type === 'done' && typeof data.code === 'number' && Number.isInteger(data.code)) return { kind: 'done', code: data.code, summary: parseLoadSummary(data.summary), durationMs: loadNumber(data.durationMs) }
    }
    throw new LoadTestError('The public stream returned an unsupported event.')
}
export function applyLoadLive(test: LoadTest, event: LoadLiveEvent): LoadTest {
    if (event.kind === 'join') return test
    if (event.kind === 'done') return { ...test, status: event.code === 0 ? 'done' : 'failed', exitCode: event.code, summary: event.summary, durationMs: event.durationMs ?? test.durationMs }
    const field = event.kind === 'log' ? 'logs' : 'errors'
    const output = boundLoadOutput([...test[field], event.message])
    return { ...test, [field]: output.rows, outputLimited: test.outputLimited || output.limited || event.message.length >= 8000 }
}
// This is the website's existing public channel. It accepts no account credentials or auth frame.
// Its server invokes the global load-test queue runner when joined. Call only after explicit review.
export function joinLoadTestLive(settings: AppSettings, id: string, signal: AbortSignal, observer: {
    status: (value: string) => void; event: (event: LoadLiveEvent) => void; error: (message: string) => void
}, transport: LoadSocketTransport = url => new WebSocket(url) as unknown as LoadSocket) {
    if (!loadId(id)) throw new LoadTestError('Invalid scan ID.')
    if (signal.aborted) return () => {}
    const url = loadEndpoint(settings.apiBaseUrl, `ws/test/${encodeURIComponent(id)}`).replace(/^https:/, 'wss:')
    const socket = transport(url)
    let stopped = false, total = 0
    let timer: ReturnType<typeof setTimeout>
    function stop() {
        if (stopped) return
        stopped = true; clearTimeout(timer); signal.removeEventListener('abort', stop)
        socket.onopen = null; socket.onmessage = null; socket.onclose = null; socket.onerror = null; socket.close()
    }
    function fail(message: string) { if (!stopped) { stop(); observer.status('Disconnected · join manually to listen again'); observer.error(message) } }
    function deadline() { clearTimeout(timer); timer = setTimeout(() => fail('Live output timed out. Server work may continue.'), 90000) }
    signal.addEventListener('abort', stop, { once: true }); deadline()
    observer.status('Connecting to public stream…')
    socket.onopen = () => { if (!stopped) { deadline(); observer.status('Live · public stream') } }
    socket.onmessage = event => {
        if (stopped || signal.aborted) return
        try {
            if (typeof event.data !== 'string') throw new LoadTestError('Unsupported binary live output.')
            total += loadBytes(event.data)
            if (total > 2 * 1024 * 1024) throw new LoadTestError('Live output reached the 2 MiB session limit. Refresh the stored result.')
            const next = parseLoadLiveEvent(event.data)
            deadline(); observer.event(next)
            if (next.kind === 'done') { stop(); observer.status('Run finished · stream closed') }
        } catch (cause) { fail(cause instanceof LoadTestError ? cause.message : 'Invalid live output.') }
    }
    socket.onclose = () => fail('The public stream closed. Refresh the stored result; no reconnect was attempted.')
    socket.onerror = () => fail('The public stream is unavailable. No reconnect was attempted.')
    return stop
}
