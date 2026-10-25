import type { AppSettings } from '../types'
import { apiFetch } from './api'
import { headerRecord, setHeader } from './headers'
import type { ToolOrganization } from './organization-tools'

export const internalOrganizationId = '3e735e7b-4d7f-444d-9806-231fa26cfcec'
export const rateScopes = ['anonymous', 'authenticated', 'internal'] as const
export type RateScope = (typeof rateScopes)[number]
export type RateRule = { windowMs: number; maxRequests: number }
export type RateOverride = RateRule & { id: string; enabled: boolean; method: string; route: string; scope: RateScope }
export type RatePolicy = {
    enabled: boolean; defaults: Record<RateScope, RateRule>; overrides: RateOverride[]
    updatedAt: string | null; updatedBy: string | null
}
export type RateRoute = { method: string; route: string }
export const ratePeriods = ['perSecond', 'perMinute', 'perHour', 'perDay'] as const
export type RateLimits = Record<(typeof ratePeriods)[number], number | null>
export type KeyScope = RateRoute & { id: string; enabled: boolean; limits: RateLimits }
export type RateTier = { id: string; label: string; description: string; defaultLimits: RateLimits }
export type RateKeyDraft = {
    ownerId: string; name: string; tier: string; description: string; enabled: boolean
    expiresAt: string; scopes: KeyScope[]
}
export type RateKey = RateKeyDraft & {
    id: string; organizationId: string | null; keyPrefix: string
    createdAt: string; updatedAt: string; lastUsedAt: string | null
}
export type RateOwner = { id: string; name: string; email: string }
export type RateConfiguration = { settings: RatePolicy; routes: RateRoute[]; tierPresets: RateTier[] }
export class RateRequestError extends Error {
    constructor(message: string, readonly status: number) { super(message) }
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown) => typeof value === 'string' ? value : ''
const rows = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const nullableText = (value: unknown) => typeof value === 'string' ? value : null
const fail = (): never => { throw new Error('The rate limit response was incomplete. Refresh before making changes.') }
export const rateAccountScope = (settings: AppSettings) => JSON.stringify([
    settings.apiBaseUrl, settings.siteBaseUrl, settings.userId, settings.authToken,
    settings.impersonationToken, settings.impersonatingUserId
])
export function canWriteRates(settings: AppSettings, organizations: ToolOrganization[]) {
    return Boolean(settings.userId && settings.authToken && !settings.impersonationToken && !settings.impersonatingUserId && organizations.some(
        (org) => org.id === internalOrganizationId && org.status === 'active' && ['owner', 'admin', 'editor'].includes(org.role)
    ))
}
export function positiveInteger(value: string, label: string, min = 1, max = Number.MAX_SAFE_INTEGER) {
    if (!/^\d+$/.test(value.trim())) throw new Error(`${label} must be a whole number.`)
    const number = Number(value)
    if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`${label} must be between ${min} and ${max}.`)
    return number
}
export function nullableLimit(value: string) { return value.trim() ? positiveInteger(value, 'Limit') : null }
function parseLimits(value: unknown): RateLimits {
    const data = record(value)
    return Object.fromEntries(ratePeriods.map((period) => {
        const limit = data[period]
        if (limit !== null && (!Number.isSafeInteger(limit) || Number(limit) < 1)) fail()
        return [period, limit]
    })) as RateLimits
}
function parseRule(value: unknown): RateRule {
    const data = record(value)
    if (!Number.isSafeInteger(data.windowMs) || !Number.isSafeInteger(data.maxRequests)) fail()
    return { windowMs: Number(data.windowMs), maxRequests: Number(data.maxRequests) }
}
export function parsePolicy(value: unknown): RatePolicy {
    const data = record(value)
    if (typeof data.enabled !== 'boolean' || !Array.isArray(data.overrides)) fail()
    const defaults = record(data.defaults)
    const policy: RatePolicy = {
        enabled: data.enabled as boolean,
        defaults: Object.fromEntries(rateScopes.map((scope) => [scope, parseRule(defaults[scope])])) as Record<RateScope, RateRule>,
        overrides: rows(data.overrides).map((value) => {
            const row = record(value)
            if (typeof row.enabled !== 'boolean' || !rateScopes.includes(row.scope as RateScope)) fail()
            return { ...parseRule(row), id: text(row.id), enabled: row.enabled as boolean, method: text(row.method), route: text(row.route), scope: row.scope as RateScope }
        }),
        updatedAt: nullableText(data.updatedAt), updatedBy: nullableText(data.updatedBy)
    }
    policyPayload(policy)
    return policy
}
export function policyPayload(policy: RatePolicy) {
    const seen = new Set<string>()
    const rule = (value: RateRule) => ({
        windowMs: positiveInteger(String(value.windowMs), 'Window in milliseconds', 1000, 86400000),
        maxRequests: positiveInteger(String(value.maxRequests), 'Requests', 1, 1000000)
    })
    return {
        enabled: policy.enabled,
        defaults: Object.fromEntries(rateScopes.map((scope) => [scope, rule(policy.defaults[scope])])),
        overrides: policy.overrides.map((item) => {
            const method = item.method.trim().toUpperCase(), route = item.route.trim()
            if (!method || !route.startsWith('/api') || !item.id || !rateScopes.includes(item.scope)) throw new Error('Each override needs an ID, method, /api route and scope.')
            const key = `${item.scope}:${method}:${route}`
            if (seen.has(key)) throw new Error('Remove duplicate scope, method and route overrides.')
            seen.add(key)
            return { id: item.id, enabled: item.enabled, scope: item.scope, method, route, ...rule(item) }
        })
    }
}
export function keyPayload(draft: RateKeyDraft): RateKeyDraft {
    const ownerId = draft.ownerId.trim(), name = draft.name.trim(), tier = draft.tier.trim(), description = draft.description.trim()
    if (!ownerId || !name || !tier || !description || !draft.expiresAt.trim() || !Number.isFinite(Date.parse(draft.expiresAt))) throw new Error('Choose an owner, name, tier, description and valid expiry date.')
    if (!draft.scopes.length) throw new Error('Add at least one route scope.')
    const seen = new Set<string>()
    return { ownerId, name, tier, description, expiresAt: draft.expiresAt, enabled: draft.enabled, scopes: draft.scopes.map((scope) => {
        const method = scope.method.trim().toUpperCase(), route = scope.route.trim()
        if (!scope.id || !method || !route.startsWith('/')) throw new Error('Each key scope needs an ID, method and route beginning with /.')
        const key = `${method}:${route}`
        if (seen.has(key)) throw new Error('Remove duplicate method and route scopes.')
        seen.add(key)
        return { id: scope.id, method, route, enabled: scope.enabled, limits: Object.fromEntries(ratePeriods.map((period) => [period, scope.limits[period] === null ? null : positiveInteger(String(scope.limits[period]), 'Period limit')])) as RateLimits }
    }) }
}
export function parseRateKey(value: unknown): RateKey {
    const data = record(value)
    if (!text(data.id) || !Array.isArray(data.scopes) || typeof data.enabled !== 'boolean') fail()
    return {
        id: text(data.id), ownerId: text(data.ownerId), organizationId: nullableText(data.organizationId),
        name: text(data.name), tier: text(data.tier), description: text(data.description), enabled: data.enabled as boolean,
        expiresAt: text(data.expiresAt), keyPrefix: text(data.keyPrefix), createdAt: text(data.createdAt),
        updatedAt: text(data.updatedAt), lastUsedAt: nullableText(data.lastUsedAt),
        scopes: rows(data.scopes).map((value) => {
            const row = record(value)
            if (typeof row.enabled !== 'boolean') fail()
            return { id: text(row.id), method: text(row.method), route: text(row.route), enabled: row.enabled as boolean, limits: parseLimits(row.limits) }
        })
    }
}
async function request(settings: AppSettings, path: string, signal: AbortSignal, method = 'GET', body?: unknown) {
    if (!settings.userId || !settings.authToken) throw new Error('Log in again to manage rate limits.')
    const url = new URL(`${settings.apiBaseUrl.replace(/\/+$/, '')}/${path}`)
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Use an HTTPS API address without credentials.')
    const headers = headerRecord({ Authorization: `Bearer ${settings.authToken}`, id: settings.userId, 'Content-Type': 'application/json' })
    if (settings.impersonationToken) setHeader(headers, 'x-impersonation-token', settings.impersonationToken)
    const controller = new AbortController(), abort = () => controller.abort()
    const timer = setTimeout(abort, 20000)
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort)
    try {
        const response = await apiFetch(settings, url.toString(), { method, headers, signal: controller.signal, cache: 'no-store', body: body === undefined ? undefined : JSON.stringify(body) })
        const data = await response.json().catch(() => null)
        if (!response.ok) {
            const message = response.status === 401 ? 'Your session could not be verified. Log in again.' : response.status === 403 ? 'You do not have permission for this operation.' : response.status === 409 ? 'The data changed. Refresh before trying again.' : response.status === 429 ? 'Too many requests. Wait, then refresh.' : `Rate limit service request failed (${response.status}).`
            throw new RateRequestError(message, response.status)
        }
        return data
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
}
export async function loadRateConfiguration(settings: AppSettings, signal: AbortSignal): Promise<RateConfiguration> {
    const data = record(await request(settings, 'rate-limit/settings', signal))
    if (!Array.isArray(data.routes) || !Array.isArray(data.tierPresets)) fail()
    return {
        settings: parsePolicy(data.settings),
        routes: rows(data.routes).map((row) => ({ method: text(record(row).method), route: text(record(row).route) })),
        tierPresets: rows(data.tierPresets).map((value) => {
            const row = record(value)
            return { id: text(row.id), label: text(row.label), description: text(row.description), defaultLimits: parseLimits(row.defaultLimits) }
        })
    }
}
export async function loadRateKeys(settings: AppSettings, signal: AbortSignal) {
    const data = record(await request(settings, 'rate-limit/keys', signal))
    if (!Array.isArray(data.apiKeys)) fail()
    return rows(data.apiKeys).map(parseRateKey)
}
export async function loadRateOwners(settings: AppSettings, signal: AbortSignal): Promise<RateOwner[]> {
    try {
        const value = await request(settings, 'users', signal)
        const values = Array.isArray(value) ? value : record(value).users
        if (!Array.isArray(values)) fail()
        return rows(values).flatMap((value) => {
            const row = record(value)
            return text(row.id) ? [{ id: text(row.id), name: text(row.name) || text(row.username) || text(row.id), email: text(row.email) }] : []
        })
    } catch (cause) { if (cause instanceof RateRequestError && cause.status === 404) return []; throw cause }
}
function requireWriter(settings: AppSettings, organizations: ToolOrganization[]) {
    if (!canWriteRates(settings, organizations)) throw new Error('An active Hanasand owner, admin or editor account is required.')
}
export async function saveRatePolicy(settings: AppSettings, organizations: ToolOrganization[], policy: RatePolicy, signal: AbortSignal) {
    requireWriter(settings, organizations)
    return parsePolicy(record(await request(settings, 'rate-limit/settings', signal, 'PUT', policyPayload(policy))).settings)
}
export async function saveRateKey(settings: AppSettings, organizations: ToolOrganization[], draft: RateKeyDraft, signal: AbortSignal, id?: string) {
    requireWriter(settings, organizations)
    const data = record(await request(settings, `rate-limit/keys${id ? `/${encodeURIComponent(id)}` : ''}`, signal, id ? 'PUT' : 'POST', keyPayload(draft)))
    const apiKey = parseRateKey(data.apiKey)
    if (!id && !text(data.secret)) fail()
    return { apiKey, secret: id ? null : text(data.secret) }
}
export async function deleteRateKey(settings: AppSettings, organizations: ToolOrganization[], id: string, signal: AbortSignal) {
    requireWriter(settings, organizations)
    if (record(await request(settings, `rate-limit/keys/${encodeURIComponent(id)}`, signal, 'DELETE')).ok !== true) fail()
}
/** A confirmation belongs to one foreground screen epoch, never a later refresh or account. */
export function validRateConfirmation(expected: number, current: number, writable: boolean, busy: boolean, visible: boolean) {
    return expected === current && writable && !busy && visible
}

