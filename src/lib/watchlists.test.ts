import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { AppSettings } from '../types'
const calls: Array<{ settings: AppSettings; url: string; init: RequestInit }> = []
let respond = () => Promise.resolve(Response.json({}))
mock.module('./api', () => ({ apiFetch: async (settings: AppSettings, url: string, init: RequestInit) => { calls.push({ settings, url, init }); return respond() } }))
const api = await import('./watchlists')
const settings = { siteBaseUrl: 'https://hanasand.com', apiBaseUrl: 'https://api.hanasand.com/api', userId: 'synthetic-user', authToken: 'synthetic', selectedOrganizationId: 'synthetic-org', impersonationToken: '' } as AppSettings
const org = settings.selectedOrganizationId!
const item = { id: 'synthetic-item', organizationId: org, kind: 'company' as const, value: 'Synthetic Company', notes: 'Synthetic context', status: 'active' as const, updatedAt: '' }
const receipt = (status = 'synchronized') => ({ schemaVersion: 'organization.watchlist_projection_receipt.v1', organizationId: org, itemIds: [item.id], projection: { status, source: 'identity', checkedAt: status === 'synchronized' ? '2026-10-23T01:00:00Z' : null, watchlistIds: [`org_shared_watchlist:${org}:${item.id}`], unresolvedItemIds: [] }, alertRebuild: { status: 'not_requested', reason: 'projection_only' } })
const payload = () => ({ organization: { id: org, name: 'Synthetic organization', lifecycleStatus: 'active' }, watchlistItems: [item], sharedWatchlistContract: { organizationId: org, capabilities: { authoritativeProjectionSync: true, projectionReconcile: true, projectionReceiptSchemaVersion: 'organization.watchlist_projection_receipt.v1' }, permissions: { canWrite: true, canArchive: true, canCleanup: true, canReconcile: true } } })
const page = () => api.normalizeWatchlistPage(payload(), org)
const draft = { kind: 'domain' as const, value: 'https://www.Example.test/path', notes: ' Synthetic ' }
beforeEach(() => { calls.length = 0; respond = () => Promise.resolve(Response.json(payload())) })

