import { beforeEach, expect, mock, test } from 'bun:test'
import type { AppSettings } from '../../types'
import { AbortController as NativeAbortController } from 'abort-controller'
import type { CreateVmInput } from './setup'
const calls: { url: string; init: RequestInit }[] = []
let handler: (url: string, init: RequestInit) => Promise<Response>
mock.module('../../lib/api', () => ({ apiFetch: async (_s: AppSettings, url: string, init: RequestInit) => { calls.push({ url, init }); return handler(url, init) } }))
const api = await import('./api'), model = await import('./model'), setup = await import('./setup'), transport = await import('./transport')
const s = { userId: 'synthetic-user', authToken: 'synthetic-token', apiBaseUrl: 'https://api.hanasand.com/api', siteBaseUrl: 'https://hanasand.com', selectedOrganizationId: 'personal', impersonationToken: '', impersonatingUserId: '' } as AppSettings
const vmRow = (changes = {}) => ({ name: 'synthetic-vm', owner: s.userId, primary_host: 'inspur', failover_host: 'ovhcloud', failover_premium: true, failover_enabled: true, can_assign_organization: true, ...changes })
const vm = (changes = {}) => model.scoped(s, model.parseVm(vmRow(changes)))
const permission = (canManage = true) => model.scoped(s, { name: 'synthetic-vm', canManage, services: [] })
const platform = () => model.scoped(s, { canRead: true, canEdit: true })
const signal = () => new AbortController().signal
const respond = (value: unknown, status = 200) => { handler = async () => Response.json(value, { status }) }
const createInput = () => ({ name: 'synthetic-vm', os: 'ubuntu-24.04' as const, resources: setup.resourcePlans[0], services: [] })
beforeEach(() => { calls.length = 0; respond([]) })
test('inventory/details/metrics are direct registered reads and never invoke explicit side-effect GETs', async () => {
    respond([vmRow()]); const rows = await api.loadInventory(s, signal()); expect(rows.value[0].name).toBe('synthetic-vm')
    await api.loadAccessibleInventory(s, signal()); await api.loadVm(s, 'synthetic-vm', signal())
    respond([]); expect((await api.loadDetails(s, 'synthetic-vm', signal())).value).toBeNull()
    await api.loadMetrics(s, 'synthetic-vm', signal())
    expect(calls.map(c => c.url)).toEqual(['https://api.hanasand.com/api/vms/synthetic-user', 'https://api.hanasand.com/api/vms/access/synthetic-user', 'https://api.hanasand.com/api/vm/synthetic-vm', 'https://api.hanasand.com/api/vm/details/synthetic-vm', 'https://api.hanasand.com/api/vm/metrics/synthetic-vm'])
    expect(calls.every(c => c.init.method === 'GET' && c.init.cache === 'no-store')).toBe(true)
    expect(calls.some(c => /connection|refresh=1|vms\/stop/.test(c.url))).toBe(false)
})
test('custom HTTPS receives explicit authentication and organization scope; permission discovery is Identity owned', async () => {
    const custom = { ...s, apiBaseUrl: 'https://synthetic.invalid/api', selectedOrganizationId: 'org:one' }
    await api.loadInventory(custom, signal())
    const headers = new Headers(calls[0].init.headers)
    expect(headers.get('authorization')).toBe('Bearer synthetic-token'); expect(headers.get('id')).toBe(s.userId); expect(headers.get('x-organization-id')).toBe('org:one')
    expect(calls[0].init.credentials).toBe('omit'); expect(calls[0].init.redirect).toBe('error')
    respond([vmRow({ organization_id: 'foreign-org' })]); await expect(api.loadInventory(custom, signal())).rejects.toThrow('different workspace')
    respond({ allowed: true, canEdit: false }); expect((await api.loadPlatformAccess(s, signal())).value.canEdit).toBe(false)
    expect(calls[2].url).toBe('https://identity.hanasand.com/api/management/organizations?internalPages=1')
})
test('malformed, duplicate or foreign identities fail; missing measurements remain unavailable and measured zero stays zero', async () => {
    for (const value of [{}, null, [vmRow(), vmRow()]]) { respond(value); await expect(api.loadInventory(s, signal())).rejects.toThrow() }
    respond([vmRow({ name: 'different' })]); await expect(api.loadVm(s, 'synthetic-vm', signal())).rejects.toThrow('different')
    const metric = model.parseMetric({ name: 'synthetic-vm', cpu_usage_percent: 0, ram_used_mb: null })
    expect(model.parseMetric({ name: 'synthetic-vm', ram_used_mb: '0.00' }).ram_used_mb).toBe(0); expect(model.parseMetric({ name: 'synthetic-vm', ram_used_mb: '' }).ram_used_mb).toBeNull()
    expect(metric.cpu_usage_percent).toBe(0); expect(metric.ram_used_mb).toBeNull(); expect(metric.disk_total_mb).toBeNull()
    expect(model.parseVm(vmRow()).failover_enabled).toBe(true); expect(model.parseVm(vmRow()).always_running_enabled).toBeNull()
    expect(() => model.parseDetails({ name: 'foreign' }, 'synthetic-vm')).toThrow('different')
})
test('management requires actual endpoint canManage, exact actor/service/workspace/VM and fresh observation', async () => {
    for (const settings of [{ ...s, userId: 'other' }, { ...s, authToken: 'rotated' }, { ...s, selectedOrganizationId: 'other' }, { ...s, apiBaseUrl: 'https://other.invalid/api' }]) await expect(api.power(settings, vm(), permission(), 'start', signal())).rejects.toThrow()
    await expect(api.power(s, vm(), permission(false), 'start', signal())).rejects.toThrow('permission')
    await expect(api.power(s, vm(), model.scoped(s, { ...permission().value, name: 'foreign' }), 'start', signal())).rejects.toThrow()
    await expect(api.power(s, { ...vm(), checkedAt: Date.now() - 31000 }, permission(), 'start', signal())).rejects.toThrow('Refresh')
    await expect(api.power(s, vm({ deleted_at: new Date().toISOString() }), permission(), 'start', signal())).rejects.toThrow('Restore')
    expect(calls.length).toBe(0)
})
test('both impersonation states reject sensitive and action wrappers before any dispatch', async () => {
    for (const settings of [{ ...s, impersonationToken: 'synthetic-imp' }, { ...s, impersonatingUserId: 'other' }]) {
        await expect(api.createVm(settings, createInput(), signal())).rejects.toThrow('own')
        await expect(api.suggestSetup(settings, 'Install Node.js', 'ubuntu-24.04', signal())).rejects.toThrow('own')
        await expect(api.revealSudoPassword(settings, vm(), 'synthetic-password', signal())).rejects.toThrow('own')
        await expect(api.syncConnection(settings, vm(), signal())).rejects.toThrow('own')
        await expect(api.stopAll(settings, platform(), signal())).rejects.toThrow('own')
    }
    expect(calls.length).toBe(0)
})
test('per-VM canManage is parsed strictly and never replaced by platform access', async () => {
    respond({ services: [], canManage: false }); expect((await api.loadPublicServices(s, 'synthetic-vm', signal())).value.canManage).toBe(false)
    respond({ services: [] }); await expect(api.loadPublicServices(s, 'synthetic-vm', signal())).rejects.toThrow('permission')
    respond({ services: [{ id: 'route', name: 'app', type: 'http', port: 3000, hostname: 'app.hanasand.com', createdAt: null }], canManage: true })
    expect((await api.loadPublicServices(s, 'synthetic-vm', signal())).value.services[0].port).toBe(3000)
})
test('create validates supported resources/EULA/Desktop/packages and sends exact ordinary fields', async () => {
    for (const input of [{ ...createInput(), name: '../vm' }, { ...createInput(), services: ['minecraft-java'] }, { ...createInput(), os: 'ubuntu-24.04-desktop' }, { ...createInput(), custom_apt_packages: ['curl;echo'] }]) await expect(api.createVm(s, input as CreateVmInput, signal())).rejects.toThrow()
    expect(calls.length).toBe(0)
    respond(vmRow(), 201)
    const result = await api.createVm(s, { ...createInput(), owner: 'injected-other' } as CreateVmInput, signal())
    expect(result.status).toBe(201); expect(result.vm.status).toBeNull()
    expect(JSON.parse(String(calls[0].init.body))).toEqual(createInput())
    respond(vmRow()); await expect(api.createVm(s, createInput(), signal())).rejects.toMatchObject({ uncertain: true })
})
test('create organization must match selected workspace and arbitrary extra provisioning authority is not forwarded', async () => {
    await expect(api.createVm(s, { ...createInput(), organization_id: 'foreign' }, signal())).rejects.toThrow('workspace')
    const org = { ...s, selectedOrganizationId: 'org-one' }; respond(vmRow({ organization_id: 'org-one' }), 201)
    await api.createVm(org, { ...createInput(), organization_id: 'org-one' }, signal())
    expect(new Headers(calls[0].init.headers).get('x-organization-id')).toBe('org-one')
})
test('power returns arbitrary upstream JSON without inventing success; dispatched failures never retry', async () => {
    respond({ metadata: { status: 'queued' } }); const result = await api.power(s, vm(), permission(), 'restart', signal())
    expect(result).toEqual({ status: 200, payload: { metadata: { status: 'queued' } } }); expect(calls[0].init.method).toBe('POST')
    respond({ error: 'synthetic-private-data' }, 504)
    await expect(api.power(s, vm(), permission(), 'stop', signal())).rejects.toMatchObject({ uncertain: true, status: 504 })
    expect(calls.length).toBe(2)
    try { await api.power(s, vm(), permission(), 'start', signal()) } catch (e) { expect(String(e)).not.toContain('synthetic-private-data') }
})
test('failover sends authoritative standby and requestId; exact202 is queued and not completed', async () => {
    const requestId = '11111111-1111-1111-1111-111111111111'
    respond({ message: 'Host switch queued.', vm: vmRow() }, 202)
    expect((await api.failover(s, vm(), permission(), requestId, signal())).status).toBe(202)
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ targetHost: 'ovhcloud', requestId })
    respond({ message: 'Host switch queued.', vm: vmRow() }); await expect(api.failover(s, vm(), permission(), requestId, signal())).rejects.toMatchObject({ uncertain: true })
    await expect(api.failover(s, vm({ failover_premium: false }), permission(), requestId, signal())).rejects.toThrow('entitlement')
})
test('public service creation/removal uses current permission/list and exact receipts', async () => {
    const service = { id: 'route-one', name: 'app', type: 'http' as const, port: 3000, hostname: 'app.hanasand.com', createdAt: null }
    respond(service, 201); expect((await api.addPublicService(s, vm(), permission(), { name: 'app', type: 'http', port: 3000 }, signal())).id).toBe('route-one')
    await expect(api.removePublicService(s, vm(), permission(), 'route-one', signal())).rejects.toThrow('current')
    respond({ ok: true }); const p = model.scoped(s, { ...permission().value, services: [service] })
    await api.removePublicService(s, vm(), p, 'route-one', signal()); expect(calls[1].init.method).toBe('DELETE')
})
test('host patch is limited to failover enablement; assignment checks eligibility and exact organization receipt', async () => {
    respond(vmRow()); await api.setFailoverEnabled(s, vm(), permission(), false, signal())
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ failover_enabled: false })
    respond({ status: 200, organization: { id: 'org-one', name: 'Synthetic organization' } })
    await api.assignOrganization(s, vm(), 'org-one', signal())
    await expect(api.assignOrganization(s, vm({ can_assign_organization: false }), 'org-one', signal())).rejects.toThrow('eligible')
})
test('connection sync and detail collection are explicit GET effects; malformed receipts uncertain', async () => {
    respond({ vmName: 'synthetic-vm', vmIp: '', username: 'synthetic-vm', sshCommand: null, certificateCount: 0, certificates: [] })
    expect((await api.syncConnection(s, vm(), signal())).certificateCount).toBe(0)
    respond({ name: 'synthetic-vm' }); await api.collectDetails(s, vm(), signal())
    expect(calls.map(c => c.url.split('/api/')[1])).toEqual(['vm/synthetic-vm/connection', 'vm/details/synthetic-vm?refresh=1'])
    respond({}); await expect(api.syncConnection(s, vm(), signal())).rejects.toMatchObject({ uncertain: true })
})
test('sudo is server-reauthenticated and ephemeral; errors never include supplied password or upstream body', async () => {
    respond({ password: 'Synthetic-guest-password' }); expect(await api.revealSudoPassword(s, vm(), 'Synthetic-account-password', signal())).toEqual({ password: 'Synthetic-guest-password' })
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ currentPassword: 'Synthetic-account-password' })
    respond({ error: 'Synthetic-account-password' }, 503)
    try { await api.revealSudoPassword(s, vm(), 'Synthetic-account-password', signal()) } catch (e) { expect(String(e)).not.toContain('Synthetic-account-password') }
})
test('deletion/restore require separate current platform authority and retain server message/state', async () => {
    await expect(api.changeDeletion(s, vm(), model.scoped(s, { canRead: true, canEdit: false }), 'delete', 'synthetic-vm', signal())).rejects.toThrow('editing')
    await expect(api.changeDeletion(s, vm(), platform(), 'delete', 'wrong', signal())).rejects.toThrow('confirmation')
    respond({ message: 'VM stopped. You can restore it for 30 days.', vm: vmRow({ deleted_at: '2026-10-23T00:00:00Z', delete_after: '2026-11-22T00:00:00Z' }) })
    expect((await api.changeDeletion(s, vm(), platform(), 'delete', 'synthetic-vm', signal())).vm.delete_after).toBe('2026-11-22T00:00:00Z')
    respond({ message: 'VM restored.', vm: vmRow() }); await api.changeDeletion(s, vm({ deleted_at: '2026-10-23T00:00:00Z' }), platform(), 'restore', undefined, signal())
    expect(calls[1].url).toEndWith('/restore'); expect(calls[1].init.method).toBe('POST')
})
test('StopAll explicitly POSTs and preserves queued list; it never invokes legacy GET', async () => {
    respond({ success: true, message: 'Queued shutdown for 1 VM.', vms: ['synthetic-vm'] })
    expect((await api.stopAll(s, platform(), signal())).vms).toEqual(['synthetic-vm'])
    expect(calls[0].url).toEndWith('/vms/stop'); expect(calls[0].init.method).toBe('POST'); expect(calls[0].init.body).toBeUndefined()
})
test('checkout eligibility comes from exact owned product list and no payment completion is inferred', async () => {
    respond({ plans: [{ id: 'failover', name: 'Failover', priceNok: 49, currency: 'NOK', interval: 'month' }], containers: [{ name: 'synthetic-vm', primary_host: 'inspur', failover_premium: false }] })
    const products = await api.loadProducts(s, signal())
    respond({ url: 'https://checkout.stripe.com/c/pay/synthetic' }); expect((await api.createCheckout(s, 'synthetic-vm', products, signal())).url).toStartWith('https:')
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ vmName: 'synthetic-vm', feature: 'failover' })
    await expect(api.createCheckout(s, 'foreign', products, signal())).rejects.toThrow('eligible')
})
test('setup generation is explicit and bounded; static and generated project contracts are preserved', async () => {
    respond({ summary: 'Install Node.js', services: ['nodejs'], packages: [], website: null, minecraftServerType: null })
    expect((await api.suggestSetup(s, 'Install Node.js', 'ubuntu-24.04', signal())).services).toEqual(['nodejs'])
    expect(calls[0].url).toEndWith('/vm/setup-plan'); expect(calls[0].init.method).toBe('POST')
    expect(() => setup.parseProjectFiles([{ path: '../secret', content: '' }])).toThrow()
    expect(() => setup.parseWebsite({ title: 'Site', tagline: '', sections: [], gallery: [{ url: 'http://synthetic.invalid', alt: 'Test', caption: '' }] })).toThrow()
})
test('native AbortController polyfill, ignored cancellation and slow body stay bounded; interrupted effects unknown', async () => {
    const old = globalThis.AbortController; globalThis.AbortController = NativeAbortController as unknown as typeof AbortController
    try {
        const c = new AbortController(); c.abort(); await expect(api.loadInventory(s, c.signal)).rejects.toThrow(); expect(calls.length).toBe(0)
        const never = new Promise<Response>(() => {})
        await expect(api.createVm(s, createInput(), signal(), { transport: () => never, timeoutMs: 3 })).rejects.toMatchObject({ uncertain: true })
        const response = Response.json([]); response.text = () => new Promise(() => {})
        await expect(api.loadInventory(s, signal(), { transport: async () => response, timeoutMs: 3 })).rejects.toThrow('interrupted')
    } finally { globalThis.AbortController = old }
})
test('unsafe service URL, traversal targets, oversize and nonJSON responses fail with no alternate transport', async () => {
    for (const url of ['http://synthetic.invalid/api', 'https://u:p@synthetic.invalid/api', 'https://synthetic.invalid/api?token=secret']) await expect(api.loadInventory({ ...s, apiBaseUrl: url }, signal())).rejects.toThrow('secure')
    await expect(api.loadVm(s, '../vm', signal())).rejects.toThrow('valid')
    expect(calls.length).toBe(0)
    await expect(api.loadInventory(s, signal(), { transport: async () => new Response('{}', { headers: { 'content-length': '8388609' } }) })).rejects.toThrow('size limit')
    await expect(api.power(s, vm(), permission(), 'start', signal(), { transport: async () => new Response('unreadable') })).rejects.toMatchObject({ uncertain: true })
    expect(transport.utf8Size('Ø😀')).toBe(6)
})

