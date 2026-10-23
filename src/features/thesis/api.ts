import type { AppSettings } from '../../types'
import { document, type ThesisDocument } from './document'

export type HistoryEntry = { revision: number; title: string; saved_at: string; immediate: boolean }
export type ReviewEvent = { event_id: string; item_id: string; content_hash: string; review_hash: string; approved: boolean; reviewer: string; reviewed_at: string }
export type SourceNode = { id: string; kind: 'frontend' | 'api' | 'database' | 'source'; title: string; file: string; line?: number; sha256: string; reviewHash: string; dependencies: string[]; dependencyCount: number; unresolved: string[]; content?: string; review?: ReviewEvent }
export type Inventory = { version: string | number; hash: string; nodes: SourceNode[]; release: string; revision?: string; sync?: { phase?: string; checkedAt?: string; error?: string; warning?: string } }
export class ThesisError extends Error {
    constructor(message: string, readonly status = 0, readonly current?: ThesisDocument) { super(message) }
}
export type ThesisFetch = (settings: AppSettings, url: string, init: RequestInit) => Promise<Response>
const fetchDefault: ThesisFetch = async (settings, url, init) => (await import('../../lib/api')).apiFetch(settings, url, init)

export function thesisEndpoint(base: string, path: string) {
    const url = new URL(base)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new ThesisError('Configure a secure Thesis service address.')
    return url.toString().replace(/\/+$/, '') + '/' + path
}
export function ownAccount(settings: AppSettings) {
    if (settings.impersonationToken || settings.impersonatingUserId) throw new ThesisError('Return to your own account to open Thesis.', 403)
    if (!settings.authToken || !settings.userId) throw new ThesisError('Sign in to open Thesis.', 401)
}
const row = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
const strings = (v: unknown): string[] => Array.isArray(v) && v.every(x => typeof x === 'string') ? v : []
export function parseReview(value: unknown): ReviewEvent {
    const v = row(value)
    if (['event_id', 'item_id', 'content_hash', 'review_hash', 'reviewer', 'reviewed_at'].some(k => typeof v[k] !== 'string') || typeof v.approved !== 'boolean'
        || !/^[a-f0-9]{64}$/.test(String(v.content_hash)) || !/^[a-f0-9]{64}$/.test(String(v.review_hash)) || !Number.isFinite(Date.parse(String(v.reviewed_at)))) throw new ThesisError('The review response is invalid.')
    return v as ReviewEvent
}
export function parseNode(value: unknown): SourceNode {
    const v = row(value)
    if (['id', 'title', 'file', 'sha256', 'reviewHash'].some(k => typeof v[k] !== 'string') || !['frontend', 'api', 'database', 'source'].includes(String(v.kind)) || !Array.isArray(v.dependencies) || !Array.isArray(v.unresolved)
        || v.dependencies.some(item => typeof item !== 'string') || v.unresolved.some(item => typeof item !== 'string')
        || !/^[a-f0-9]{64}$/.test(String(v.sha256)) || !/^[a-f0-9]{64}$/.test(String(v.reviewHash))
        || typeof v.dependencyCount !== 'number' || !Number.isSafeInteger(v.dependencyCount) || v.dependencyCount < 0) throw new ThesisError('The source inventory is invalid.')
    return { ...v, dependencies: strings(v.dependencies), unresolved: strings(v.unresolved), review: v.review ? parseReview(v.review) : undefined } as SourceNode
}
export function parseInventory(value: unknown): Inventory {
    const v = row(value)
    if (!Array.isArray(v.nodes) || v.nodes.length > 100000 || typeof v.hash !== 'string' || typeof v.release !== 'string') throw new ThesisError('The source inventory is invalid.')
    const nodes = v.nodes.map(parseNode)
    if (new Set(nodes.map(item => item.id)).size !== nodes.length) throw new ThesisError('The source inventory contains duplicate items.')
    return { ...v, nodes } as Inventory
}

