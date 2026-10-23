import { beforeEach, expect, mock, test } from 'bun:test'
import type { AppSettings } from '../types'
import { siteNavigation, type SiteNavigationItem } from '../data/site-navigation'
const calls: Array<{ url: URL; init: RequestInit; settings: AppSettings }> = []
let handle: (url: URL, init: RequestInit) => Response | Promise<Response>
mock.module('./api', () => ({ apiFetch: async (settings: AppSettings, input: string, init: RequestInit) => { const url = new URL(input); calls.push({ url, init, settings }); return handle(url, init) } }))
const { IntegrationError, loadIntegrations, integrationOrganization, integrationsScope, filterIntegrations, saveIntegration, removeIntegration, testIntegration, validateIntegrationDraft } = await import('./integrations')
const settings = { apiBaseUrl: 'https://api.synthetic.invalid/api', userId: 'synthetic-user', authToken: 'synthetic-session', selectedOrganizationId: 'synthetic-org', impersonationToken: '', impersonatingUserId: '' } as AppSettings
const id = 'synthetic-destination'
const destination = (scope = settings.selectedOrganizationId) => ({ id, orgId: scope, name: 'Alerts', kind: 'webhook', status: 'active', endpointHint: 'hooks.example/…', lastTestStatus: null })
const feed = (scope = settings.selectedOrganizationId, manage = true) => ({ destinations: [destination(scope)], destinationAdminProof: { access: { canManage: manage } }, destinationLifecycle: [{ destinationId: id, access: { canManage: manage, canUpdate: manage, canDisable: manage, canTest: manage } }], destinationTests: [{ destinationId: id, access: { canTest: manage }, blockers: [] }] })
const org = (change: Record<string, unknown> = {}) => ({ organization: { id: settings.selectedOrganizationId, lifecycleStatus: 'active', privacyDeletionInProgress: false, ...change } })
const draft = { name: 'New alerts', kind: 'webhook' as const, url: 'https://hooks.example/secret-token' }
beforeEach(() => { calls.length = 0; handle = url => Response.json(url.pathname.includes('/organizations/') ? org() : feed()) })
const page = () => loadIntegrations(settings)