test('checkout receipts permit only the exact HTTPS Stripe Checkout origin', async () => {
    const products = model.scoped(s, { plans: [{ id: 'failover' as const, name: 'Failover', priceNok: 49, currency: 'NOK' as const, interval: 'month' as const }], containers: [{ name: 'synthetic-vm', primary_host: 'inspur', failover_premium: false }] })
    for (const url of [
        'https://checkout.stripe.com.evil.invalid/c/pay/synthetic',
        'https://evil.invalid/checkout.stripe.com',
        'https://checkout.stripe.com@evil.invalid/c/pay/synthetic',
        'https://user:password@checkout.stripe.com/c/pay/synthetic',
        'https://checkout.stripe.com:8443/c/pay/synthetic',
        'http://checkout.stripe.com/c/pay/synthetic',
        'https://checkout.stripe.com./c/pay/synthetic',
    ]) {
        respond({ url })
        await expect(api.createCheckout(s, 'synthetic-vm', products, signal())).rejects.toMatchObject({ uncertain: true })
    }
    const url = 'https://checkout.stripe.com:443/c/pay/synthetic#provider-fragment'
    respond({ url }); expect(await api.createCheckout(s, 'synthetic-vm', products, signal())).toEqual({ url })
    expect(setup.httpsUrl('https://gallery.synthetic.invalid/photo.png')).toBe('https://gallery.synthetic.invalid/photo.png')
})
