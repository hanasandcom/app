import type { AppSettings } from '../types'
import { apiFetch } from './api'

export type TiSourceStatus = 'active' | 'paused' | 'review' | 'candidate' | 'unknown'
export type TiSource = {
    id: string; name: string; family: string; type: string; accessMethod: string; status: TiSourceStatus
    healthState: string; url: string; domain: string; lastRunAt: string | null; lastUsefulAt: string | null
    nextRunAt: string | null; productiveCycleCount: number; customerMatchCount: number; executable: boolean
    cadenceMinutes: number; domains: string[]
}
export type TiSourcesPage = { sources: TiSource[]; page: number; limit: number; total: number; previousPage: number | null; nextPage: number | null }

function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function invalid(): never { throw new Error('TI source inventory returned an invalid response. Refresh to try again.') }
function string(value: unknown, max = 500) { return typeof value === 'string' && value.length <= max ? value : invalid() }
function count(value: unknown) { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : invalid() }
function date(value: unknown): string | null {
    if (value === null) return null
    const next = string(value, 100)
    if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(next) || !Number.isFinite(Date.parse(next))) return invalid()
    return new Date(next).toISOString()
}
function parseSource(value: unknown): TiSource {
    const row = object(value), status = row.status
    if (status !== 'active' && status !== 'paused' && status !== 'review' && status !== 'candidate' && status !== 'unknown') return invalid()
    if (!Array.isArray(row.domains) || row.domains.length > 100 || row.domains.some(item => typeof item !== 'string' || item.length > 253)) return invalid()
    if (typeof row.executable !== 'boolean') return invalid()
    return {
        id: string(row.id, 200), name: string(row.name), family: string(row.family, 100), type: string(row.type, 100),
        accessMethod: string(row.accessMethod, 100), status, healthState: string(row.healthState, 100),
        url: string(row.url, 2_000), domain: string(row.domain, 253), lastRunAt: date(row.lastRunAt),
        lastUsefulAt: date(row.lastUsefulAt), nextRunAt: date(row.nextRunAt),
        productiveCycleCount: count(row.productiveCycleCount), customerMatchCount: count(row.customerMatchCount),
        executable: row.executable, cadenceMinutes: count(row.cadenceMinutes), domains: row.domains as string[],
    }
}

function tiOrigin(settings: AppSettings) {
    if (!settings.userId || !settings.authToken) throw new Error('Sign in with an account that can view internal pages to see TI sources.')
    if (settings.impersonationToken || settings.impersonatingUserId) throw new Error('Switch back to your own account to view TI sources.')
    let site: URL
    try { site = new URL(settings.siteBaseUrl) } catch { throw new Error('Configure a valid website address to view TI sources.') }
    const configured = process.env.EXPO_PUBLIC_TI_SITE_URL || (site.hostname === 'hanasand.com' ? 'https://ti.hanasand.com' : site.origin)
    let base: URL
    try { base = new URL(configured) } catch { throw new Error('Configure a valid TI website address to view sources.') }
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('TI source requests require a secure TI website address.')
    return base
}

export const tiSourcesAccountKey = (settings: AppSettings) => JSON.stringify([settings.siteBaseUrl, settings.userId, settings.authToken, settings.impersonationToken, settings.impersonatingUserId])

async function request(settings: AppSettings, url: URL, init: RequestInit = {}, externalSignal?: AbortSignal) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000)
    const cancel = () => controller.abort()
    if (externalSignal?.aborted) cancel(); else externalSignal?.addEventListener('abort', cancel)
    try {
        const response = await apiFetch(settings, url.toString(), {
            ...init, signal: controller.signal, credentials: 'omit', redirect: 'error',
            headers: { Accept: 'application/json', Authorization: `Bearer ${settings.authToken}`, id: settings.userId, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
        })
        const body = object(await response.json().catch(() => null))
        if (!response.ok) {
            const detail = object(body.error)
            throw new Error(response.status === 401 ? 'Sign in again to view TI sources.'
                : response.status === 403 ? 'TI source inventory requires access to internal pages.'
                    : response.status === 429 ? 'TI source requests are limited. Wait before refreshing.'
                        : typeof detail.message === 'string' ? detail.message : `TI sources are temporarily unavailable (${response.status}).`)
        }
        if (controller.signal.aborted) throw new Error('TI source request was canceled.')
        return body
    } catch (cause) {
        if (controller.signal.aborted && !externalSignal?.aborted) throw new Error('TI sources took too long to respond. Refresh to try again.', { cause })
        throw cause
    } finally { clearTimeout(timer); externalSignal?.removeEventListener('abort', cancel) }
}

export async function loadTiSources(settings: AppSettings, page: number, query: string, signal?: AbortSignal): Promise<TiSourcesPage> {
    if (!Number.isSafeInteger(page) || page < 1 || page > 1_000) throw new Error('Choose a valid TI source page.')
    const trimmed = query.trim()
    if (trimmed.length > 100) throw new Error('Source search must be 100 characters or fewer.')
    const url = new URL('/api/ti/sources', tiOrigin(settings))
    url.searchParams.set('page', String(page)); url.searchParams.set('limit', '25')
    if (trimmed) url.searchParams.set('q', trimmed)
    const body = await request(settings, url, {}, signal)
    if (!Array.isArray(body.sources) || body.sources.length > 25 || body.page !== page || body.limit !== 25) return invalid()
    const total = count(body.total), previousPage = body.previousPage, nextPage = body.nextPage
    if ((previousPage !== null && previousPage !== page - 1) || (nextPage !== null && (!Number.isSafeInteger(nextPage) || nextPage !== page + 1))) return invalid()
    return { sources: body.sources.map(parseSource), page, limit: 25, total, previousPage, nextPage }
}

export async function setTiSourceStatus(settings: AppSettings, sourceId: string, status: 'active' | 'paused') {
    if (!sourceId || sourceId.length > 200) throw new Error('Choose a valid TI source.')
    const url = new URL('/api/ti/scraper/control', tiOrigin(settings))
    const body = await request(settings, url, { method: 'POST', body: JSON.stringify({ action: 'source_status', sourceId, status }) })
    const payload = object(body.payload), source = object(payload.source)
    if (body.ok !== true || source.status !== status) throw new Error('The source change was not confirmed. Refresh to check its current status.')
}

export function tiSourcesWebsiteUrl(settings: AppSettings, path = '/dashboard/ti/sources') {
    const url = new URL(path, tiOrigin(settings))
    return url.toString()
}