test('Integrations and Delivery open separate native Tools jobs', () => {
    const leaves = (items: SiteNavigationItem[]): SiteNavigationItem[] => items.flatMap(item => item.items ? leaves(item.items) : [item])
    const items = leaves(siteNavigation('synthetic-user'))
    expect(items.find(item => item.path === '/findings/delivery')?.tab).toBe('Tools')
    expect(items.find(item => item.path === '/findings/delivery')?.disabledReason).toBeUndefined()
    expect(items.find(item => item.path === '/findings/actions')?.tab).toBe('Tools')
    expect(items.find(item => item.path === '/findings/actions')?.disabledReason).toBeUndefined()
})
test('loads selected Core organization and exact destination envelope with managed account transport', async () => {
    const result = await page()
    expect(result.scope).toBe('synthetic-org'); expect(result.canManage).toBe(true)
    expect(calls.map(call => call.url.pathname)).toEqual(['/api/dwm/webhook-destinations', '/api/organizations/synthetic-org'])
    expect(calls[0].url.searchParams.get('orgId')).toBe('synthetic-org')
    expect(calls[0].settings).toBe(settings); expect(calls[0].init.credentials).toBe('omit'); expect(calls[0].init.redirect).toBe('error')
    expect(new Headers(calls[0].init.headers).get('authorization')).toBe('Bearer synthetic-session')
    expect(result.items[0]).toMatchObject({ canEdit: true, canRemove: true, canTest: true })
})
test('Personal maps to actual user ID and never queries a fake personal organization', async () => {
    const personal = { ...settings, selectedOrganizationId: 'personal' }
    handle = () => Response.json(feed(settings.userId))
    expect((await loadIntegrations(personal)).scope).toBe(settings.userId); expect(calls).toHaveLength(1)
    expect(calls[0].url.searchParams.get('orgId')).toBe(settings.userId)
    expect(integrationOrganization({ ...settings, selectedOrganizationId: '' })).toBe(settings.userId)
})
test('new authoritative privacy flag wins over legacy metadata and unknown lifecycle never grants', async () => {
    for (const changed of [{ privacyDeletionInProgress: true }, { lifecycleStatus: 'archived' }, { lifecycleStatus: 'deleted' }]) {
        handle = url => Response.json(url.pathname.includes('/organizations/') ? org(changed) : feed())
        expect((await page()).canManage).toBe(false)
    }
    handle = url => Response.json(url.pathname.includes('/organizations/') ? org({ settings: { auditSafeMetadata: { privacyDeletionRunId: 'old-stale-marker' } } }) : feed())
    expect((await page()).canManage).toBe(true)
    handle = url => Response.json(url.pathname.includes('/organizations/') ? org({ privacyDeletionInProgress: 'false', settings: { auditSafeMetadata: {} } }) : feed())
    expect(await page()).toMatchObject({ lifecycleUnavailable: true, canManage: false })
    handle = url => Response.json(url.pathname.includes('/organizations/') ? org({ privacyDeletionInProgress: undefined }) : feed())
    expect(await page()).toMatchObject({ lifecycleUnavailable: true, canManage: false })
})
test('old metadata uses exact truthiness, is discarded, and missing/failed organization read disables writes', async () => {
    for (const marker of [null, false, '', 'synthetic-deletion', true]) {
        handle = url => Response.json(url.pathname.includes('/organizations/') ? org({ privacyDeletionInProgress: undefined, settings: { auditSafeMetadata: { privacyDeletionRunId: marker, privateOtherMetadata: 'not-returned' } } }) : feed())
        const result = await page(); expect(result.lifecycleBlocked).toBe(Boolean(marker))
        expect(JSON.stringify(result)).not.toContain('not-returned')
    }
    handle = url => url.pathname.includes('/organizations/') ? Response.json({ error: 'unavailable' }, { status: 503 }) : Response.json(feed())
    expect(await page()).toMatchObject({ lifecycleUnavailable: true, canManage: false })
})
test('server canManage and per-action flags/blockers are required, with both impersonation states read-only', async () => {
    handle = url => Response.json(url.pathname.includes('/organizations/') ? org() : feed(settings.selectedOrganizationId, false))
    expect((await page()).canManage).toBe(false)
    for (const change of [{ impersonationToken: 'synthetic-imp' }, { impersonatingUserId: 'another-user' }]) {
        handle = url => Response.json(url.pathname.includes('/organizations/') ? org() : feed())
        expect((await loadIntegrations({ ...settings, ...change })).canManage).toBe(false)
    }
    handle = url => {
        const body = feed(); body.destinationTests[0].blockers = [{ blocking: true, message: 'Blocked by server' }] as never[]
        return Response.json(url.pathname.includes('/organizations/') ? org() : body)
    }
    expect((await page()).items[0]).toMatchObject({ canEdit: true, canRemove: true, canTest: false, testBlockers: ['Blocked by server'] })
})
test('missing permission metadata and foreign destinations are never silently treated as safe', async () => {
    for (const body of [{ destinations: [] }, { ...feed(), destinations: [destination('foreign')] }]) {
        handle = url => Response.json(url.pathname.includes('/organizations/') ? org() : body)
        await expect(page()).rejects.toThrow()
    }
})
test('create uses orgId + active status; edit PUT omits blank URL/status/events/secret', async () => {
    const current = await page(); calls.length = 0
    handle = () => Response.json({ destination: destination() }, { status: 201 })
    await saveIntegration(settings, current, draft)
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ orgId: settings.selectedOrganizationId, name: draft.name, kind: 'webhook', endpointUrl: draft.url, status: 'active' })
    await saveIntegration(settings, current, { id, name: 'Rename', kind: 'webhook', url: ' ' })
    expect(calls[1].init.method).toBe('PUT')
    expect(calls[1].url.pathname).toBe(`/api/dwm/webhook-destinations/${id}`)
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ orgId: settings.selectedOrganizationId, name: 'Rename', kind: 'webhook' })
})
test('draft validates HTTPS, userinfo, Discord host/path, length and blank-edit preservation without echoing URL', () => {
    validateIntegrationDraft({ id, name: 'Keep', kind: 'webhook', url: '' })
    for (const url of ['http://hooks.example/secret', 'https://user:secret@hooks.example/a', 'https://hooks.example/a#secret']) expect(() => validateIntegrationDraft({ ...draft, url })).toThrow('HTTPS')
    expect(() => validateIntegrationDraft({ ...draft, kind: 'discord' })).toThrow('Discord')
    validateIntegrationDraft({ ...draft, kind: 'discord', url: 'https://discord.com/api/webhooks/id/synthetic-token' })
    expect(() => validateIntegrationDraft({ ...draft, name: 'x'.repeat(121) })).toThrow('120')
})
test('stale account/workspace snapshots and either impersonation never send a mutation', async () => {
    const current = await page(); calls.length = 0
    for (const change of [{ userId: 'another' }, { authToken: 'new-session' }, { selectedOrganizationId: 'other-org' }, { impersonationToken: 'synthetic' }, { impersonatingUserId: 'other' }]) await expect(saveIntegration({ ...settings, ...change }, current, draft)).rejects.toThrow('read-only')
    expect(calls).toHaveLength(0)
    expect(integrationsScope({ ...settings, selectedOrganizationId: 'other' })).not.toBe(integrationsScope(settings))
})
test('archive requires exact archived response and makes only one DELETE', async () => {
    const current = await page(); calls.length = 0
    handle = () => Response.json({ destination: { ...destination(), status: 'archived' } })
    await removeIntegration(settings, current, id)
    expect(calls).toHaveLength(1); expect(calls[0].init.method).toBe('DELETE'); expect(calls[0].init.body).toBeUndefined()
})
test('test POST is explicit live request, receipts distinguish real delivered, dry-run, skipped, failed', async () => {
    const current = await page(); calls.length = 0
    for (const [status, dryRun, http, expected] of [['delivered', false, 202, 'Example message sent.'], ['dry_run', true, 202, 'Dry run recorded. No example message was sent.'], ['skipped', false, 202, 'Test skipped. No example message was sent.'], ['failed', false, 502, 'Test failed. Review the destination before trying again.']] as const) {
        handle = () => Response.json({ delivery: { destinationId: id, orgId: current.scope, status, dryRun } }, { status: http })
        const result = await testIntegration(settings, current, id); expect(result.message).toBe(expected); expect(result.delivered).toBe(status === 'delivered')
    }
    expect(calls).toHaveLength(4); expect(calls.every(call => call.init.method === 'POST')).toBe(true)
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ dryRun: false, live: true })
    expect(calls[0].url.pathname).toEndWith(`/${id}/test`)
})
test('409 keeps draft unchanged; network/5xx/invalid acknowledgements never retry or echo endpoint secrets', async () => {
    const current = await page(); const before = JSON.stringify(draft)
    for (const response of [() => Response.json({ error: `duplicate ${draft.url}` }, { status: 409 }), () => Response.json({ error: 'temporary' }, { status: 503 }), () => Response.json({}), () => { throw new Error(`offline ${draft.url}`) }]) {
        calls.length = 0; handle = response
        try { await saveIntegration(settings, current, draft); throw new Error('Expected rejection') } catch (error) { expect(error).toBeInstanceOf(IntegrationError); expect((error as Error).message).not.toContain(draft.url) }
        expect(calls).toHaveLength(1); expect(JSON.stringify(draft)).toBe(before)
    }
})
test('unknown test receipt/foreign target is uncertain, never delivered; denied actions do not fetch', async () => {
    const current = await page(); calls.length = 0
    handle = () => Response.json({ delivery: { destinationId: id, orgId: 'foreign', status: 'delivered', dryRun: false } }, { status: 202 })
    await expect(testIntegration(settings, current, id)).rejects.toThrow('not confirmed')
    calls.length = 0
    await expect(testIntegration(settings, { ...current, items: [{ ...current.items[0], canTest: false }] }, id)).rejects.toThrow('unavailable')
    expect(calls).toHaveLength(0)
})
test('abort forwarding needs no static AbortSignal.any and removes listener after completion', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'any')!
    Object.defineProperty(AbortSignal, 'any', { configurable: true, value: undefined })
    try {
        const controller = new AbortController(); controller.abort()
        await loadIntegrations(settings, controller.signal)
        expect(calls.every(call => call.init.signal?.aborted)).toBe(true)
        const next = new AbortController(); calls.length = 0
        await loadIntegrations(settings, next.signal); next.abort()
        expect(calls.every(call => !call.init.signal?.aborted)).toBe(true)
    } finally { Object.defineProperty(AbortSignal, 'any', descriptor) }
})
test('search/kind/status are local and omit archived records without additional API calls', async () => {
    const current = await page()
    expect(filterIntegrations(current.items, 'ALERT', 'webhook', 'active')).toHaveLength(1)
    expect(filterIntegrations(current.items, '', 'discord')).toHaveLength(0)
    expect(filterIntegrations([{ ...current.items[0], status: 'archived' }], '')).toHaveLength(0)
})

