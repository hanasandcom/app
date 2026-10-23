import { beforeEach, expect, mock, test } from 'bun:test'
import type { AppSettings } from '../types'
const calls: { settings: AppSettings; url: URL; init: RequestInit }[] = []
let handle: (url: URL, init: RequestInit) => Response | Promise<Response>
mock.module('./api', () => ({ apiFetch: async (settings: AppSettings, path: string, init: RequestInit) => {
    const url = new URL(path); calls.push({ settings, url, init }); return handle(url, init)
} }))
const { loadFindings, filterFindings, findingCaseRef, findingsScope, findingExcerpt, findingText } = await import('./findings')
const settings = { siteBaseUrl: 'https://website.synthetic.invalid', apiBaseUrl: 'https://api.synthetic.invalid/api', userId: 'user', authToken: 'synthetic-token', selectedOrganizationId: 'org', impersonationToken: '', impersonatingUserId: '' } as AppSettings
const source = (change = {}) => ({
    id: 'finding', tenantId: 'org', organizationId: 'org', company: 'Example', actor: 'Actor name', matchedTerm: { value: 'example.test' }, severity: 'high', reviewState: 'new', deliveryState: 'pending',
    observedMatchSummary: 'Example was mentioned by the source.', recommendedAction: 'Review the captured evidence.', firstSeenAt: '2026-10-23T01:00:00Z', lastSeenAt: '2026-10-23T02:00:00Z',
    sourceFamily: 'darkweb_metadata', matchTiming: { kind: 'historical_backfill' }, workflowContext: { organizationId: 'org', caseId: 'case-one' },
    evidence: [{ id: 'evidence', sourceName: 'Source', captureMode: 'metadata_only', redactionState: 'metadata_only', excerpt: 'Source claim', observedAt: '2026-10-23T01:00:00Z', contentHash: 'sha256hash', provenance: { captureId: 'capture', publishedAt: '2026-10-23T00:30:00Z', collectedAt: '2026-10-23T01:30:00Z' } }], ...change,
})
const feed = (change = {}) => ({ organization: { id: 'org' }, visibilityDecision: { allowed: true }, alerts: [source()], total: 65, nextCursor: 'opaque:/+=cursor', pagination: { limit: 50 }, ...change })
beforeEach(() => { calls.length = 0; handle = () => Response.json(feed()) })
test('uses finite website GET and exact scoped query/auth transport, preserving opaque cursor', async () => {
    const page = await loadFindings(settings)
    expect(page).toMatchObject({ tenantId: 'org', organizationId: 'org', total: 65, nextCursor: 'opaque:/+=cursor' })
    expect(calls[0].url.origin).toBe('https://website.synthetic.invalid')
    expect(calls[0].url.pathname).toBe('/api/findings/alerts')
    expect(calls[0].url.searchParams.toString()).toBe('tenantId=org&organizationId=org&limit=50')
    expect(calls[0].init).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store' })
    expect(new Headers(calls[0].init.headers).get('authorization')).toBe('Bearer synthetic-token')
    expect(calls[0].settings).toBe(settings)
    handle = () => Response.json(feed({ alerts: [], nextCursor: null }))
    await loadFindings(settings, page.nextCursor)
    expect(calls[1].url.searchParams.get('cursor')).toBe('opaque:/+=cursor')
})
test('projects complete embedded evidence and exact linked case identity without detail calls', async () => {
    const page = await loadFindings(settings)
    expect(page.items[0]).toMatchObject({ title: 'Example', actor: 'Actor name', summary: 'Example was mentioned by the source.', observation: 'Historical match', recommendedAction: 'Review the captured evidence.' })
    expect(page.items[0].evidence[0]).toEqual({ id: 'evidence', sourceName: 'Source', captureMode: 'metadata_only', redactionState: 'metadata_only', excerpt: 'Source claim', safeToShow: true, contentHash: 'sha256hash', captureId: 'capture', observedAt: '2026-10-23T01:00:00.000Z', publishedAt: '2026-10-23T00:30:00.000Z', collectedAt: '2026-10-23T01:30:00.000Z' })
    expect(findingCaseRef(page.items[0])).toEqual({ caseId: 'case-one', organizationId: 'org', alertId: 'finding' })
    expect(calls).toHaveLength(1)
})
test('personal uses actual user tenant with no invented organization scope', async () => {
    handle = () => Response.json(feed({ organization: undefined, alerts: [source({ tenantId: 'user', organizationId: undefined, workflowContext: {} })] }))
    const page = await loadFindings({ ...settings, selectedOrganizationId: 'personal' })
    expect(calls[0].url.searchParams.get('tenantId')).toBe('user'); expect(calls[0].url.searchParams.has('organizationId')).toBe(false)
    expect(page.organizationId).toBeUndefined(); expect(findingCaseRef(page.items[0])).toBeUndefined()
})
test('wrong tenant/organization/visibility is rejected instead of exposing partial data', async () => {
    for (const body of [feed({ visibilityDecision: { allowed: false } }), feed({ organization: { id: 'other' } }), feed({ alerts: [source({ tenantId: 'other' })] }), feed({ alerts: [source({ workflowContext: { organizationId: 'other' } })] }), feed({ alerts: [source({ webhookContext: { tenantId: 'other' } })] }), feed({ visibilityDecision: {} })]) {
        handle = () => Response.json(body)
        await expect(loadFindings(settings)).rejects.toThrow()
    }
})
test('both impersonation states, insecure URLs and unsafe workspace IDs fail before transport', async () => {
    for (const change of [{ impersonationToken: 'imp' }, { impersonatingUserId: 'other' }, { siteBaseUrl: 'http://website.invalid' }, { siteBaseUrl: 'https://user:pass@website.invalid' }, { selectedOrganizationId: '../org' }]) await expect(loadFindings({ ...settings, ...change })).rejects.toThrow()
    expect(calls).toHaveLength(0)
})
test('valid empty page differs from unavailable, forbidden and malformed responses', async () => {
    handle = () => Response.json(feed({ alerts: [], total: 0, nextCursor: null }))
    expect((await loadFindings(settings)).items).toEqual([])
    for (const status of [401, 403, 404, 503]) {
        handle = () => Response.json({ error: 'private-upstream-error' }, { status })
        await expect(loadFindings(settings)).rejects.toMatchObject({ status })
        await expect(loadFindings(settings)).rejects.not.toThrow('private-upstream-error')
    }
    for (const body of [{}, feed({ alerts: null }), feed({ total: undefined }), feed({ alerts: [source({ evidence: undefined })] }), feed({ alerts: [source(), source()] })]) {
        handle = () => Response.json(body)
        await expect(loadFindings(settings)).rejects.toThrow()
    }
})
test('cursor and response safety limits do not silently normalize or truncate invalid pages', async () => {
    for (const cursor of ['', 'bad\nvalue', 'a'.repeat(4097)]) await expect(loadFindings(settings, cursor)).rejects.toThrow()
    expect(calls).toHaveLength(0)
    handle = () => Response.json(feed({ nextCursor: 'same' }))
    await expect(loadFindings(settings, 'same')).rejects.toThrow('next page')
    handle = () => Response.json(feed({ alerts: Array.from({ length: 51 }, (_, i) => source({ id: `f-${i}` })) }))
    await expect(loadFindings(settings)).rejects.toThrow('invalid page')
})
test('all evidence stays available and unknown timestamps remain unknown', async () => {
    const evidence = Array.from({ length: 25 }, (_, i) => ({ id: `e-${i}`, sourceName: 'Source', excerpt: 'Metadata', observedAt: 'invalid' }))
    handle = () => Response.json(feed({ alerts: [source({ evidence })] }))
    const item = (await loadFindings(settings)).items[0]
    expect(item.evidence).toHaveLength(25); expect(item.evidence[0].observedAt).toBe(''); expect(item.evidence[0].collectedAt).toBe('')
})
test('search/review filter and newest ordering apply only to the loaded page', async () => {
    handle = () => Response.json(feed({ alerts: [source(), source({ id: 'older', actor: 'Other', reviewState: 'closed', lastSeenAt: '2026-10-22T01:00:00Z' }), source({ id: 'muted', deliveryState: 'muted' })] }))
    const { items } = await loadFindings(settings)
    expect(filterFindings(items, 'actor name', true).map(row => row.id)).toEqual(['finding'])
    expect(filterFindings(items, 'example.test', false)).toHaveLength(3)
    expect(filterFindings(items, '', false).at(-1)?.id).toBe('older')
})
test('customer evidence is text-only and redacts secrets instead of displaying raw structured payloads', () => {
    expect(findingText('token=private-value')).not.toContain('private-value')
    expect(findingExcerpt('{"actor":"Group","token":"private-value","unknown":"private-other"}')).toBe('Group')
    expect(findingExcerpt('https://discord.com/api/webhooks/id/secret')).not.toContain('/id/secret')
    expect(findingExcerpt('{broken')).toBe('Evidence metadata is available.')
})
test('actor query identity is never truncated and unsupported names have no handoff', async () => {
    for (const actor of ['a'.repeat(201), 'bad\nname', '']) {
        handle = () => Response.json(feed({ alerts: [source({ actor })] }))
        expect((await loadFindings(settings)).items[0].actor).toBe('')
    }
    handle = () => Response.json(feed({ alerts: [source({ actor: 'Group: Example / α' })] }))
    expect((await loadFindings(settings)).items[0].actor).toBe('Group: Example / α')
})
test('aborted and late responses cannot be acknowledged as current results', async () => {
    const pre = new AbortController(); pre.abort()
    await expect(loadFindings(settings, null, pre.signal)).rejects.toThrow('cancelled'); expect(calls).toHaveLength(0)
    const controller = new AbortController()
    handle = async () => { controller.abort(); return Response.json(feed()) }
    await expect(loadFindings(settings, null, controller.signal)).rejects.toThrow('cancelled')
    expect(calls[0].init.signal?.aborted).toBe(true)
    expect(findingsScope({ ...settings, authToken: 'other' })).not.toBe(findingsScope(settings))
})
test('screen wires native investigation and explicit scoped handoffs, no invented mutation/detail endpoints', async () => {
    const source = await Bun.file(new URL('../screens/FindingsScreen.tsx', import.meta.url)).text()
    expect(source).toContain('key={findingsScope(props.settings)}')
    expect(source).toContain('current === epoch.current && active.current')
    expect(source).toContain('controller.abort()')
    expect(source).toContain('label=\'Search actor\'')
    expect(source).toContain('label=\'Open case on website\'')
    expect(source).toContain('onOpenMonitoredActors(page.organizationId)')
    expect(source).toContain('filterFindings(page?.items || [], query, reviewOnly)')
    expect(source).not.toContain('setInterval'); expect(source).not.toContain('POST')
})