describe('native canonical organization watchlists', () => {
    it('loads archived and active terms from Core using the signed selected organization', async () => {
        const result = await api.loadWatchlists(settings, new AbortController().signal)
        expect(result.items).toEqual([item])
        expect(calls[0].url).toBe(`https://hanasand.com/api/organizations/${org}/watchlists?includeArchived=true`)
        expect(calls[0].settings.selectedOrganizationId).toBe(org)
        expect(calls[0].init.credentials).toBe('omit')
    })
    it('fails closed for missing/false/unknown projection capability and cross-organization responses', () => {
        for (const capabilities of [{}, { authoritativeProjectionSync: false }, { authoritativeProjectionSync: true, projectionReconcile: true, projectionReceiptSchemaVersion: 'future' }]) {
            const body = payload(); body.sharedWatchlistContract.capabilities = capabilities as typeof body.sharedWatchlistContract.capabilities
            const result = api.normalizeWatchlistPage(body, org)
            expect(result.items.length).toBe(1)
            expect(api.mayChangeWatchlists(settings, result, 'create')).toBe(false)
        }
        expect(() => api.normalizeWatchlistPage({ ...payload(), watchlistItems: [{ ...item, organizationId: 'other-org' }] }, org)).toThrow('invalid')
        expect(() => api.normalizeWatchlistPage(payload(), 'other-org')).toThrow('invalid')
    })
    it('uses server permission booleans, lifecycle and own account without inferring grants from roles', () => {
        expect(api.mayChangeWatchlists(settings, page(), 'create')).toBe(true)
        expect(api.mayChangeWatchlists(settings, { ...page(), canWrite: false }, 'create')).toBe(false)
        expect(api.mayChangeWatchlists({ ...settings, impersonationToken: 'synthetic' }, page(), 'create')).toBe(false)
        expect(api.mayChangeWatchlists(settings, { ...page(), lifecycle: 'archived' }, 'create')).toBe(false)
        expect(api.mayChangeWatchlists(settings, { ...page(), lifecycle: 'archived' }, 'archive')).toBe(true)
        expect(api.mayChangeWatchlists(settings, { ...page(), lifecycle: 'deleted' }, 'cleanup')).toBe(false)
    })
    it('normalizes canonical kinds and searches without changing source or scope', () => {
        expect(api.validateWatchlistDraft(draft)).toEqual({ kind: 'domain', value: 'example.test', notes: 'Synthetic' })
        expect(api.validateWatchlistDraft({ ...draft, kind: 'keyword', value: '  Synthetic Term  ' }).value).toBe('synthetic term')
        expect(() => api.validateWatchlistDraft({ ...draft, value: '' })).toThrow('1–240')
        expect(() => api.validateWatchlistDraft({ ...draft, notes: 'x'.repeat(2001) })).toThrow('2000')
        expect(api.filterWatchlists([item], 'synthetic context', 'active')).toEqual([item])
        expect(api.filterWatchlists([item], '', 'archived')).toEqual([])
    })
    it('creates/edits on canonical Core routes and preserves requestId without a scanner or mirror call', async () => {
        respond = () => Promise.resolve(Response.json({ saved: true, watchlistItem: item, dwmAlertBridge: receipt() }, { status: 201 }))
        const saved = await api.changeWatchlists(settings, page(), { type: 'create', draft }, 'synthetic-request')
        expect(saved.items).toEqual([item]); expect(saved.warning).toBe('')
        expect(calls).toHaveLength(1)
        expect(calls[0].init.method).toBe('POST')
        expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ requestId: 'synthetic-request', kind: 'domain', value: 'example.test' })
        await api.changeWatchlists(settings, page(), { type: 'edit', itemId: item.id, draft }, 'edit-request')
        expect(calls[1].url).toEndWith(`/watchlists/${item.id}`); expect(calls[1].init.method).toBe('PUT')
    })
    it('uses lifecycle actions, archive DELETE and <=50 exact-scope cleanup IDs', async () => {
        respond = () => Promise.resolve(Response.json({ saved: true, watchlistItem: item, dwmAlertBridge: receipt() }))
        for (const [type, status] of [['pause', 'active'], ['resume', 'paused'], ['restore', 'archived']] as const) {
            await api.changeWatchlists(settings, { ...page(), items: [{ ...item, status }] }, { type, itemId: item.id }, 'synthetic')
            expect(calls.at(-1)!.url).toEndWith(`/watchlists/${item.id}/actions`)
            expect(JSON.parse(calls.at(-1)!.init.body as string).action).toBe(type)
        }
        await api.changeWatchlists(settings, page(), { type: 'archive', itemId: item.id }, 'synthetic')
        expect(calls.at(-1)!.init.method).toBe('DELETE')
        respond = () => Promise.resolve(Response.json({ saved: true, archivedItems: [{ ...item, status: 'archived' }], dwmAlertBridge: receipt() }))
        await api.changeWatchlists(settings, page(), { type: 'cleanup', itemIds: [item.id] }, 'synthetic')
        expect(calls.at(-1)!.url).toEndWith('/watchlists/cleanup')
        for (const itemIds of [[], [item.id, item.id], ['other-org-item'], Array.from({ length: 51 }, (_, i) => `id-${i}`)]) await expect(api.changeWatchlists(settings, page(), { type: 'cleanup', itemIds }, 'synthetic')).rejects.toThrow()
    })
    it('retains saved items for pending, failed and malformed projection receipts without inventing rebuild counts', () => {
        for (const bridge of [receipt('pending'), receipt('failed'), {}, { savedAlertCount: 0, alertIds: [] }]) {
            const result = api.watchlistMutationResult({ saved: true, watchlistItem: item, dwmAlertBridge: bridge }, org)
            expect(result.saved).toBe(true); expect(result.items).toEqual([item]); expect(result.warning).toContain('Saved.')
            expect(JSON.stringify(result)).not.toMatch(/savedAlertCount|alertIds|completed|no.match/)
        }
        const wrongScope = { ...receipt(), organizationId: 'other-org' }
        expect(api.watchlistMutationResult({ saved: true, watchlistItem: item, dwmAlertBridge: wrongScope }, org).warning).toBeTruthy()
        const unrelatedProjection = { ...receipt(), projection: { ...receipt().projection, watchlistIds: ['another-org-copy'] } }
        expect(api.watchlistMutationResult({ saved: true, watchlistItem: item, dwmAlertBridge: unrelatedProjection }, org).warning).toBeTruthy()
        const unexpected = api.watchlistMutationResult({ saved: true, watchlistItem: { ...item, id: 'unexpected' }, dwmAlertBridge: receipt() }, org, false, [item.id])
        expect(unexpected.requiresRefresh).toBe(true); expect(unexpected.items).toEqual([])
    })
    it('treats empty cleanup as no-change without claiming authoritative completion', () => {
        const bridge = { ...receipt(), itemIds: [], projection: { status: 'unchanged', checkedAt: null, reason: 'no_changed_items' } }
        const result = api.watchlistMutationResult({ saved: true, archivedItems: [], dwmAlertBridge: bridge }, org, true)
        expect(result.message).toStartWith('No items changed.')
        expect(result.warning).toBe('')
    })
    it('locks unknown mutation outcomes for refresh and never retries requests', async () => {
        respond = () => Promise.reject(new Error('synthetic network failure'))
        try { await api.changeWatchlists(settings, page(), { type: 'create', draft }, 'synthetic'); throw new Error('must fail') } catch (error) { expect(error).toBeInstanceOf(api.WatchlistRequestError); expect((error as InstanceType<typeof api.WatchlistRequestError>).outcomeUnknown).toBe(true) }
        expect(calls).toHaveLength(1)
        expect(() => api.watchlistMutationResult({}, org)).toThrow('Refresh')
        expect(api.watchlistMutationResult({ saved: true }, org).requiresRefresh).toBe(true)
    })
    it('hides internal server configuration errors and preserves uncertain mutation outcomes', async () => {
        respond = () => Promise.resolve(Response.json({ error: { message: 'Invalid configured Watchlist proof origin.' } }, { status: 500 }))
        await expect(api.loadWatchlists(settings, new AbortController().signal)).rejects.toThrow('Watchlists are temporarily unavailable.')
        try { await api.changeWatchlists(settings, page(), { type: 'create', draft }, 'synthetic'); throw new Error('must fail') } catch (error) {
            expect(error).toBeInstanceOf(api.WatchlistRequestError)
            expect((error as InstanceType<typeof api.WatchlistRequestError>).outcomeUnknown).toBe(true)
            expect((error as Error).message).not.toContain('Invalid configured')
        }
    })
    it('rejects invalid identifiers and stale-state actions before sending a mutation', async () => {
        await expect(api.loadWatchlists({ ...settings, selectedOrganizationId: 'bad/organization' }, new AbortController().signal)).rejects.toThrow('valid')
        await expect(api.changeWatchlists(settings, page(), { type: 'resume', itemId: item.id }, 'synthetic')).rejects.toThrow('state')
        await expect(api.changeWatchlists(settings, { ...page(), projectionSupported: false }, { type: 'create', draft }, 'synthetic')).rejects.toThrow('unavailable')
        expect(calls).toHaveLength(0)
    })
    it('syncs monitoring with a separate explicit command without repeating the source save', async () => {
        respond = () => Promise.resolve(Response.json({ organizationId: org, itemIds: [item.id], dwmAlertBridge: receipt() }))
        const result = await api.syncWatchlists(settings, page(), [item.id], 'sync-request')
        expect(result).toEqual({ message: 'Monitoring synced.', warning: '' })
        expect(calls).toHaveLength(1)
        expect(calls[0].url).toEndWith('/watchlists/reconcile')
        expect(calls[0].init.method).toBe('POST')
        expect(JSON.parse(calls[0].init.body as string)).toEqual({ itemIds: [item.id], requestId: 'sync-request', reason: 'Monitoring sync requested from the native workspace.' })
        expect(JSON.stringify(result)).not.toMatch(/saved|rebuild|alertIds/i)
    })
    it('allows retry for archived terms within an active organization without restoring them', async () => {
        respond = () => Promise.resolve(Response.json({ organizationId: org, itemIds: [item.id], dwmAlertBridge: receipt('pending') }))
        const result = await api.syncWatchlists(settings, { ...page(), items: [{ ...item, status: 'archived' }] }, [item.id], 'sync-request')
        expect(result.message).toBe('Monitoring sync did not complete.')
        expect(result.warning).toContain('will not be changed')
        expect(calls).toHaveLength(1)
        expect(calls[0].url).toEndWith('/reconcile')
    })
    it('requires retry capability, permission, lifecycle and exact scoped selectors before sending', async () => {
        const missingRetry = payload(); delete (missingRetry.sharedWatchlistContract.capabilities as Partial<typeof missingRetry.sharedWatchlistContract.capabilities>).projectionReconcile
        expect(api.mayChangeWatchlists(settings, api.normalizeWatchlistPage(missingRetry, org), 'create')).toBe(false)
        for (const value of [{ ...page(), canReconcile: false }, { ...page(), lifecycle: 'archived' }, { ...page(), projectionSupported: false }]) await expect(api.syncWatchlists(settings, value, [item.id], 'sync')).rejects.toThrow('unavailable')
        await expect(api.syncWatchlists({ ...settings, impersonationToken: 'synthetic' }, page(), [item.id], 'sync')).rejects.toThrow('unavailable')
        for (const ids of [[], [item.id, item.id], ['foreign'], Array.from({ length: 51 }, (_, index) => `item-${index}`)]) await expect(api.syncWatchlists(settings, page(), ids, 'sync')).rejects.toThrow()
        expect(calls).toHaveLength(0)
    })
    it('does not accept foreign or malformed sync receipts and never retries a failed command automatically', async () => {
        expect(() => api.watchlistSyncResult({ organizationId: 'foreign', itemIds: [item.id] }, org, [item.id])).toThrow('confirmed')
        expect(api.watchlistSyncResult({ organizationId: org, itemIds: [item.id], dwmAlertBridge: {} }, org, [item.id]).warning).toBeTruthy()
        respond = () => Promise.reject(new Error('synthetic transport failure'))
        await expect(api.syncWatchlists(settings, page(), [item.id], 'sync')).rejects.toThrow('could not be reached')
        expect(calls).toHaveLength(1)
    })
})
