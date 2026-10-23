import type { AppSettings } from '../../types'
import { organizationListBase } from '../../lib/organization-endpoint'
import { accountScope, contentOrganization, articleId, assertItemScope, contentItem, object, PublishingError, requireWriter, validateMutation, type ContentKind, type Mutation, type PublishingAccess, type SavedReceipt } from './contracts'

export type PublishingFetch = (settings: AppSettings, url: string, init: RequestInit) => Promise<Response>
const defaultFetch: PublishingFetch = async (settings, url, init) => (await import('../../lib/api')).apiFetch(settings, url, init)
export function publishingEndpoint(base: string, path: string) {
    const url = new URL(base)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new PublishingError('Configure a secure publishing service address.')
    return url.toString().replace(/\/+$/, '') + '/' + path
}
export function createPublishingApi(settings: AppSettings, kind: ContentKind, transport: PublishingFetch = defaultFetch, deadlineMs = 20000) {
    const organizationId = contentOrganization(settings)
    const fixed = { ...settings, selectedOrganizationId: organizationId || undefined }
    async function request(path: string, signal: AbortSignal, method = 'GET', body?: unknown, membership = false, readOnlyPost = false) {
        if (!fixed.authToken || !fixed.userId) throw new PublishingError('Sign in to open publishing.', 401)
        const writing = method !== 'GET' && !readOnlyPost
        if (writing && (fixed.impersonationToken || fixed.impersonatingUserId)) throw new PublishingError('Return to your own account before changing public content.', 403)
        const scoped = membership ? { ...fixed, selectedOrganizationId: undefined } : fixed
        const url = publishingEndpoint(membership ? organizationListBase(fixed) : fixed.apiBaseUrl, path)
        const controller = new AbortController()
        let submitted = false
        let rejectAbort!: (error: PublishingError) => void
        const interrupted = new Promise<never>((_, reject) => { rejectAbort = reject })
        const abort = () => controller.abort()
        const failAbort = () => rejectAbort(new PublishingError('The request was interrupted. Refresh and review the result before trying again.', 0, writing && submitted))
        controller.signal.addEventListener('abort', failAbort, { once: true })
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
        const timer = setTimeout(abort, Math.max(1, Math.min(60000, deadlineMs)))
        try {
            return await Promise.race([(async () => {
                if (controller.signal.aborted) throw new PublishingError('The request was cancelled before submission.')
                submitted = true
                let response: Response
                try {
                    response = await transport(scoped, url, {
                        method, credentials: 'omit', signal: controller.signal,
                        headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${fixed.authToken}`, id: fixed.userId,
                            ...(organizationId && !membership ? { 'x-organization-id': organizationId } : {}),
                            ...(fixed.impersonationToken ? { 'x-impersonation-token': fixed.impersonationToken } : {}) },
                        body: body === undefined ? undefined : JSON.stringify(body),
                    })
                } catch { throw new PublishingError('The publishing service could not be reached. Refresh and review before trying again.', 0, writing) }
                let text: string
                try { text = await response.text() } catch { throw new PublishingError('The response was interrupted. Review the service result before trying again.', response.status, writing) }
                if (text.length > 8_000_000) throw new PublishingError('The response exceeded its size limit.', response.status, writing)
                let value: unknown
                try { value = JSON.parse(text) } catch { throw new PublishingError('The publishing response is invalid. Review before trying again.', response.status, writing) }
                if (!response.ok) throw new PublishingError([401, 403].includes(response.status) ? 'Publishing access could not be verified. Refresh after checking your account.' : response.status === 409 ? 'That filename or thought already exists. Review the existing content.' : response.status === 404 ? 'The content was not found.' : 'The operation failed. Refresh and review its result.', response.status, writing && response.status >= 500)
                return { value, status: response.status }
            })(), interrupted])
        } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', failAbort) }
    }
    return {
        async access(signal: AbortSignal): Promise<PublishingAccess> {
            const base = { scope: accountScope(fixed), organizationId, name: organizationId ? 'Organization content' : 'Hanasand editorial content' }
            let canRead: boolean, canWrite: boolean
            let warning: string | undefined
            if (organizationId) {
                const value = object((await request('organizations', signal, 'GET', undefined, true)).value)
                if (!Array.isArray(value.organizations)) throw new PublishingError('Workspace permissions are invalid.')
                const member = value.organizations.map(object).find(row => row.id === organizationId)
                const active = member && (member.lifecycleStatus || member.status) === 'active'
                canRead = !!active
                canWrite = !!active && ['owner', 'admin', 'editor'].includes(String(member.role).toLowerCase())
                if (member && typeof member.name === 'string') base.name = member.name
            } else {
                // Unscoped editorial reads are public in Core. Only writes require
                // the fixed Hanasand membership; unavailable flags never grant them.
                canRead = true
                canWrite = false
                try {
                    const value = object((await request('management/organizations?internalPages=1', signal, 'GET', undefined, true)).value)
                    if (typeof value.allowed !== 'boolean' || typeof value.canEdit !== 'boolean') throw new PublishingError('Editorial permissions are invalid.')
                    canWrite = value.allowed && value.canEdit
                } catch (error) {
                    if (signal.aborted) throw error
                    warning = 'Public content can be read, but editing access could not be verified. Refresh before editing.'
                }
            }
            return { ...base, canRead, warning, canWrite: canWrite && !fixed.impersonationToken && !fixed.impersonatingUserId }
        },
        async list(signal: AbortSignal) {
            const { value } = await request(kind + '?workspace=true', signal)
            if (!Array.isArray(value) || value.length > 100000) throw new PublishingError('The content list is invalid.')
            const items = value.map(row => assertItemScope(contentItem(row, kind), organizationId))
            if (new Set(items.map(row => row.id)).size !== items.length) throw new PublishingError('The content list contains duplicate identities.')
            return items
        },
        async detail(id: string, signal: AbortSignal) {
            const normalized = kind === 'articles' ? articleId(id) : id
            const { value } = await request(`${kind === 'articles' ? 'article' : 'thought'}/${encodeURIComponent(normalized)}`, signal)
            const item = assertItemScope(contentItem(value, kind, true), organizationId)
            if (item.id !== normalized) throw new PublishingError('The selected content identity changed.')
            return item
        },
        async findThought(title: string, signal: AbortSignal) {
            try {
                const { value } = await request('thought/title', signal, 'POST', { title }, false, true)
                if (!Array.isArray(value)) throw new PublishingError('The thought lookup is invalid.')
                return value.map(row => contentItem(row, 'thoughts', true)).filter(row => row.organizationId === organizationId && row.body === title)
            } catch (error) { if (error instanceof PublishingError && error.status === 404) return []; throw error }
        },
        async mutate(access: PublishingAccess, mutation: Mutation, signal: AbortSignal): Promise<SavedReceipt> {
            requireWriter(fixed, access, mutation.original)
            const id = validateMutation(kind, mutation)
            const method = mutation.action === 'create' ? 'POST' : mutation.action === 'update' ? 'PUT' : 'DELETE'
            const path = mutation.action === 'create' && kind === 'thoughts' ? 'thoughts' : `${kind === 'articles' ? 'article' : 'thought'}/${encodeURIComponent(id)}`
            const { value, status } = await request(path, signal, method, method === 'DELETE' ? undefined : kind === 'articles' ? { content: mutation.draft.body } : { title: mutation.draft.body })
            try {
                const row = object(value)
                if (mutation.action === 'delete' && status === 200 && row.deleted === true && String(row.id) === id) return { action: mutation.action, id }
                if (kind === 'articles' && ((mutation.action === 'create' && status === 201 && row.created === true && row.name === id) || (mutation.action === 'update' && status === 200 && row.updated === true && row.id === id))) return { action: mutation.action, id }
                if (kind === 'thoughts' && status === 201 && mutation.action !== 'delete') {
                    const saved = mutation.action === 'create' ? contentItem(row, kind, true) : (() => {
                        const result = object(row.result)
                        if (!Array.isArray(result.rows) || result.rows.length !== 1) throw new Error('Invalid saved thought')
                        return contentItem(result.rows[0], kind, true)
                    })()
                    assertItemScope(saved, organizationId)
                    if (saved.body !== mutation.draft.body || (mutation.action === 'update' && saved.id !== id) || (mutation.action === 'create' && saved.creatorId !== fixed.userId)) throw new Error('The saved thought does not match')
                    return { action: mutation.action, id: saved.id, item: saved }
                }
                throw new Error('Invalid receipt')
            } catch { throw new PublishingError('The save result could not be confirmed. Your draft is kept; refresh and review before another operation.', status, true) }
        },
    }
}
export type PublishingApi = ReturnType<typeof createPublishingApi>