test('Remove requires explicit server disable permission and active status; denied/missing/paused never fetch', async () => {
    for (const change of [{ canDisable: false }, { canDisable: undefined }, { paused: true }]) {
        handle = url => {
            if (url.pathname.includes('/organizations/')) return Response.json(org())
            const body = feed()
            Object.assign(body.destinationLifecycle[0].access, { canDisable: 'paused' in change ? true : change.canDisable })
            if ('paused' in change) body.destinations[0].status = 'paused'
            return Response.json(body)
        }
        const current = await page()
        expect(current.items[0].canRemove).toBe(false)
        calls.length = 0
        await expect(removeIntegration(settings, current, id)).rejects.toThrow('unavailable')
        expect(calls).toHaveLength(0)
    }
})

test('successful destinations remain read-only for org missing/mismatched/malformed/503/network lifecycle', async () => {
    for (const organization of [() => Response.json({}), () => Response.json(org({ id: 'foreign-org' })),
        () => Response.json(org({ lifecycleStatus: 123 })), () => Response.json(org({ privacyDeletionInProgress: 'false' })),
        () => Response.json({ error: 'private lifecycle detail' }, { status: 503 }),
        () => { throw new Error('private org network detail') }]) {
        handle = url => url.pathname.includes('/organizations/') ? organization() : Response.json(feed())
        const current = await page()
        expect(current).toMatchObject({ lifecycleUnavailable: true, canManage: false, scope: 'synthetic-org' })
        expect(current.items).toHaveLength(1)
        expect(current.items[0]).toMatchObject({ canEdit: false, canRemove: false, canTest: false })
        expect(JSON.stringify(current)).not.toContain('private')
        calls.length = 0
        await expect(saveIntegration(settings, current, draft)).rejects.toThrow('read-only')
        expect(calls).toHaveLength(0)
    }
})
test('destination network rejection stays fatal even if organization lifecycle succeeded', async () => {
    handle = url => { if (!url.pathname.includes('/organizations/')) throw new Error('synthetic destination network failure'); return Response.json(org()) }
    await expect(page()).rejects.toThrow('could not be confirmed')
})
