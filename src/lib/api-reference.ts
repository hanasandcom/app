import type { AppSettings } from '../types'

export type JsonObject = Record<string, unknown>
export type ApiDocument = JsonObject & {
    openapi: string
    info: { title: string; version: string; description?: string }
    paths: Record<string, JsonObject>
}
export type ReferenceOperation = { method: string; path: string; operation: JsonObject }
export const documentLimit = 2 * 1024 * 1024
const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'])
export function object(value: unknown): value is JsonObject {
    return !!value && typeof value === 'object' && !Array.isArray(value)
}
export function text(value: unknown): string { return typeof value === 'string' ? value : '' }
export function openApiUrl(siteBaseUrl: string): string {
    const site = new URL(siteBaseUrl)
    if (site.protocol !== 'https:' || site.username || site.password || site.search || site.hash)
        throw new Error('API documentation requires an HTTPS website URL without credentials, query or fragment.')
    if (['hanasand.com', 'www.hanasand.com'].includes(site.hostname) && !site.port)
        return 'https://ti.hanasand.com/api/openapi/ti'
    return `${site.href.replace(/\/$/, '')}/api/openapi/ti`
}
function validateSecurity(value: unknown) {
    if (value === undefined) return
    if (!Array.isArray(value) || value.some((item) => !object(item) || Object.values(item).some((scopes) =>
        !Array.isArray(scopes) || scopes.some((scope) => typeof scope !== 'string')))) throw new Error('Invalid API security requirements.')
}
export function parseOpenApi(raw: string): ApiDocument {
    if (new TextEncoder().encode(raw).byteLength > documentLimit) throw new Error('The API contract exceeds the 2 MB display limit.')
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { throw new Error('The API contract is not valid JSON.') }
    const pending = [{ value: parsed, depth: 0 }]
    let nodes = 0
    while (pending.length) {
        const { value, depth } = pending.pop()!
        if (++nodes > 100000 || depth > 48) throw new Error('The API contract is too complex to display safely.')
        if (value && typeof value === 'object')
            for (const child of Object.values(value)) pending.push({ value: child, depth: depth + 1 })
    }
    if (!object(parsed) || !/^3\.(0|1)\.\d+$/.test(text(parsed.openapi)) || !object(parsed.info)
        || !text(parsed.info.title).trim() || !text(parsed.info.version).trim() || !object(parsed.paths))
        throw new Error('The documentation service did not return a valid OpenAPI 3 contract.')
    validateSecurity(parsed.security)
    if (parsed.info.description !== undefined && typeof parsed.info.description !== 'string')
        throw new Error('Invalid API description.')
    for (const [path, item] of Object.entries(parsed.paths)) {
        if (!path.startsWith('/') || !object(item)) throw new Error('The API contract contains an invalid path.')
        for (const [method, operation] of Object.entries(item)) {
            if (methods.has(method)) {
                if (!object(operation) || !object(operation.responses)) throw new Error('The API contract contains an invalid operation.')
                validateSecurity(operation.security)
                if (operation.requestBody !== undefined && !object(operation.requestBody)) throw new Error('Invalid API request body.')
                if (operation.parameters !== undefined && (!Array.isArray(operation.parameters) || operation.parameters.some((item) => !object(item))))
                    throw new Error('Invalid API parameters.')
                for (const response of Object.values(operation.responses))
                    if (!object(response) || (typeof response.$ref !== 'string' && typeof response.description !== 'string'))
                        throw new Error('Invalid API response.')
                for (const field of ['summary', 'description', 'operationId'])
                    if (operation[field] !== undefined && typeof operation[field] !== 'string') throw new Error('Invalid operation description.')
            }
        }
    }
    if (parsed.components !== undefined && !object(parsed.components)) throw new Error('Invalid API components.')
    if (object(parsed.components) && parsed.components.schemas !== undefined && !object(parsed.components.schemas))
        throw new Error('Invalid API schemas.')
    return parsed as ApiDocument
}
async function readDocument(response: Response): Promise<string> {
    // Native fetch versions without a readable body still get the same size check before parsing.
    if (!response.body || typeof response.body.getReader !== 'function') {
        const raw = await response.text()
        if (new TextEncoder().encode(raw).byteLength > documentLimit) throw new Error('The API contract exceeds the 2 MB display limit.')
        return raw
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8', { fatal: true })
    let raw = '', bytes = 0
    try {
        while (true) {
            const chunk = await reader.read()
            if (chunk.done) break
            bytes += chunk.value.byteLength
            if (bytes > documentLimit) {
                await reader.cancel()
                throw new Error('The API contract exceeds the 2 MB display limit.')
            }
            raw += decoder.decode(chunk.value, { stream: true })
        }
        return raw + decoder.decode()
    } finally { reader.releaseLock() }
}
export async function loadOpenApi(siteBaseUrl: string, signal: AbortSignal): Promise<ApiDocument> {
    // Public documentation must never receive the active account or its device proof.
    const controller = new AbortController()
    const cancel = () => controller.abort()
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
    let expired = false
    const timeout = setTimeout(() => { expired = true; controller.abort() }, 20000)
    try {
        const response = await fetch(openApiUrl(siteBaseUrl), {
            method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal,
            headers: { Accept: 'application/json' }
        })
        if (!response.ok) throw new Error(`API documentation is unavailable (${response.status}). Refresh to retry.`)
        const length = response.headers.get('content-length')
        if (length && Number(length) > documentLimit) throw new Error('The API contract exceeds the 2 MB display limit.')
        const raw = await readDocument(response)
        if (controller.signal.aborted) throw new Error('API documentation request cancelled.')
        return parseOpenApi(raw)
    } catch (cause) {
        if (expired) throw new Error('API documentation timed out. Refresh to retry.', { cause })
        throw cause
    } finally {
        clearTimeout(timeout)
        signal.removeEventListener('abort', cancel)
    }
}
export function operations(document: ApiDocument): ReferenceOperation[] {
    return Object.entries(document.paths).flatMap(([path, item]) => Object.entries(item)
        .filter(([method, value]) => methods.has(method) && object(value))
        .map(([method, value]) => ({ method: method.toUpperCase(), path, operation: value as JsonObject })))
        .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
}
export function resolveReference(document: ApiDocument, value: unknown): { value: unknown; reference?: string; resolved: boolean } {
    if (!object(value) || typeof value.$ref !== 'string') return { value, resolved: true }
    const reference = value.$ref
    if (!reference.startsWith('#/')) return { value, reference, resolved: false }
    let result: unknown = document
    for (const segment of reference.slice(2).split('/')) {
        const key = segment.replace(/~1/g, '/').replace(/~0/g, '~')
        if (!object(result) || !Object.hasOwn(result, key)) return { value, reference, resolved: false }
        result = result[key]
    }
    return { value: result, reference, resolved: true }
}
export function referencedSchemas(value: unknown): string[] {
    const references = new Set<string>()
    const pending = [value]
    while (pending.length) {
        const item = pending.pop()
        if (object(item)) {
            if (typeof item.$ref === 'string') references.add(item.$ref)
            pending.push(...Object.values(item))
        } else if (Array.isArray(item)) pending.push(...item)
    }
    return [...references].sort()
}
export function operationMatches(row: ReferenceOperation, query: string): boolean {
    return `${row.method} ${row.path} ${text(row.operation.summary)} ${text(row.operation.operationId)} ${text(row.operation.description)}`
        .toLowerCase().includes(query.trim().toLowerCase())
}
export function securityLabel(document: ApiDocument, operation: JsonObject): string {
    const security = operation.security ?? document.security
    if (Array.isArray(security)) {
        if (!security.length || security.some((item) => object(item) && !Object.keys(item).length)) return 'Public'
        return security.map((item) => object(item) ? Object.entries(item).map(([name, scopes]) =>
            `${name}${Array.isArray(scopes) && scopes.length ? ` (${scopes.join(', ')})` : ''}`).join(' + ') : 'Invalid security requirement').join(' OR ')
    }
    return 'Public (no security requirement declared)'
}
export function jsonChunks(value: unknown, size = 8000): string[] {
    if (!Number.isSafeInteger(size) || size < 2) throw new Error('Invalid JSON page size.')
    const raw = JSON.stringify(value, null, 2) ?? 'null'
    const pages: string[] = []
    for (let offset = 0; offset < raw.length;) {
        let end = Math.min(raw.length, offset + size)
        if (end < raw.length && /[\uD800-\uDBFF]/.test(raw[end - 1])) end--
        pages.push(raw.slice(offset, end)); offset = end
    }
    return pages
}
export function referenceScope(settings: AppSettings, mode: string): string {
    return JSON.stringify([settings.siteBaseUrl, settings.userId, settings.authToken, settings.impersonationToken,
        settings.impersonatingUserId, settings.selectedOrganizationId, mode])
}
export class ReferenceRequests {
    private epoch = 0
    private controller?: AbortController
    start() {
        this.invalidate()
        const controller = new AbortController()
        this.controller = controller
        return { epoch: this.epoch, controller }
    }
    invalidate() { this.epoch++; this.controller?.abort(); this.controller = undefined }
    canApply(operation: { epoch: number; controller: AbortController }, visible: boolean) {
        return visible && operation.epoch === this.epoch && !operation.controller.signal.aborted
    }
}
