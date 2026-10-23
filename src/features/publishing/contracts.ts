import type { AppSettings } from '../../types'

export type ContentKind = 'articles' | 'thoughts'
export type ContentItem = {
    kind: ContentKind; id: string; organizationId: string | null; title: string
    body?: string; createdAt?: string; updatedAt?: string; creatorId?: string
    words?: number; minutes?: number; description?: string; image?: string
}
export type PublishingAccess = { scope: string; organizationId: string | null; canRead: boolean; canWrite: boolean; name: string }
export type PublishingDraft = { id: string; body: string }
export type Mutation = { action: 'create' | 'update' | 'delete'; draft: PublishingDraft; original?: ContentItem }
export type SavedReceipt = { action: Mutation['action']; id: string; item?: ContentItem }
export class PublishingError extends Error {
    constructor(message: string, readonly status = 0, readonly uncertain = false) { super(message) }
}
export function accountScope(settings: AppSettings) {
    // Memory-only context. Never log or persist this value.
    return JSON.stringify([settings.apiBaseUrl, settings.userId, settings.authToken, settings.selectedOrganizationId || null, settings.impersonationToken, settings.impersonatingUserId])
}
export function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PublishingError('The publishing service returned invalid data.')
    return value as Record<string, unknown>
}
export function articleId(value: string) {
    const id = value.endsWith('.md') ? value : value + '.md'
    if (id.length > 200 || !/^[\w.-]+\.md$/.test(id) || id.startsWith('.')) throw new PublishingError('Use an article filename with letters, numbers, underscores, dashes or dots, without a leading dot.')
    return id
}
export function thoughtId(value: unknown) {
    const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value
    if (typeof text !== 'string' || !/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text))) throw new PublishingError('The thought identity is invalid.')
    return text
}
const optionalText = (value: unknown) => typeof value === 'string' ? value : undefined
export function contentItem(value: unknown, kind: ContentKind, detail = false): ContentItem {
    const row = object(value)
    const id = kind === 'articles' && typeof row.id === 'string' ? articleId(row.id) : kind === 'thoughts' ? thoughtId(row.id) : ''
    if (!id || typeof row.title !== 'string' || row.title.length > 1_000_000 || (row.organization_id !== null && row.organization_id !== undefined && typeof row.organization_id !== 'string')) throw new PublishingError('The saved content is invalid.')
    if (kind === 'articles' && detail && typeof row.content !== 'string') throw new PublishingError('The article body is missing.')
    const metadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata as Record<string, unknown> : {}
    const metric = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
    return {
        kind, id, title: row.title, organizationId: typeof row.organization_id === 'string' ? row.organization_id : null,
        body: kind === 'thoughts' ? row.title : optionalText(row.content),
        createdAt: optionalText(row.created || row.created_at), updatedAt: optionalText(row.modified || row.updated_at),
        creatorId: optionalText(row.created_by), words: metric(metadata.wordCount), minutes: metric(metadata.estimatedMinutes),
        description: optionalText(metadata.description), image: optionalText(metadata.image),
    }
}
export function assertItemScope(item: ContentItem, organizationId: string | null) {
    if (item.organizationId !== organizationId) throw new PublishingError('This content belongs to another workspace. Refresh the current workspace.', 403)
    return item
}
export function requireWriter(settings: AppSettings, access: PublishingAccess, original?: ContentItem) {
    if (settings.impersonationToken || settings.impersonatingUserId || access.scope !== accountScope(settings) || !access.canRead || !access.canWrite || access.organizationId !== (settings.selectedOrganizationId || null)) throw new PublishingError('Editing access could not be verified. Refresh using your own eligible account.', 403)
    if (original) assertItemScope(original, access.organizationId)
}
export function validateMutation(kind: ContentKind, mutation: Mutation) {
    if (mutation.action !== 'create' && !mutation.original) throw new PublishingError('Choose saved content first.')
    if (mutation.original && mutation.original.kind !== kind) throw new PublishingError('The saved content type changed.')
    const id = kind === 'articles' ? articleId(mutation.action === 'create' ? mutation.draft.id.trim() : mutation.original!.id) : mutation.original ? thoughtId(mutation.original.id) : ''
    if (mutation.action !== 'delete' && (!mutation.draft.body.trim() || mutation.draft.body.length > 1_000_000)) throw new PublishingError('Enter content up to 1,000,000 characters.')
    return id
}
export function filterContent(items: ContentItem[], search: string, sort: 'newest' | 'title') {
    const terms = search.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
    return items.filter(item => terms.every(term => [item.id, item.title, item.creatorId || ''].join(' ').toLocaleLowerCase().includes(term)))
        .sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) : (Date.parse(b.updatedAt || b.createdAt || '') || 0) - (Date.parse(a.updatedAt || a.createdAt || '') || 0))
}
