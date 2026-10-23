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
test('failed manual read cannot mark an uncertain operation reviewed or unlock editing', async () => {
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

test('unknown Thought create retains digest only across remount; manual scoped read cannot manufacture receipt', async () => {
    const f = fixture()
    const item: ContentItem = { kind: 'thoughts', id: '24', title: '# Retained thought', body: '# Retained thought', organizationId: 'org', creatorId: f.settings.userId }
    let posts = 0
    f.api.list = async () => [item]
    f.api.mutate = async () => { posts++; throw new PublishingError('Lost response', 500, true) }
    const desk = new PublishingDesk(f.settings, 'thoughts', f.api, digest)
    desk.activate(); await tick(); desk.startCreate(desk.state.host); desk.edit(desk.state.host, { body: item.body! })
    await desk.confirm(desk.review('create', desk.state.host)!)
    const key = publicationKey(f.settings, 'thoughts')
    const remembered = pendingPublication(key)!
    expect(remembered.id).toBeNull()
    expect(JSON.stringify(remembered)).not.toContain(item.body!)
    expect(JSON.stringify(remembered)).not.toContain(f.settings.authToken)
    desk.dispose()
    const next = new PublishingDesk(f.settings, 'thoughts', f.api, digest)
    next.activate(); await tick()
    expect(next.state.unknown?.reviewed).toBe(false)
    await next.refresh(true, next.state.host)
    expect(next.state.unknown?.matches.map(row => row.id)).toEqual(['24'])
    expect(next.state.receipt).toBeUndefined()
    expect(posts).toBe(1)
    next.acknowledge(next.state.host)
})

test('unknown delete retains original identity; a manual not-found read is review evidence, never a delete receipt', async () => {
    const f = fixture(); await open(f)
    f.api.mutate = async () => { throw new PublishingError('Lost deletion response', 500, true) }
    await f.desk.confirm(f.desk.review('delete', f.desk.state.host)!)
    f.api.list = async () => []
    f.api.detail = async () => { throw new PublishingError('Absent', 404) }
    await f.desk.refresh(true, f.desk.state.host)
    expect(f.desk.state.unknown?.missing).toBe(true)
    expect(f.desk.state.unknown?.intent.id).toBe(f.item.id)
    expect(f.desk.state.receipt).toBeUndefined()
    f.desk.acknowledge(f.desk.state.host)
})

test('known collision retains draft and explicit refresh restores authority without resending create', async () => {
    const f = fixture(); f.desk.activate(); await tick()
    f.desk.startCreate(f.desk.state.host); f.desk.edit(f.desk.state.host, { id: 'example', body: '# Duplicate' })
    let posts = 0
    f.api.mutate = async () => { posts++; throw new PublishingError('Collision', 409, false) }
    await f.desk.confirm(f.desk.review('create', f.desk.state.host)!)
    expect(f.desk.state.unknown).toBeUndefined()
    expect(f.desk.state.draft.body).toBe('# Duplicate')
    await f.desk.refresh(true, f.desk.state.host)
    expect(posts).toBe(1)
    expect(f.desk.state.draft.body).toBe('# Duplicate')
})

test('server changes are shown separately from local draft; replacing draft requires current target', async () => {
    const f = fixture(); await open(f)
    f.desk.edit(f.desk.state.host, { body: '# Local draft' })
    f.setDetail({ ...f.item, body: '# New remote' })
    const old = f.desk.state.host
    await f.desk.refresh(true, old)
    expect(f.desk.state.draft.body).toBe('# Local draft')
    expect(f.desk.state.latest?.body).toBe('# New remote')
    f.desk.useLatest(old)
    expect(f.desk.state.draft.body).toBe('# Local draft')
    f.desk.useLatest(f.desk.state.host)
    expect(f.desk.state.draft.body).toBe('# New remote')
})

test('UI source bindings replace the actual field/action hosts at controller boundaries', async () => {
    const field = await Bun.file(new URL('./ui.tsx', import.meta.url)).text()
    const editor = await Bun.file(new URL('./PublishingEditor.tsx', import.meta.url)).text()
    const screen = await Bun.file(new URL('./PublishingScreen.tsx', import.meta.url)).text()
    expect(field).toContain('key={`${label}:${host}`}')
    expect(editor).toContain('desk.edit(host, { body })')
    expect(editor).toContain('desk.confirm(reviewed)')
    expect(editor).toContain('key={`save-actions:${host}`}')
    expect(screen).toContain('key={`toolbar:${host}`}')
    expect(screen).toContain('key={`ack:${host}`}')
    expect(screen).toContain('desk.refresh(true, host)')
})

test('impersonated read/ack cannot inspect or clear the own-account uncertain intent', async () => {
    const f = fixture(); await open(f)
    f.api.mutate = async () => { throw new PublishingError('Lost write', 500, true) }
    f.desk.edit(f.desk.state.host, { body: '# Own uncertain text' })
    await f.desk.confirm(f.desk.review('update', f.desk.state.host)!)
    f.desk.hide()
    for (const changed of [{ ...f.settings, impersonationToken: 'imp' }, { ...f.settings, impersonatingUserId: 'target' }]) {
        const api = { ...f.api, access: async () => ({ scope: accountScope(changed), organizationId: 'org', name: 'Impersonation', canRead: true, canWrite: false }) }
        const impersonated = new PublishingDesk(changed, 'articles', api, digest)
        impersonated.activate(); await tick()
        await impersonated.refresh(true, impersonated.state.host)
        impersonated.acknowledge(impersonated.state.host)
        expect(impersonated.state.unknown).toBeUndefined()
        expect(pendingPublication(publicationKey(f.settings, 'articles'))?.action).toBe('update')
    }
    const ownAgain = new PublishingDesk(f.settings, 'articles', f.api, digest)
    ownAgain.activate(); await tick()
    expect(ownAgain.state.unknown?.reviewed).toBe(false)
    expect(ownAgain.canEdit(ownAgain.state.host)).toBe(false)
})

test('only successful snapshots establish count/empty; auth/list failures stay unknown and refresh failure labels cache', async () => {
    const { publicationSummary } = await import('./contracts')
    for (const endpoint of ['access', 'list'] as const) {
        const f = fixture()
        f.api[endpoint] = async () => { throw new PublishingError('Unavailable', endpoint === 'access' ? 401 : 503) }
        f.desk.activate(); await tick()
        const summary = publicationSummary(f.desk.state.items, f.desk.state.loaded, f.desk.state.fresh)
        expect(summary.count).toBeNull()
        expect(summary.words).toBeNull()
        expect(summary.empty).toBe(false)
    }
    const empty = fixture(); empty.api.list = async () => []
    empty.desk.activate(); await tick()
    expect(publicationSummary(empty.desk.state.items, empty.desk.state.loaded, empty.desk.state.fresh)).toMatchObject({ count: 0, words: 0, empty: true, cached: false })
    const cached = fixture(); cached.desk.activate(); await tick()
    cached.api.list = async () => { throw new PublishingError('Busy', 503) }
    await cached.desk.refresh(true, cached.desk.state.host)
    expect(publicationSummary(cached.desk.state.items, cached.desk.state.loaded, cached.desk.state.fresh)).toMatchObject({ count: 1, cached: true, empty: false })
    expect(cached.desk.state.items[0].id).toBe(cached.item.id)
})

test('draft discard and use-latest dialogs do not erase text entered after opening the review', async () => {
    const f = fixture(); await open(f)
    const host = f.desk.state.host
    f.desk.edit(host, { body: '# Draft A' })
    const capturedDraft = { ...f.desk.state.draft }
    f.desk.edit(host, { body: '# Draft B' })
    f.desk.discard(host, capturedDraft)
    expect(f.desk.state.draft.body).toBe('# Draft B')
    f.setDetail({ ...f.item, body: '# New server' })
    await f.desk.refresh(true, host)
    const latest = f.desk.state.latest, draft = { ...f.desk.state.draft }, latestHost = f.desk.state.host
    f.desk.edit(latestHost, { body: '# Draft C' })
    f.desk.useLatest(latestHost, draft, latest)
    expect(f.desk.state.draft.body).toBe('# Draft C')
})