export function createThesisApi(settings: AppSettings, transport: ThesisFetch = fetchDefault) {
    const fixed = { ...settings, selectedOrganizationId: undefined }
    async function request(path: string, signal: AbortSignal, body?: unknown, site = false, method = body === undefined ? 'GET' : 'PUT') {
        ownAccount(fixed)
        const url = thesisEndpoint(site ? fixed.siteBaseUrl : fixed.apiBaseUrl, path)
        const controller = new AbortController()
        const abort = () => controller.abort()
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) controller.abort()
        const timeout = setTimeout(abort, 20000)
        try {
            const response = await transport(fixed, url, {
                method, signal: controller.signal, credentials: 'omit',
                headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${fixed.authToken}`, id: fixed.userId, ...(site && method !== 'GET' ? { Origin: new URL(fixed.siteBaseUrl).origin } : {}) },
                body: body === undefined ? undefined : JSON.stringify(body),
            })
            if (response.status === 204) return null
            const raw = await response.text()
            if (raw.length > 8_000_000) throw new ThesisError('The Thesis response exceeded its limit.')
            let value: unknown
            try { value = JSON.parse(raw) } catch { throw new ThesisError('The Thesis service returned an invalid response.', response.status) }
            if (!response.ok) {
                if (response.status === 409 && !site) throw new ThesisError('Another editor saved a newer version. Your draft is kept.', 409, document(value))
                throw new ThesisError([401, 403].includes(response.status) ? 'Your Thesis access could not be verified. Refresh after signing in with an eligible account.' : String(row(value).error || 'The Thesis request failed. Refresh before trying again.'), response.status)
            }
            return value
        } finally { clearTimeout(timeout); signal.removeEventListener('abort', abort) }
    }
    return {
        async access(signal: AbortSignal) {
            const v = row(await request('thesis/access', signal))
            if (typeof v.member !== 'boolean' || typeof v.canEdit !== 'boolean') throw new ThesisError('The Thesis permissions are invalid.')
            return { member: v.member, canEdit: v.canEdit }
        },
        async load(signal: AbortSignal) { return document(await request('thesis', signal)) },
        async save(value: ThesisDocument, signal: AbortSignal) { return document(await request('thesis', signal, document(value))) },
        async history(signal: AbortSignal, before?: number) {
            const value = await request('thesis/history' + (before === undefined ? '' : `?before=${before}`), signal)
            if (!Array.isArray(value) || value.length > 50 || value.some(v => !Number.isSafeInteger(v.revision) || typeof v.title !== 'string' || typeof v.saved_at !== 'string' || typeof v.immediate !== 'boolean')) throw new ThesisError('The version history is invalid.')
            return value as HistoryEntry[]
        },
        async version(revision: number, signal: AbortSignal) {
            if (!Number.isSafeInteger(revision) || revision < 0) throw new ThesisError('Choose a valid version.')
            return document(await request(`thesis/history/${revision}`, signal))
        },
        async inventory(signal: AbortSignal, since?: string) {
            const value = await request('api/thesis/code' + (since ? '?' + new URLSearchParams({ since }) : ''), signal, undefined, true)
            return value === null ? null : parseInventory(value)
        },
        async source(id: string, signal: AbortSignal, before?: string) {
            const value = row(await request('api/thesis/code?' + new URLSearchParams({ id, ...(before ? { before } : {}) }), signal, undefined, true))
            if (!Array.isArray(value.history) || value.history.length > 50) throw new ThesisError('The source history is invalid.')
            const item = parseNode(value.item)
            if (item.id !== id || typeof item.content !== 'string') throw new ThesisError('The source detail does not match this selection.')
            return { item, history: value.history.map(parseReview) }
        },
        async review(item: SourceNode, approved: boolean, eventId: string, signal: AbortSignal) {
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)) throw new ThesisError('The review identifier is invalid.')
            const result = parseReview(await request('api/thesis/code', signal, { id: item.id, sha256: item.sha256, reviewHash: item.reviewHash, approved, eventId }, true, 'POST'))
            if (result.event_id !== eventId || result.item_id !== item.id || result.review_hash !== item.reviewHash || result.content_hash !== item.sha256 || result.approved !== approved) throw new ThesisError('The review receipt did not match this action.')
            return result
        },
    }
}
export type ThesisApi = ReturnType<typeof createThesisApi>
