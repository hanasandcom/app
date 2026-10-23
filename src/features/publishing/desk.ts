import type { PublishingApi } from './api'
import { forgetPublication, nativeDigest, pendingPublication, publicationKey, rememberPublication, type PendingPublication, type PublishingDigest } from './intents'
import type { AppSettings } from '../../types'
import { accountScope, contentOrganization, articleId, assertItemScope, PublishingError, requireWriter, validateMutation, type ContentItem, type ContentKind, type Mutation, type PublishingAccess, type PublishingDraft, type SavedReceipt } from './contracts'

export type UncertainSave = { intent: PendingPublication; mutation?: Mutation; reviewed: boolean; matches: ContentItem[]; missing: boolean }
export type PublishingSnapshot = {
    items: ContentItem[]; access?: PublishingAccess; selected?: ContentItem; mode: 'list' | 'create' | 'detail'
    draft: PublishingDraft; pending: 'read' | 'write' | null; unknown?: UncertainSave
    loaded: boolean; fresh: boolean; error: string; notice: string; host: number; visible: boolean; latest?: ContentItem; lookup: ContentItem[] | null; receipt?: SavedReceipt
}
export type Review = { host: number; mutation: Mutation }

/** Memory-only desk; one owner for confirmation, native-target and read/write epochs. */
export class PublishingDesk {
    state: PublishingSnapshot = { items: [], mode: 'list', draft: { id: '', body: '' }, pending: null, loaded: false, fresh: false, error: '', notice: '', host: 0, visible: false, lookup: null }
    private listeners = new Set<() => void>()
    private controller?: AbortController
    private operation = 0
    private disposed = false
    readonly scope: string
    readonly intentKey: string
    constructor(readonly settings: AppSettings, readonly kind: ContentKind, readonly api: PublishingApi, private digest: PublishingDigest = nativeDigest) {
        this.scope = accountScope(settings)
        this.intentKey = publicationKey(settings, kind)
        const intent = pendingPublication(this.intentKey)
        if (intent) this.state.unknown = { intent, reviewed: false, matches: [], missing: false }
    }
    subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
    private publish() { for (const listener of this.listeners) listener() }
    private renew() { this.state.host++ }
    canRead(host: number) { return !this.disposed && this.state.visible && host === this.state.host && !this.state.pending }
    canEdit(host: number) { return this.canRead(host) && !this.state.unknown && !pendingPublication(this.intentKey) && this.state.access?.canWrite === true }
    activate() { if (this.disposed) return; this.state.visible = true; this.renew(); this.publish(); void this.refresh(false, this.state.host) }
    hide() {
        this.state.visible = false
        this.controller?.abort(); this.operation++; this.renew()
        this.state.pending = null; this.state.access = undefined; this.state.fresh = false
        if (this.state.unknown) this.state.unknown = { ...this.state.unknown, reviewed: false, matches: [], missing: false }
        this.publish()
    }
    dispose() { this.hide(); this.disposed = true; this.listeners.clear(); this.state = { ...this.state, items: [], selected: undefined, draft: { id: '', body: '' }, lookup: null, unknown: undefined, receipt: undefined } }
    private begin(pending: 'read' | 'write') {
        this.controller?.abort()
        const controller = new AbortController()
        this.controller = controller
        const operation = ++this.operation
        this.state.pending = pending; this.state.error = ''; if (pending === 'read') this.state.fresh = false; this.renew(); this.publish()
        return { controller, operation }
    }
    private current(operation: number) { return !this.disposed && this.state.visible && this.operation === operation }
    private failed(error: unknown) {
        this.state.error = error instanceof Error ? error.message : 'The publishing request failed.'
        this.state.access = undefined
    }
    async refresh(manual: boolean, host: number) {
        if (!this.canRead(host)) return
        const remembered = pendingPublication(this.intentKey)
        if (remembered && !this.state.unknown) this.state.unknown = { intent: remembered, reviewed: false, matches: [], missing: false }
        const unknown = this.state.unknown
        const selected = this.state.selected
        const { controller, operation } = this.begin('read')
        try {
            const access = await this.api.access(controller.signal)
            if (!access.canRead) throw new PublishingError('This account cannot open the selected editorial workspace.', 403)
            const items = await this.api.list(controller.signal)
            let detail: ContentItem | undefined
            if (selected && !unknown) {
                try { detail = await this.api.detail(selected.id, controller.signal) }
                catch (error) { if (!(error instanceof PublishingError && error.status === 404)) throw error }
            }
            let matches: ContentItem[] = [], missing = false
            if (manual && unknown && !this.settings.impersonationToken && !this.settings.impersonatingUserId) {
                const intent = unknown.intent
                if (this.kind === 'thoughts' && intent.action === 'create') {
                    for (const item of items) {
                        if (item.creatorId === intent.creatorId && item.body?.length === intent.length && await this.digest(item.body) === intent.digest) matches.push(item)
                    }
                } else {
                    const id = intent.id!
                    try { matches = [await this.api.detail(id, controller.signal)] }
                    catch (error) { if (error instanceof PublishingError && error.status === 404) missing = true; else throw error }
                }
            }
            if (!this.current(operation)) return
            this.state.access = access; this.state.items = items; this.state.loaded = true; this.state.fresh = true
            // An unsaved editor is never replaced by a refresh response.
            if (detail && selected && this.state.draft.body !== selected.body) this.state.latest = detail.body !== selected.body ? detail : undefined
            if (detail && selected && this.state.draft.body === selected.body) {
                this.state.selected = detail; this.state.draft = { id: detail.id, body: detail.body || '' }; this.state.latest = undefined
            }
            if (manual && unknown && !this.settings.impersonationToken && !this.settings.impersonatingUserId && this.state.unknown === unknown) this.state.unknown = { ...unknown, reviewed: true, matches, missing }
            this.state.notice = manual && unknown ? 'Current service data loaded. A matching record does not prove which request saved it. Review before continuing.' : this.state.notice
        } catch (error) { if (this.current(operation)) this.failed(error) }
        finally { if (this.current(operation)) { this.state.pending = null; this.renew(); this.publish() } }
    }
    edit(host: number, patch: Partial<PublishingDraft>) {
        if (!this.canEdit(host)) return
        this.state.draft = { ...this.state.draft, ...patch }; this.state.lookup = null; this.publish()
    }
    startCreate(host: number) {
        if (!this.canEdit(host) || this.hasDraftChanges()) return false
        this.state.mode = 'create'; this.state.selected = undefined; this.state.draft = { id: '', body: '' }
        this.state.error = ''; this.state.notice = ''; this.state.lookup = null; this.state.latest = undefined; this.renew(); this.publish(); return true
    }
    hasDraftChanges() {
        return this.state.mode === 'create' ? !!(this.state.draft.body || this.state.draft.id) : this.state.mode === 'detail' && this.state.draft.body !== (this.state.selected?.body || '')
    }
    discard(host: number, expected = this.state.draft) {
        if (!this.canRead(host) || this.state.unknown || expected.id !== this.state.draft.id || expected.body !== this.state.draft.body) return
        this.state.mode = 'list'; this.state.selected = undefined; this.state.draft = { id: '', body: '' }; this.state.lookup = null; this.state.latest = undefined
        this.renew(); this.publish()
    }
    async select(id: string, host: number) {
        if (!this.canRead(host) || this.state.unknown || this.hasDraftChanges()) return
        const { controller, operation } = this.begin('read')
        try {
            const item = assertItemScope(await this.api.detail(id, controller.signal), contentOrganization(this.settings))
            if (!this.current(operation)) return
            this.state.selected = item; this.state.mode = 'detail'; this.state.draft = { id: item.id, body: item.body || '' }; this.state.lookup = null; this.state.latest = undefined
        } catch (error) { if (this.current(operation)) this.failed(error) }
        finally { if (this.current(operation)) { this.state.pending = null; this.renew(); this.publish() } }
    }
    async lookup(host: number) {
        if (!this.canRead(host) || this.state.unknown || !this.state.draft.body.trim()) return
        const body = this.state.draft.body
        const { controller, operation } = this.begin('read')
        try {
            const matches = this.kind === 'thoughts' ? await this.api.findThought(body, controller.signal) : await this.api.detail(articleId(this.state.draft.id.trim()), controller.signal).then(item => [item]).catch(error => { if (error instanceof PublishingError && error.status === 404) return []; throw error })
            if (this.current(operation) && this.state.draft.body === body) this.state.lookup = matches
        } catch (error) { if (this.current(operation)) this.failed(error) }
        finally { if (this.current(operation)) { this.state.pending = null; this.renew(); this.publish() } }
    }
    review(action: Mutation['action'], host: number): Review | null {
        if (!this.canEdit(host) || !this.state.access) return null
        try {
            requireWriter(this.settings, this.state.access, action === 'create' ? undefined : this.state.selected)
            const mutation: Mutation = { action, draft: { ...this.state.draft }, original: action === 'create' ? undefined : this.state.selected }
            validateMutation(this.kind, mutation)
            return { host, mutation }
        } catch (error) { this.state.error = (error as Error).message; this.publish(); return null }
    }
    async confirm(review: Review) {
        if (!this.canEdit(review.host) || !this.state.access || review.mutation.draft.body !== this.state.draft.body || review.mutation.draft.id !== this.state.draft.id) return
        const { controller, operation } = this.begin('write')
        let intent: PendingPublication | undefined
        let accepted = false
        try {
            const digest = await this.digest(review.mutation.draft.body)
            if (!this.current(operation)) return
            const id = this.kind === 'articles' ? articleId(review.mutation.original?.id || review.mutation.draft.id.trim()) : review.mutation.original?.id || null
            intent = rememberPublication(this.intentKey, review.mutation, digest, this.settings.userId, id)
            // The barrier is registered before HTTP dispatch and survives a replaced controller.
            this.state.unknown = { intent, mutation: review.mutation, reviewed: false, matches: [], missing: false }
            this.publish()
            const receipt = await this.api.mutate(this.state.access, review.mutation, controller.signal)
            if (!this.current(operation)) return
            forgetPublication(intent)
            this.state.unknown = undefined; this.state.receipt = receipt; accepted = true
            this.state.notice = receipt.action === 'delete' ? `Deleted ${receipt.id}.` : `Saved ${receipt.id}. Changes are immediately persistent; no draft or publication stage is provided.`
            this.state.mode = 'list'; this.state.selected = undefined; this.state.draft = { id: '', body: '' }; this.state.lookup = null; this.state.latest = undefined
            this.state.items = this.state.items.filter(item => item.id !== receipt.id)
            if (receipt.item) this.state.items.unshift(receipt.item)
            // A successful receipt is retained even if subsequent refresh fails. Never retry the write.
        } catch (error) {
            if (!this.current(operation)) return
            if (!intent || error instanceof PublishingError && !error.uncertain) { if (intent) forgetPublication(intent); this.state.unknown = undefined }
            this.failed(error)
        } finally { if (this.current(operation)) { this.state.pending = null; this.renew(); this.publish() } }
        if (accepted && this.current(operation)) void this.refresh(false, this.state.host)
    }
    useLatest(host: number, expected = this.state.draft, latest = this.state.latest) {
        if (!this.canEdit(host) || !this.state.latest || latest !== this.state.latest || expected.id !== this.state.draft.id || expected.body !== this.state.draft.body) return
        this.state.selected = this.state.latest; this.state.draft = { id: this.state.latest.id, body: this.state.latest.body || '' }; this.state.latest = undefined
        this.renew(); this.publish()
    }
    acknowledge(host: number) {
        if (!this.canRead(host) || !this.state.unknown?.reviewed || !this.state.access?.canRead || this.settings.impersonationToken || this.settings.impersonatingUserId) return
        forgetPublication(this.state.unknown.intent)
        this.state.unknown = undefined; this.state.notice = 'Review acknowledged. No save receipt has been inferred. Your draft remains available.'
        this.renew(); this.publish()
    }
}
