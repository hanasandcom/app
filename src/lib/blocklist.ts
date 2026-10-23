import type { AppSettings } from '../types'
import { apiFetch } from './api'

export type BlocklistType = 'ip' | 'user_agent'
export type BlocklistEntry = {
    id: number
    type: BlocklistType
    value: string
    is_vpn: boolean
    is_proxy: boolean
    is_tor: boolean
    is_relay: boolean
    owner: string | null
    location: { country: string | null; region: string | null; city: string | null }
    requests: unknown
    created_at: string | null
    updated_at: string | null
}
export type BlocklistDraft = Pick<BlocklistEntry, 'type' | 'value' | 'is_vpn' | 'is_proxy' | 'is_tor'>
export type BlocklistSaveResult = { kind: 'saved' } | { kind: 'duplicate' }

function requireAccess(settings: AppSettings) {
    if (!settings.userId || !settings.authToken) throw new Error('Sign in to manage the traffic blocklist.')
    if (settings.impersonationToken || settings.impersonatingUserId) throw new Error('Switch back to your own account to manage the traffic blocklist.')
    const base = settings.cdnBaseUrl.trim().replace(/\/+$/, '')
    const url = new URL(base)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
        throw new Error('The traffic blocklist requires a secure CDN address.')
    }
    return `${base}/blocklist`
}

function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The blocklist service returned an invalid response.')
    return value as Record<string, unknown>
}
function optionalText(value: unknown) { return typeof value === 'string' && value.trim() ? value : null }
function parseEntry(value: unknown): BlocklistEntry {
    const row = object(value)
    const id = typeof row.id === 'number' ? row.id : Number(row.id)
    const type = row.type ?? row.metric
    if (!Number.isSafeInteger(id) || id < 1 || (type !== 'ip' && type !== 'user_agent') || typeof row.value !== 'string' || !row.value.trim()) {
        throw new Error('The blocklist service returned an invalid entry.')
    }
    for (const flag of ['is_vpn', 'is_proxy', 'is_tor', 'is_relay']) {
        if (row[flag] !== undefined && row[flag] !== null && typeof row[flag] !== 'boolean') throw new Error('The blocklist service returned an invalid entry.')
    }
    const location = row.location == null ? {} : object(row.location)
    return {
        id, type, value: row.value,
        is_vpn: row.is_vpn === true, is_proxy: row.is_proxy === true,
        is_tor: row.is_tor === true, is_relay: row.is_relay === true,
        owner: optionalText(row.owner),
        location: { country: optionalText(location.country), region: optionalText(location.region), city: optionalText(location.city) },
        requests: row.requests ?? null,
        created_at: optionalText(row.created_at), updated_at: optionalText(row.updated_at),
    }
}

async function request(settings: AppSettings, path: string, method: string, body?: unknown, signal?: AbortSignal) {
    const base = requireAccess(settings)
    const url = `${base}${path}`
    const response = await apiFetch(settings, url, {
        method, cache: 'no-store', redirect: 'error', signal,
        headers: { Authorization: `Bearer ${settings.authToken}`, id: settings.userId, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new Error('Your account does not have permission to manage the traffic blocklist.')
        if (response.status === 429) throw new Error('Too many blocklist requests. Wait, then refresh.')
        throw new Error(`The traffic blocklist request failed (${response.status}). Refresh before trying again.`)
    }
    return payload
}

export async function listBlocklist(settings: AppSettings, signal?: AbortSignal): Promise<BlocklistEntry[]> {
    const payload = await request(settings, '/overview', 'GET', undefined, signal)
    if (!Array.isArray(payload) || payload.length > 100) throw new Error('The blocklist service returned an invalid list.')
    const entries = payload.map(parseEntry)
    if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error('The blocklist service returned duplicate entries.')
    return entries
}

function validateDraft(draft: BlocklistDraft) {
    const value = draft.value.trim()
    if (!value || value.length > 2048 || /[\0\r\n]/.test(value)) throw new Error('Enter a value up to 2,048 characters on one line.')
    if (draft.type !== 'ip' && draft.type !== 'user_agent') throw new Error('Choose an IP address or user agent.')
    return value
}

export async function saveBlocklistEntry(settings: AppSettings, draft: BlocklistDraft, entry?: BlocklistEntry): Promise<BlocklistSaveResult> {
    const value = validateDraft(draft)
    const body = { metric: draft.type, value, ...(entry ? { is_vpn: draft.is_vpn, is_proxy: draft.is_proxy, is_tor: draft.is_tor } : {}) }
    if (!entry) {
        const payload = await request(settings, '', 'POST', body)
        const result = object(payload)
        if (typeof result.message === 'string' && result.message.toLowerCase().includes('already exists')) return { kind: 'duplicate' }
        parseEntry(result)
        return { kind: 'saved' }
    }
    if (!Number.isSafeInteger(entry.id) || entry.id < 1) throw new Error('Choose a valid blocklist entry.')
    const payload = await request(settings, `/${entry.id}`, 'PUT', body)
    if (parseEntry(payload).id !== entry.id) throw new Error('The blocklist service returned a different entry.')
    return { kind: 'saved' }
}

export async function deleteBlocklistEntry(settings: AppSettings, id: number) {
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('Choose a valid blocklist entry.')
    const payload = object(await request(settings, `/${id}`, 'DELETE'))
    const deleted = parseEntry(payload.deleted)
    if (deleted.id !== id) throw new Error('The blocklist service returned a different entry.')
}

export function filterBlocklist(entries: BlocklistEntry[], query: string, type: 'all' | BlocklistType = 'all') {
    const normalized = query.trim().toLocaleLowerCase()
    return entries.filter(entry => (type === 'all' || entry.type === type)
        && (!normalized || `${entry.value} ${entry.type} ${entry.owner || ''} ${entry.location.city || ''} ${entry.location.region || ''} ${entry.location.country || ''}`.toLocaleLowerCase().includes(normalized)))
}