export function mayRevealRateSecret(operationEpoch: number, currentEpoch: number, foreground: boolean, focused: boolean, active: boolean) {
    return operationEpoch === currentEpoch && foreground && focused && active
}

export type RateOperation = { epoch: number; kind: 'read' | 'write'; controller: AbortController }
/** Owns only this screen's in-flight operation; aborted writes need explicit reconciliation. */
export class RateOperations {
    private epoch = 0
    private current: RateOperation | null = null
    requiresRefresh = false
    start(kind: RateOperation['kind']): RateOperation {
        this.invalidate()
        const operation = { epoch: ++this.epoch, kind, controller: new AbortController() }
        this.current = operation
        return operation
    }
    invalidate() {
        const operation = this.current
        this.current = null
        this.epoch++
        if (operation?.kind === 'write') this.requiresRefresh = true
        operation?.controller.abort()
    }
    canApply(operation: RateOperation, visible: boolean) {
        return visible && this.current === operation && operation.epoch === this.epoch && !operation.controller.signal.aborted
    }
    reconcileRead(operation: RateOperation, visible: boolean, explicit: boolean) {
        if (operation.kind !== 'read' || !this.canApply(operation, visible)) return false
        if (explicit) this.requiresRefresh = false
        return true
    }
    fail(operation: RateOperation) {
        if (this.current === operation && operation.kind === 'write') this.requiresRefresh = true
    }
    finish(operation: RateOperation) {
        if (this.current !== operation) return false
        this.current = null
        return true
    }
}