test('a valid personal case preserves absent organization instead of inventing a workspace', async () => {
    handle = () => Response.json(feed({ organization: undefined, alerts: [source({ tenantId: 'user', organizationId: undefined, workflowContext: { caseId: 'personal-case' } })] }))
    const page = await loadFindings({ ...settings, selectedOrganizationId: 'personal' })
    expect(findingCaseRef(page.items[0])).toEqual({ caseId: 'personal-case', alertId: 'finding', organizationId: undefined })
})

test('restricted evidence never projects arbitrary private prose while metadata and counts remain', async () => {
    for (const flags of [{ redactionState: 'raw_sensitive' }, { safeToShow: false, redactionState: 'public_safe' }]) {
        const privateProse = 'A private sentence without any credential-shaped pattern.'
        handle = () => Response.json(feed({ alerts: [source({ evidence: [{ id: 'private-evidence', sourceName: 'Source', captureMode: 'metadata_only', observedAt: '2026-10-23T01:00:00Z', contentHash: 'retained-hash', provenance: { captureId: 'retained-capture' }, excerpt: privateProse, ...flags }] })] }))
        const page = await loadFindings(settings)
        expect(page.items[0].evidence).toHaveLength(1)
        expect(page.items[0].evidence[0]).toMatchObject({ id: 'private-evidence', safeToShow: false, excerpt: '', sourceName: 'Source', contentHash: 'retained-hash', captureId: 'retained-capture' })
        expect(JSON.stringify(page)).not.toContain(privateProse)
    }
    const component = await Bun.file(new URL('../components/FindingEvidence.tsx', import.meta.url)).text()
    expect(component).toContain('item.safeToShow ? item.excerpt : \'The excerpt is restricted.')
})
test('prefixed, embedded, escaped and double-encoded JSON exposes only allowed metadata', () => {
    const metadata = { actor: 'Group', unknown: 'private-other-prose', token: 'private token with spaces' }
    const json = JSON.stringify(metadata)
    for (const value of [json, `Capture payload ${json}`, `Prefix ${json} suffix`, json.replaceAll('"', '\\"'), JSON.stringify(json), JSON.stringify(JSON.stringify(json)), 'Capture "token":"private token with spaces"']) {
        const display = findingExcerpt(value)
        expect(display).not.toContain('private-other-prose')
        expect(display).not.toContain('private token with spaces')
        expect(display).not.toContain('unknown')
        expect(display === 'Group' || display === 'Evidence metadata is available.').toBe(true)
    }
    expect(findingExcerpt('Prefix {"actor":"Group","unknown":"unterminated')).toBe('Evidence metadata is available.')
    expect(findingExcerpt('Safe plain source excerpt.')).toBe('Safe plain source excerpt.')
    expect(findingText('"token":"private value with spaces"')).not.toContain('private value')
})
