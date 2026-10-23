import type { AppSettings } from '../types'
import { apiFetch } from './api'

export type TrafficMetric = { key: string; count: number }
export type TrafficSlowMetric = { key: string; avg_time: number }
export type TrafficMetrics = {
    sampled_at: string | null; total_requests: number; avg_request_time: number; error_rate: number
    top_methods: TrafficMetric[]; top_status_codes: TrafficMetric[]; top_domains: TrafficMetric[]
    top_os: TrafficMetric[]; top_browsers: TrafficMetric[]; requests_over_time: TrafficMetric[]
    top_error_paths: TrafficMetric[]; top_slow_paths: TrafficSlowMetric[]; top_paths: TrafficMetric[]
}
export type TrafficRecord = { id: string; user_agent: string; domain: string; path: string; method: string; referer: string; request_time: number; status: number; timestamp: string; country_iso: string | null }
export type TrafficRecords = { result: TrafficRecord[]; total: number; page: number; limit: number }
export const trafficAccountKey = (s: AppSettings) => JSON.stringify([s.apiBaseUrl, s.userId, s.authToken, s.selectedOrganizationId, s.impersonationToken, s.impersonatingUserId])
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
function invalid(): never { throw new Error('Traffic returned an invalid response. Refresh to try again.') }
function text(value: unknown, max = 4096) { if (typeof value !== 'string' || value.length > max) return invalid(); return value }
function number(value: unknown, integer = false) {
    if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value))) return invalid()
    const next = Number(value)
    if (!Number.isFinite(next) || next < 0 || next > Number.MAX_SAFE_INTEGER || integer && !Number.isSafeInteger(next)) return invalid()
    return next
}
function date(value: unknown) {
    const next = text(value, 100).replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T').replace(/([+-]\d{2})$/, '$1:00')
    if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(next) || !Number.isFinite(Date.parse(next))) return invalid()
    return new Date(next).toISOString()
}
function domainValue(domain: string) {
    if (domain.length > 253 || [...domain].some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127) || /[/?#\\]/.test(domain)) throw new Error('Choose a valid traffic domain.')
    return domain
}
function array(value: unknown, limit: number) { if (!Array.isArray(value) || value.length > limit) return invalid(); return value }
async function request(settings: AppSettings, path: string, timeout: number, signal?: AbortSignal): Promise<unknown> {
    if (!settings.userId || !settings.authToken) throw new Error('Sign in to view traffic.')
    const base = new URL(settings.apiBaseUrl)
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('Traffic requires a secure API address.')
    const controller = new AbortController(), cancel = () => controller.abort(), timer = setTimeout(cancel, timeout)
    if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel)
    try {
        if (controller.signal.aborted) throw new Error('Canceled')
        const response = await apiFetch(settings, `${settings.apiBaseUrl.replace(/\/+$/, '')}/${path}`, {
            signal: controller.signal, credentials: 'omit', redirect: 'error', headers: { Accept: 'application/json', Authorization: `Bearer ${settings.authToken}`, id: settings.userId },
        })
        if (controller.signal.aborted) throw new Error('Canceled')
        if (!response.ok) throw new Error(response.status === 401 ? 'Sign in again to view traffic.' : response.status === 403 ? 'Traffic access is unavailable for this account.' : response.status === 429 ? 'Traffic requests are limited. Wait before refreshing.' : `Traffic is temporarily unavailable (${response.status}). Refresh to try again.`)
        const body: unknown = await response.json()
        if (controller.signal.aborted) throw new Error('Canceled')
        return body
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel) }
}
export async function loadTrafficDomains(settings: AppSettings, signal?: AbortSignal) {
    const body = object(await request(settings, 'traffic/domains', 15000, signal))
    return [...new Set(array(body.domains, 50).map(value => domainValue(text(value, 253))))]
}
export async function loadTrafficMetrics(settings: AppSettings, domain: string, signal?: AbortSignal): Promise<TrafficMetrics> {
    const params = new URLSearchParams(); if (domainValue(domain)) params.set('domain', domain)
    const body = object(await request(settings, `traffic/metrics${domain ? `?${params}` : ''}`, 60000, signal))
    const metrics = (key: string) => array(body[key], 100).map(value => { const row = object(value); return { key: key === 'requests_over_time' ? date(row.key) : text(row.key), count: number(row.count, true) } })
    const errorRate = number(body.error_rate); if (errorRate > 1) return invalid()
    return { sampled_at: body.sampled_at === undefined ? null : date(body.sampled_at), total_requests: number(body.total_requests, true), avg_request_time: number(body.avg_request_time), error_rate: errorRate,
        top_methods: metrics('top_methods'), top_status_codes: metrics('top_status_codes'), top_domains: metrics('top_domains'), top_os: metrics('top_os'), top_browsers: metrics('top_browsers'), requests_over_time: metrics('requests_over_time'), top_error_paths: metrics('top_error_paths'), top_paths: metrics('top_paths'),
        top_slow_paths: array(body.top_slow_paths, 100).map(value => { const row = object(value); return { key: text(row.key), avg_time: number(row.avg_time) } }), }
}
export async function loadTrafficRecords(settings: AppSettings, input: { domain: string; limit: number; page: number }, signal?: AbortSignal): Promise<TrafficRecords> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 200 || !Number.isSafeInteger(input.page) || input.page < 1 || !Number.isSafeInteger(input.page * input.limit)) throw new Error('Choose a valid traffic page and limit.')
    const params = new URLSearchParams({ limit: String(input.limit), page: String(input.page) }); if (domainValue(input.domain)) params.set('domain', input.domain)
    const body = object(await request(settings, `traffic/records?${params}`, 60000, signal))
    const result = array(body.result, input.limit).map(value => {
        const row = object(value), id = typeof row.id === 'number' && Number.isSafeInteger(row.id) ? String(row.id) : text(row.id, 30)
        if (!/^[1-9]\d*$/.test(id)) return invalid()
        const status = number(row.status, true); if (status > 599) return invalid()
        const country = row.country_iso == null || row.country_iso === '' ? null : text(row.country_iso, 2).toUpperCase()
        if (country && !/^[A-Z]{2}$/.test(country)) return invalid()
        return { id, user_agent: text(row.user_agent, 2048), domain: text(row.domain, 253), path: text(row.path), method: text(row.method, 20), referer: text(row.referer), request_time: number(row.request_time), status, timestamp: date(row.timestamp), country_iso: country }
    })
    if (new Set(result.map(row => row.id)).size !== result.length) return invalid()
    return { result, total: number(body.total, true), page: input.page, limit: input.limit }
}
export function filterTrafficPage(records: TrafficRecord[], query: string, method = '', status = '') {
    const search = query.trim().toLocaleLowerCase()
    return records.filter(row => (!method || row.method === method) && (!status || String(row.status).startsWith(status)) && `${row.domain} ${row.path} ${row.user_agent}`.toLocaleLowerCase().includes(search))
}
