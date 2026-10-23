import type { AppSettings } from '../types'
import { apiFetch } from './api'

export type TiCollectionRun = {
    id: string
    sourceName: string
    sourceFamily: string
    status: 'completed' | 'queued' | 'running' | 'failed' | 'unknown'
    startedAt: string
    finishedAt: string | null
    nextRunAt: string | null
    rows: number
    captures: number
    screenshots: number
    trigger: 'automated' | 'manual' | 'unknown'
}
export type TiCollectionRunsPage = { runs: TiCollectionRun[]; page: number; limit: number; total: number; previousPage: number | null; nextPage: number | null }

function object(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function fail(): never { throw new Error('Collection history returned an invalid response. Refresh to try again.') }
function text(value: unknown, max = 500) {
    if (typeof value !== 'string' || value.length > max) return fail()
    return value
}
function count(value: unknown) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return fail()
    return value
}
function date(value: unknown, optional = false): string | null {
    if (optional && value === null) return null
    const next = text(value, 100)
    if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(next) || !Number.isFinite(Date.parse(next))) return fail()
    return new Date(next).toISOString()
}
function parseRun(value: unknown): TiCollectionRun {
    const row = object(value), status = row.status
    if (status !== 'completed' && status !== 'queued' && status !== 'running' && status !== 'failed' && status !== 'unknown') return fail()
    const trigger = row.trigger
    if (trigger !== 'automated' && trigger !== 'manual' && trigger !== 'unknown') return fail()
    return {
        id: text(row.id, 200), sourceName: text(row.sourceName), sourceFamily: text(row.sourceFamily), status,
        startedAt: date(row.startedAt)!, finishedAt: date(row.finishedAt, true), nextRunAt: date(row.nextRunAt, true),
        rows: count(row.rows), captures: count(row.captures), screenshots: count(row.screenshots), trigger,
    }
}

function endpoint(settings: AppSettings) {
    if (!settings.userId || !settings.authToken) throw new Error('Sign in with an account that can view internal pages to see collection history.')
    if (settings.impersonationToken || settings.impersonatingUserId) throw new Error('Switch back to your own account to view collection history.')
    let website: URL
    try { website = new URL(settings.siteBaseUrl) } catch { throw new Error('Configure a valid website address to view collection history.') }
    const base = process.env.EXPO_PUBLIC_TI_SITE_URL || (website.hostname === 'hanasand.com' ? 'https://ti.hanasand.com' : website.origin)
    let url: URL
    try { url = new URL('/api/ti/collection-runs', base) } catch { throw new Error('Configure a valid TI website address to view collection history.') }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Collection history requires a secure TI website address.')
    return url
}

export const tiRunsAccountKey = (settings: AppSettings) => JSON.stringify([settings.siteBaseUrl, settings.userId, settings.authToken, settings.impersonationToken, settings.impersonatingUserId])

export async function loadTiCollectionRuns(settings: AppSettings, page: number, signal?: AbortSignal): Promise<TiCollectionRunsPage> {
    if (!Number.isSafeInteger(page) || page < 1 || page > 10_000) throw new Error('Choose a valid collection history page.')
    const url = endpoint(settings)
    url.searchParams.set('page', String(page)); url.searchParams.set('limit', '50')
    const controller = new AbortController(), cancel = () => controller.abort(), timer = setTimeout(cancel, 15_000)
    if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel)
    try {
        const response = await apiFetch(settings, url.toString(), {
            signal: controller.signal, credentials: 'omit', redirect: 'error',
            headers: { Accept: 'application/json', Authorization: `Bearer ${settings.authToken}`, id: settings.userId },
        })
        if (controller.signal.aborted) throw new Error('Collection history request was canceled.')
        const payload: unknown = await response.json().catch(() => null), body = object(payload)
        if (!response.ok) {
            const detail = object(body.error)
            throw new Error(response.status === 401 ? 'Sign in again to view collection history.'
                : response.status === 403 ? 'Collection history requires access to internal pages.'
                    : response.status === 429 ? 'Collection history requests are limited. Wait before refreshing.'
                        : typeof detail.message === 'string' ? detail.message : typeof body.message === 'string' ? body.message : `Collection history is temporarily unavailable (${response.status}).`)
        }
        if (!Array.isArray(body.runs) || body.runs.length > 50 || body.page !== page || body.limit !== 50) return fail()
        const total = count(body.total), previousPage = body.previousPage, nextPage = body.nextPage
        if ((previousPage !== null && previousPage !== page - 1) || (nextPage !== null && (!Number.isSafeInteger(nextPage) || Number(nextPage) !== page + 1))) return fail()
        return { runs: body.runs.map(parseRun), page, limit: 50, total, previousPage: previousPage as number | null, nextPage: nextPage as number | null }
    } catch (error) {
        if (controller.signal.aborted && !signal?.aborted) throw new Error('Collection history took too long to respond. Refresh to try again.', { cause: error })
        throw error
    } finally {
        clearTimeout(timer); signal?.removeEventListener('abort', cancel)
    }
}
