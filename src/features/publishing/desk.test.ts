import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import type { AppSettings } from '../../types'
import type { PublishingApi } from './api'
import { accountScope, PublishingError, type ContentItem, type SavedReceipt } from './contracts'
import { PublishingDesk } from './desk'
import { pendingPublication, publicationKey } from './intents'

const digest = async (text: string) => createHash('sha256').update(text).digest('hex')
let counter = 0
function fixture() {
    const settings = { apiBaseUrl: 'https://publishing.invalid/api', userId: `synthetic-${++counter}`, authToken: 'token', selectedOrganizationId: 'org', impersonationToken: '', impersonatingUserId: '' } as AppSettings
    const item: ContentItem = { kind: 'articles', id: 'example.md', title: 'Example', organizationId: 'org', body: '# Original' }
    let posts = 0, detail = item
    const api: PublishingApi = {
        access: async () => ({ scope: accountScope(settings), organizationId: 'org', name: 'Synthetic Org', canRead: true, canWrite: true }),
        list: async () => [detail], detail: async () => detail, findThought: async () => [],
        mutate: async () => { posts++; return { action: 'update', id: 'example.md' } },
    }
    const desk = new PublishingDesk(settings, 'articles', api, digest)
    return { desk, settings, item, api, posts: () => posts, setDetail: (item: ContentItem) => { detail = item } }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
async function open(f: ReturnType<typeof fixture>) { f.desk.activate(); await tick(); await f.desk.select(f.item.id, f.desk.state.host) }

test('editing preserves native input identity; operation boundaries remove old target and reject captured confirmation', async () => {
    const f = fixture(); await open(f)
    const host = f.desk.state.host
    f.desk.edit(host, { body: '# Changed' })
    expect(f.desk.state.host).toBe(host)
    const review = f.desk.review('update', host)!
    await f.desk.refresh(true, host)
    await f.desk.confirm(review)
    expect(f.posts()).toBe(0)
    expect(f.desk.state.draft.body).toBe('# Changed')
    const targets = new Map([[`body:${host}`, () => f.desk.edit(f.desk.state.host, { body: '# Stale native target' })]])
    // Fabric finds current props only for retained hosts. Refresh renewed the keyed host.
    if (`body:${host}` !== `body:${f.desk.state.host}`) targets.delete(`body:${host}`)
    targets.get(`body:${host}`)?.()
    expect(f.desk.state.draft.body).toBe('# Changed')
})
test('pending write blocks queued input and owns the actual saved receipt', async () => {
    const f = fixture(); await open(f)
    const receipt = deferred<SavedReceipt>()
    f.api.mutate = async () => receipt.promise
    const host = f.desk.state.host
    f.desk.edit(host, { body: '# Submitted' })
    const sending = f.desk.confirm(f.desk.review('update', host)!)
    await tick()
    f.desk.edit(host, { body: '# Queued' })
    expect(f.desk.state.draft.body).toBe('# Submitted')
    receipt.resolve({ action: 'update', id: f.item.id })
    await sending
    expect(f.desk.state.receipt?.id).toBe(f.item.id)
    expect(f.desk.state.unknown).toBeUndefined()
    expect(pendingPublication(publicationKey(f.settings, 'articles'))).toBeUndefined()
})
test('unknown write survives new controller/token refresh and A→B→A; auto read never reconciles it', async () => {
    const f = fixture(); await open(f)
    f.api.mutate = async () => { throw new PublishingError('Saved then connection lost', 500, true) }
    f.desk.edit(f.desk.state.host, { body: '# Maybe saved' })
    await f.desk.confirm(f.desk.review('update', f.desk.state.host)!)
    expect(f.desk.state.unknown?.reviewed).toBe(false)
    f.desk.dispose()
    const nextSettings = { ...f.settings, authToken: 'new-token' }
    const nextApi = { ...f.api, access: async () => ({ scope: accountScope(nextSettings), organizationId: 'org', name: 'Synthetic', canRead: true, canWrite: true }) }
    const other = new PublishingDesk({ ...nextSettings, selectedOrganizationId: 'other' }, 'articles', nextApi, digest)
    expect(other.state.unknown).toBeUndefined()
    const next = new PublishingDesk(nextSettings, 'articles', nextApi, digest)
    next.activate(); await tick()
    expect(next.state.unknown?.intent.id).toBe(f.item.id)
    expect(next.state.unknown?.reviewed).toBe(false)
    expect(next.canEdit(next.state.host)).toBe(false)
    await next.refresh(true, next.state.host)
    expect(next.state.unknown?.reviewed).toBe(true)
    expect(next.state.unknown?.matches[0].body).toBe('# Original')
    next.acknowledge(next.state.host)
    expect(next.state.receipt).toBeUndefined()
    expect(next.state.unknown).toBeUndefined()
})
test('manual read started before unknown mutation cannot later unlock it; failed read cannot mark reviewed', async () => {
    const f = fixture(); await open(f)
    f.api.mutate = async () => { throw new PublishingError('Unknown', 500, true) }
    f.desk.edit(f.desk.state.host, { body: '# Uncertain' })
    await f.desk.confirm(f.desk.review('update', f.desk.state.host)!)
    f.api.list = async () => { throw new PublishingError('Unavailable', 503) }
    await f.desk.refresh(true, f.desk.state.host)
    f.desk.acknowledge(f.desk.state.host)
    expect(f.desk.state.unknown?.reviewed).toBe(false)
    expect(f.desk.canEdit(f.desk.state.host)).toBe(false)
})
test('blur before confirmed request receipt leaves intent; late receipt does not mutate replacement scope', async () => {
    const f = fixture(); await open(f)
    const receipt = deferred<SavedReceipt>(); f.api.mutate = async () => receipt.promise
    f.desk.edit(f.desk.state.host, { body: '# Submitted' })
    const sending = f.desk.confirm(f.desk.review('update', f.desk.state.host)!)
    await tick(); f.desk.hide()
    receipt.resolve({ action: 'update', id: f.item.id }); await sending
    expect(pendingPublication(publicationKey(f.settings, 'articles'))?.action).toBe('update')
    expect(f.desk.state.receipt).toBeUndefined()
    expect(f.desk.state.visible).toBe(false)
})
test('read outage revokes authority; old confirmation and inputs cannot write', async () => {
    const f = fixture(); await open(f)
    f.desk.edit(f.desk.state.host, { body: '# Changed' })
    const review = f.desk.review('update', f.desk.state.host)!
    f.api.access = async () => { throw new PublishingError('Denied', 403) }
    await f.desk.refresh(true, f.desk.state.host)
    await f.desk.confirm(review)
    expect(f.posts()).toBe(0)
    expect(f.desk.canEdit(f.desk.state.host)).toBe(false)
})
test('a draft blocks accidental selection or new editor; explicit discard renews hosts', async () => {
    const f = fixture(); await open(f)
    f.desk.edit(f.desk.state.host, { body: '# Draft' })
    const host = f.desk.state.host
    expect(f.desk.startCreate(host)).toBe(false)
    await f.desk.select('other.md', host)
    expect(f.desk.state.draft.body).toBe('# Draft')
    f.desk.discard(host)
    expect(f.desk.state.host).toBeGreaterThan(host)
    expect(f.desk.startCreate(f.desk.state.host)).toBe(true)
})
test('late old account permission response never publishes or attaches after hiding', async () => {
    const f = fixture()
    const access = deferred<Awaited<ReturnType<PublishingApi['access']>>>()
    f.api.access = async () => access.promise
    f.desk.activate(); f.desk.hide()
    access.resolve({ scope: accountScope(f.settings), organizationId: 'org', name: 'Old scope', canRead: true, canWrite: true })
    await tick()
    expect(f.desk.state.access).toBeUndefined()
    expect(f.desk.state.pending).toBeNull()
})
