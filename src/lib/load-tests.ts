import type { AppSettings } from '../types'
import { apiFetch } from './api'

export type LoadStage = { duration: string; target: number }
export type LoadDraft = { url: string; timeout: number; stages: LoadStage[] }
export type LoadQuota = { plan: string; limit: number; used: number; remaining: number; resetsAt: string | null }
export type LoadSummary = { requests: number | null; checks: number | null; failures: number | null; failureRate: number | null; duration: Record<string, number | null>; series: { name: string; points: { time: string; values: Record<string, number> }[] }[] }
export type LoadTest = { id: string; url: string; status: string; timeout: number | null; stages: LoadStage[]; queuePosition: number | null; logs: string[]; errors: string[]; outputLimited: boolean; createdAt: string; startedAt: string; finishedAt: string; durationMs: number | null; exitCode: number | null; visits: number | null; summary: LoadSummary; previous: LoadSummary | null; runNumber: number | null; p95Delta: number | null }
export class LoadTestError extends Error {
    constructor(message: string, readonly status = 0, readonly uncertain = false, readonly quota?: LoadQuota) { super(message) }
}
export const loadScope = (s: AppSettings) => JSON.stringify([s.apiBaseUrl, s.siteBaseUrl, s.userId, s.authToken, s.selectedOrganizationId, s.impersonationToken, s.impersonatingUserId])
export const loadOwnAccount = (s: AppSettings) => Boolean(s.userId && s.authToken && !s.impersonationToken && !s.impersonatingUserId)
export const loadId = (id: string) => /^[A-Za-z0-9_.:@-]{1,200}$/.test(id) && id !== '.' && id !== '..'
export const loadRecord = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
export const loadNumber = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null
const nonnegative = (value: unknown) => { const number = loadNumber(value); return number !== null && number >= 0 ? number : null }
const text = (v: unknown, max = 2000) => typeof v === 'string' ? v.slice(0, max) : ''
export const loadBytes = (s: string) => { let bytes = 0; for (const character of s) { const point = character.codePointAt(0)!; bytes += point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4 } return bytes }
export const loadPresets = [
    { name: 'Baseline', timeout: 30, stages: [{ duration: '30s', target: 1 }] },
    { name: 'Ramp', timeout: 45, stages: [{ duration: '30s', target: 5 }, { duration: '1m', target: 20 }, { duration: '30s', target: 0 }] },
    { name: 'Spike', timeout: 60, stages: [{ duration: '15s', target: 5 }, { duration: '20s', target: 40 }, { duration: '25s', target: 0 }] },
] satisfies { name: string; timeout: number; stages: LoadStage[] }[]
export function loadEndpoint(base: string, path: string) {
    const url = new URL(base)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new LoadTestError('Use a secure API address without credentials or query parameters.')
    return `${base.replace(/\/+$/, '')}/${path}`
}
export function validateLoadDraft(draft: LoadDraft): LoadDraft {
    if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(draft.url.trim()) && !/^https?:\/\//i.test(draft.url.trim())) throw new LoadTestError('Use an HTTP or HTTPS endpoint.')
    let url: URL
    try { url = new URL(draft.url.trim().match(/^https?:\/\//i) ? draft.url.trim() : `https://${draft.url.trim()}`) } catch { throw new LoadTestError('Enter a valid HTTP or HTTPS endpoint.') }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.href.length > 2000) throw new LoadTestError('Use an HTTP or HTTPS endpoint without embedded credentials.')
    url.hash = ''
    if (!Number.isInteger(draft.timeout) || draft.timeout < 1 || draft.timeout > 120) throw new LoadTestError('Timeout must be 1–120 seconds.')
    let seconds = 0
    if (!draft.stages.length || draft.stages.length > 8) throw new LoadTestError('Use 1–8 traffic stages.')
    for (const stage of draft.stages) {
        const match = /^(\d+)([smh])$/.exec(stage.duration)
        const duration = match ? Number(match[1]) * ({ s: 1, m: 60, h: 3600 }[match[2]] || 0) : 0
        if (!duration || !Number.isInteger(stage.target) || stage.target < 0 || stage.target > 100) throw new LoadTestError('Each stage needs a positive duration and 0–100 users.')
        seconds += duration
    }
    if (seconds > 600) throw new LoadTestError('Keep custom traffic within 10 minutes.')
    return { url: url.href, timeout: draft.timeout, stages: draft.stages.map(row => ({ ...row })) }
}
export function parseLoadQuota(value: unknown): LoadQuota {
    const row = loadRecord(value)
    if (!['free', 'starter', 'team', 'volume'].includes(String(row.plan)) || ['limit', 'used', 'remaining'].some(key => typeof row[key] !== 'number' || !Number.isInteger(row[key]) || Number(row[key]) < 0)) throw new LoadTestError('The server allowance is unavailable.')
    return { plan: String(row.plan), limit: Number(row.limit), used: Number(row.used), remaining: Number(row.remaining), resetsAt: typeof row.resetsAt === 'string' ? row.resetsAt : null }
}
export function parseLoadSummary(value: unknown): LoadSummary {
    const row = loadRecord(value), duration = loadRecord(row.duration)
    const series = ['rps', 'latency', 'errors'].flatMap(name => {
        if (!Array.isArray(row[name])) return []
        const points = row[name].slice(0, 300).flatMap(item => {
            const point = loadRecord(item), values: Record<string, number> = {}
            for (const key of name === 'latency' ? ['p50', 'p95'] : name === 'rps' ? ['value'] : ['count']) if (nonnegative(point[key]) !== null) values[key] = Number(point[key])
            return Object.keys(values).length && ['string', 'number'].includes(typeof point.time) ? [{ time: String(point.time).slice(0, 100), values }] : []
        })
        return points.length ? [{ name, points }] : []
    })
    return { requests: nonnegative(row.requests), checks: nonnegative(row.checks), failures: nonnegative(row.failures), failureRate: nonnegative(row.failureRate) !== null && Number(row.failureRate) <= 1 ? Number(row.failureRate) : null, duration: Object.fromEntries(['avg', 'med', 'min', 'max', 'p50', 'p90', 'p95'].map(key => [key, nonnegative(duration[key])])), series }
}
export function boundLoadOutput(value: unknown) {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new LoadTestError('Invalid result output.')
    let remaining = 128 * 1024, limited = value.length > 500
    const rows = value.slice(-500).reverse().map(item => { const row = String(item).slice(0, Math.min(8000, remaining)); remaining -= row.length; limited ||= row.length !== String(item).length; return row }).filter(Boolean)
    return { rows: rows.reverse(), limited }
}
export function loadDurationMs(value: unknown) {
    const row = loadRecord(value), units: Record<string, number> = { days: 86400000, hours: 3600000, minutes: 60000, seconds: 1000, milliseconds: 1 }
    if (row.years || row.months) return null
    const values = Object.entries(units).flatMap(([key, multiplier]) => nonnegative(row[key]) !== null ? [Number(row[key]) * multiplier] : [])
    return values.length ? values.reduce((total, value) => total + value, 0) : null
}
export function parseLoadTest(value: unknown): LoadTest {
    const row = loadRecord(value)
    if (typeof row.id !== 'string' || !loadId(row.id) || typeof row.url !== 'string' || row.url.length > 2000 || typeof row.status !== 'string' || !row.status || row.status.length > 40) throw new LoadTestError('The result is missing or malformed.')
    const logs = boundLoadOutput(row.logs ?? []), errors = boundLoadOutput(row.errors ?? [])
    if (Array.isArray(row.stages) && row.stages.length > 8) throw new LoadTestError('The saved traffic configuration exceeds the stage limit.')
    const stages = Array.isArray(row.stages) ? row.stages.slice(0, 8).map(loadRecord).map(item => {
        if (typeof item.duration !== 'string' || !/^\d+[smh]$/.test(item.duration) || loadNumber(item.target) === null) throw new LoadTestError('The saved traffic configuration is malformed.')
        return { duration: item.duration, target: Number(item.target) }
    }) : []
    return { id: row.id, url: row.url, status: row.status, timeout: nonnegative(row.timeout) === null ? null : Number(row.timeout) > 1000 ? Math.ceil(Number(row.timeout) / 1000) : Number(row.timeout), stages, queuePosition: loadNumber(row.queue_position), logs: logs.rows, errors: errors.rows, outputLimited: logs.limited || errors.limited, createdAt: text(row.created_at), startedAt: text(row.started_at), finishedAt: text(row.finished_at), durationMs: loadDurationMs(row.duration), exitCode: loadNumber(row.exit_code), visits: loadNumber(row.visits), summary: parseLoadSummary(row.latest_run_summary ?? row.summary), previous: row.previous_run_summary ? parseLoadSummary(row.previous_run_summary) : null, runNumber: loadNumber(row.latest_run_number), p95Delta: loadNumber(row.p95_delta_ms) }
}
async function request(settings: AppSettings, path: string, signal: AbortSignal, body?: unknown) {
    const write = body !== undefined
    if (!settings.userId || !settings.authToken) throw new LoadTestError('Sign in to inspect your checks.', 401)
    if (write && !loadOwnAccount(settings)) throw new LoadTestError('Load generation is read-only while impersonating.', 403)
    const controller = new AbortController(), abort = () => controller.abort(), timer = setTimeout(abort, 20000)
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true })
    let dispatched = false
    try {
        const endpoint = loadEndpoint(settings.apiBaseUrl, path)
        if (controller.signal.aborted) throw new LoadTestError('Request cancelled before submission.')
        dispatched = true
        const response = await apiFetch(settings, endpoint, { method: write ? 'POST' : 'GET', ...(write ? { body: JSON.stringify(body) } : {}), signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json', 'Content-Type': 'application/json' } })
        const declared = response.headers?.get('content-length')
        if (declared && Number(declared) > 2 * 1024 * 1024) throw new LoadTestError('Result exceeded the 2 MiB response limit.', response.status, write)
        const raw = await response.text()
        if (loadBytes(raw) > 2 * 1024 * 1024) throw new LoadTestError('Result exceeded the 2 MiB response limit.', response.status, write)
        if (controller.signal.aborted) throw new LoadTestError('Request interrupted.', 0, write)
        let value: unknown
        try { value = JSON.parse(raw) } catch { throw new LoadTestError('The server returned an invalid result.', response.status, write) }
        if (!response.ok) {
            let quota: LoadQuota | undefined
            if (response.status === 402) { try { quota = parseLoadQuota(loadRecord(value).quota) } catch { /* Allowance remains unknown. */ } }
            throw new LoadTestError(response.status === 402 ? 'The server allowance has been used.' : response.status === 409 ? 'This test is already queued or running. Refresh its result.' : [401, 403].includes(response.status) ? 'Access could not be verified. Refresh manually.' : 'The request failed. Refresh and review the result.', response.status, write && response.status >= 500, quota)
        }
        return value
    } catch (cause) {
        if (cause instanceof LoadTestError) throw cause
        throw new LoadTestError(write && dispatched ? 'Submission outcome is unknown. Refresh history before another request.' : 'Checks are unavailable. Refresh to try again.', 0, write && dispatched)
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
}
export async function loadTestHistory(settings: AppSettings, lane: 'mine' | 'recent', signal: AbortSignal) {
    const value = await request(settings, `tests/${lane}?limit=50`, signal)
    if (!Array.isArray(value) || value.length > 50) throw new LoadTestError('The result history is malformed.')
    const rows = value.map(parseLoadTest)
    if (new Set(rows.map(row => row.id)).size !== rows.length) throw new LoadTestError('The result history contains duplicate IDs.')
    return rows
}
export async function loadTestQuota(settings: AppSettings, signal: AbortSignal) { return parseLoadQuota(await request(settings, 'tests/quota', signal)) }
export async function loadTestResult(settings: AppSettings, id: string, signal: AbortSignal) {
    if (!loadId(id)) throw new LoadTestError('Enter a valid scan ID.')
    const row = parseLoadTest(await request(settings, `test/${encodeURIComponent(id)}`, signal))
    if (row.id !== id) throw new LoadTestError('The returned result belongs to a different scan.')
    return row
}
export async function createLoadTest(settings: AppSettings, draft: LoadDraft, signal: AbortSignal) {
    const value = await request(settings, 'test', signal, validateLoadDraft(draft))
    try { return { test: parseLoadTest(value), quota: loadRecord(value).quota ? parseLoadQuota(loadRecord(value).quota) : null } }
    catch { throw new LoadTestError('The submission receipt is invalid. Refresh history before another request.', 0, true) }
}
export async function rerunLoadTest(settings: AppSettings, id: string, signal: AbortSignal) {
    if (!loadId(id)) throw new LoadTestError('Invalid scan ID.')
    const value = loadRecord(await request(settings, `test/${encodeURIComponent(id)}/rerun`, signal, {}))
    if (value.ok !== true || value.status !== 'queued') throw new LoadTestError('The rerun receipt is invalid. Refresh before trying again.', 0, true)
}
export type LoadReadTicket = { operation: number; serial: number }
export const canReconcileLoad = (ticket: LoadReadTicket | null, operation: number, serial: number) => ticket !== null && ticket.operation === operation && ticket.serial === serial
export const canEditLoad = (state: { active: boolean; pending: boolean; locked: boolean; generation: number }, captured: number) => state.active && !state.pending && !state.locked && state.generation === captured
