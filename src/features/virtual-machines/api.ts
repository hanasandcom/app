import type { AppSettings } from '../../types'
import { organizationListBase } from '../../lib/organization-endpoint'
import { flag, identifier, list, name, object, optionalString, parseDetails, parseMetric, parseService, parseVm, requireCurrent, requireManage, scoped, string, type Json, type Scoped, type Vm, type VmManagement } from './model'
import { createPayload, httpsUrl, operatingSystems, parseSetupPlan, type CreateVmInput } from './setup'
import { requireOwn, VmError, vmRequest, type VmRequestOptions } from './transport'
export type PlatformAccess = { canRead: boolean; canEdit: boolean }
type Result = Awaited<ReturnType<typeof vmRequest>>
function receipt<T>(response: Result, status: number, parse: (value: unknown) => T): T {
    try { if (response.status !== status) throw new Error(); return parse(response.value) }
    catch { throw new VmError('The operation receipt could not be verified. Review current state before another attempt.', response.status, true) }
}
function sameVm(value: unknown, target: string, settings?: AppSettings) { const vm = settings ? workspaceVm(settings, value) : parseVm(value); if (vm.name.toLowerCase() !== name(target).toLowerCase()) throw new VmError('The response belongs to a different VM.'); return vm }
function workspaceVm(s: AppSettings, value: unknown) {
    const vm = parseVm(value), organization = s.selectedOrganizationId
    if (organization && organization !== 'personal' && vm.organization_id !== organization) throw new VmError('The VM response belongs to a different workspace.')
    return vm
}
function active(s: AppSettings, result: Scoped<Vm>) { requireOwn(s); const vm = requireCurrent(s, result); if (vm.deleted_at) throw new VmError('Restore this VM before managing it.', 409); return vm }
function manager(s: AppSettings, vm: Scoped<Vm>, permission: Scoped<VmManagement>) { const value = active(s, vm); requireManage(s, permission, value.name); return value }
function platform(s: AppSettings, access: Scoped<PlatformAccess>) { requireOwn(s); if (!requireCurrent(s, access).canEdit) throw new VmError('Current Hanasand editing access is required.', 403) }
export async function loadPlatformAccess(s: AppSettings, signal: AbortSignal, options?: VmRequestOptions) {
    const r = object((await vmRequest({ ...s, apiBaseUrl: organizationListBase(s) }, 'management/organizations?internalPages=1', 'GET', signal, options)).value)
    if (typeof r.allowed !== 'boolean' || typeof r.canEdit !== 'boolean') throw new VmError('VM permission response is incomplete.')
    return scoped(s, { canRead: r.allowed, canEdit: r.allowed && r.canEdit })
}
export async function loadInventory(s: AppSettings, signal: AbortSignal, options?: VmRequestOptions) {
    const target = identifier(s.impersonatingUserId || s.userId)
    const r = await vmRequest(s, `vms/${encodeURIComponent(target)}`, 'GET', signal, options)
    const rows = list(r.value).map(value => workspaceVm(s, value)), seen = new Set<string>()
    for (const vm of rows) { if (seen.has(vm.name.toLowerCase())) throw new VmError('VM inventory contains duplicate identities.'); seen.add(vm.name.toLowerCase()) }
    return scoped(s, rows)
}
export async function loadAccessibleInventory(s: AppSettings, signal: AbortSignal, options?: VmRequestOptions) {
    return scoped(s, list((await vmRequest(s, `vms/access/${encodeURIComponent(identifier(s.impersonatingUserId || s.userId))}`, 'GET', signal, options)).value).map(value => workspaceVm(s, value)))
}
export async function loadVm(s: AppSettings, target: string, signal: AbortSignal, options?: VmRequestOptions) {
    const rows = list((await vmRequest(s, `vm/${encodeURIComponent(name(target))}`, 'GET', signal, options)).value, 1)
    if (rows.length !== 1) throw new VmError('VM not found.', 404)
    return scoped(s, sameVm(rows[0], target, s))
}
export async function loadDetails(s: AppSettings, target: string, signal: AbortSignal, options?: VmRequestOptions) {
    return scoped(s, parseDetails((await vmRequest(s, `vm/details/${encodeURIComponent(name(target))}`, 'GET', signal, options)).value, target))
}
// Explicit action: refresh=1 contacts the host and persists collected details. Never call during routine reads.
export async function collectDetails(s: AppSettings, vm: Scoped<Vm>, signal: AbortSignal, options?: VmRequestOptions) {
    const value = active(s, vm)
    const r = await vmRequest(s, `vm/details/${encodeURIComponent(value.name)}?refresh=1`, 'GET', signal, options, undefined, true)
    return scoped(s, receipt(r, 200, value => parseDetails(value, vm.value.name)))
}
export async function loadMetrics(s: AppSettings, target: string, signal: AbortSignal, options?: VmRequestOptions) {
    return scoped(s, list((await vmRequest(s, `vm/metrics/${encodeURIComponent(name(target))}`, 'GET', signal, options)).value, 120).map(value => parseMetric(value, target)))
}
export async function loadPublicServices(s: AppSettings, target: string, signal: AbortSignal, options?: VmRequestOptions): Promise<Scoped<VmManagement>> {
    const r = object((await vmRequest(s, `vm/${encodeURIComponent(name(target))}/public-services`, 'GET', signal, options)).value)
    if (typeof r.canManage !== 'boolean') throw new VmError('VM management permission was not returned.')
    return scoped(s, { name: target, canManage: r.canManage, services: list(r.services, 1000).map(parseService) })
}
export async function createVm(s: AppSettings, input: CreateVmInput, signal: AbortSignal, options?: VmRequestOptions) {
    requireOwn(s)
    const body = createPayload(input), organization = s.selectedOrganizationId && s.selectedOrganizationId !== 'personal' ? s.selectedOrganizationId : null
    if ((body.organization_id || null) !== organization) throw new VmError('The create request belongs to a different workspace.')
    const r = await vmRequest(s, 'vm', 'POST', signal, options, body, true, 180000)
    return { status: 201 as const, vm: receipt(r, 201, value => sameVm(value, input.name, s)) }
}
// Generating a setup plan invokes the configured AI service; this is explicit, not a read-side default.
export async function suggestSetup(s: AppSettings, prompt: string, os: CreateVmInput['os'], signal: AbortSignal, options?: VmRequestOptions) {
    requireOwn(s)
    if (prompt.trim().length < 5 || prompt.length > 1200 || !operatingSystems.includes(os)) throw new VmError('Describe a supported Ubuntu setup in 5–1,200 characters.')
    const r = await vmRequest(s, 'vm/setup-plan', 'POST', signal, options, { prompt, os }, true, 30000)
    return receipt(r, 200, parseSetupPlan)
}
export async function power(s: AppSettings, vm: Scoped<Vm>, permission: Scoped<VmManagement>, action: 'start' | 'stop' | 'restart', signal: AbortSignal, options?: VmRequestOptions) {
    const value = manager(s, vm, permission)
    if (!['start', 'stop', 'restart'].includes(action)) throw new VmError('Choose a supported power action.')
    const r = await vmRequest(s, `vm/${encodeURIComponent(value.name)}/${action}`, 'POST', signal, options, undefined, true, 150000)
    // The host returns arbitrary JSON. HTTP acceptance is not a fabricated success/completion envelope.
    return { status: r.status, payload: r.value as Json }
}
export async function assignOrganization(s: AppSettings, vm: Scoped<Vm>, organizationId: string, signal: AbortSignal, options?: VmRequestOptions) {
    const value = active(s, vm)
    if (value.can_assign_organization !== true || value.organization_id) throw new VmError('This VM is not eligible for organization assignment.')
    const r = await vmRequest(s, `vm/${encodeURIComponent(value.name)}/organization`, 'PUT', signal, options, { organizationId: identifier(organizationId) }, true)
    return receipt(r, 200, value => { const body = object(value), organization = object(body.organization); if (body.status !== 200 || organization.id !== organizationId) throw new Error(); return { status: 200 as const, organization: { id: identifier(organization.id), name: string(organization.name) } } })
}
export async function addPublicService(s: AppSettings, vm: Scoped<Vm>, permission: Scoped<VmManagement>, input: { name: string; type: 'http' | 'tls' | 'minecraft-java'; port: number }, signal: AbortSignal, options?: VmRequestOptions) {
    const value = manager(s, vm, permission), serviceName = input.name.trim().toLowerCase()
    if (!/^[a-z0-9](?:[a-z0-9-]{0,39}[a-z0-9])?$/.test(serviceName) || serviceName.startsWith('port-') || !['http', 'tls', 'minecraft-java'].includes(input.type) || !Number.isInteger(input.port) || input.port < 1 || input.port > 65535) throw new VmError('Enter a supported public service name, type and port.')
    const r = await vmRequest(s, `vm/${encodeURIComponent(value.name)}/public-services`, 'POST', signal, options, { name: serviceName, type: input.type, port: input.port }, true)
    return receipt(r, 201, parseService)
}
export async function removePublicService(s: AppSettings, vm: Scoped<Vm>, permission: Scoped<VmManagement>, routeId: string, signal: AbortSignal, options?: VmRequestOptions) {
    const value = manager(s, vm, permission)
    if (!permission.value.services.some(service => service.id === routeId)) throw new VmError('Refresh and select a current public service.')
    const r = await vmRequest(s, `vm/${encodeURIComponent(value.name)}/public-services/${encodeURIComponent(identifier(routeId))}`, 'DELETE', signal, options, undefined, true)
    return receipt(r, 200, value => { if (object(value).ok !== true) throw new Error(); return { ok: true as const } })
}
export async function setFailoverEnabled(s: AppSettings, vm: Scoped<Vm>, permission: Scoped<VmManagement>, enabled: boolean, signal: AbortSignal, options?: VmRequestOptions) {
    const value = manager(s, vm, permission)
    if (typeof enabled !== 'boolean' || enabled && value.failover_premium !== true) throw new VmError('Current failover entitlement is required.', 402)
    const r = await vmRequest(s, `vm/${encodeURIComponent(value.name)}/host-features`, 'PUT', signal, options, { failover_enabled: enabled }, true)
    return scoped(s, receipt(r, 200, result => sameVm(result, value.name, s)))
}
export async function failover(s: AppSettings, vm: Scoped<Vm>, permission: Scoped<VmManagement>, requestId: string, signal: AbortSignal, options?: VmRequestOptions) {
    const value = manager(s, vm, permission)
    if (value.failover_premium !== true || value.failover_enabled !== true || !value.failover_host || !/^[a-f0-9-]{36}$/.test(requestId)) throw new VmError('Refresh the current failover entitlement and standby host before requesting a switch.')
    const r = await vmRequest(s, `vm/${encodeURIComponent(value.name)}/failover`, 'POST', signal, options, { targetHost: value.failover_host, requestId }, true)
    return receipt(r, 202, result => { const body = object(result); return { status: 202 as const, message: string(body.message), vm: sameVm(body.vm, value.name, s) } })
}
// Explicit GET with side effects: syncs saved public SSH certificates to the guest.
export async function syncConnection(s: AppSettings, vm: Scoped<Vm>, signal: AbortSignal, options?: VmRequestOptions) {
    const value = active(s, vm), r = await vmRequest(s, `vm/${encodeURIComponent(value.name)}/connection`, 'GET', signal, options, undefined, true)
    return receipt(r, 200, result => {
        const body = object(result)
        if (body.vmName !== value.name || typeof body.certificateCount !== 'number' || !Number.isInteger(body.certificateCount) || body.certificateCount < 0) throw new Error()
        return { vmName: value.name, vmIp: string(body.vmIp), username: string(body.username), sshCommand: optionalString(body.sshCommand), certificateCount: body.certificateCount,
            certificates: list(body.certificates, 10000).map(value => { const c = object(value); return { id: String(c.id), name: string(c.name), public_key: string(c.public_key, 16384), owner: string(c.owner, 200), created_by: optionalString(c.created_by), created_at: optionalString(c.created_at) } }) }
    })
}
// canManage does not grant credential access. This endpoint independently verifies ownership/organization role, password, audit and security email.
export async function revealSudoPassword(s: AppSettings, vm: Scoped<Vm>, currentPassword: string, signal: AbortSignal, options?: VmRequestOptions) {
    const value = active(s, vm)
    if (!currentPassword || currentPassword.length > 1024) throw new VmError('Enter your current account password.')
    const r = await vmRequest(s, `vm/${encodeURIComponent(value.name)}/sudo-password`, 'POST', signal, options, { currentPassword }, true)
    return receipt(r, 200, result => { const password = string(object(result).password, 128); if (password.length < 8 || /[\s\p{Cc}]/u.test(password)) throw new Error(); return { password } })
}
export async function changeDeletion(s: AppSettings, vm: Scoped<Vm>, access: Scoped<PlatformAccess>, action: 'delete' | 'restore', confirmation: string | undefined, signal: AbortSignal, options?: VmRequestOptions) {
    platform(s, access); const value = requireCurrent(s, vm)
    if (action !== 'delete' && action !== 'restore' || action === 'delete' && confirmation !== value.name || action === 'restore' && !value.deleted_at) throw new VmError('Review the current VM deletion state and exact confirmation.')
    const r = await vmRequest(s, `vm/${encodeURIComponent(value.name)}${action === 'restore' ? '/restore' : ''}`, action === 'restore' ? 'POST' : 'DELETE', signal, options, action === 'delete' ? { confirmation } : undefined, true, 150000)
    return receipt(r, 200, result => { const body = object(result); return { message: string(body.message), vm: sameVm(body.vm, value.name, s) } })
}
// POST only: the registered legacy GET /vms/stop is also a mutation and is intentionally never used.
export async function stopAll(s: AppSettings, access: Scoped<PlatformAccess>, signal: AbortSignal, options?: VmRequestOptions) {
    platform(s, access)
    const r = await vmRequest(s, 'vms/stop', 'POST', signal, options, undefined, true)
    return receipt(r, 200, result => { const body = object(result); if (body.success !== true) throw new Error(); return { success: true as const, message: string(body.message), vms: list(body.vms).map(name) } })
}
export async function loadProducts(s: AppSettings, signal: AbortSignal, options?: VmRequestOptions) {
    requireOwn(s)
    const r = object((await vmRequest(s, 'billing/container-products', 'GET', signal, options)).value)
    return scoped(s, { plans: list(r.plans, 100).map(value => { const plan = object(value); if (plan.id !== 'failover' || typeof plan.priceNok !== 'number' || !Number.isFinite(plan.priceNok) || plan.priceNok < 0 || plan.currency !== 'NOK' || plan.interval !== 'month') throw new VmError('Unsupported container product.'); return { id: 'failover' as const, name: string(plan.name), priceNok: plan.priceNok, currency: 'NOK' as const, interval: 'month' as const } }),
        containers: list(r.containers).map(value => { const vm = object(value); return { name: name(vm.name), primary_host: optionalString(vm.primary_host), failover_premium: flag(vm.failover_premium) } }) })
}
export async function createCheckout(s: AppSettings, target: string, products: Awaited<ReturnType<typeof loadProducts>>, signal: AbortSignal, options?: VmRequestOptions) {
    requireOwn(s); const product = requireCurrent(s, products)
    if (!product.plans.some(p => p.id === 'failover') || !product.containers.some(vm => vm.name === target && vm.failover_premium === false)) throw new VmError('Refresh eligible containers and products before checkout.')
    const r = await vmRequest(s, 'billing/container-checkout', 'POST', signal, options, { vmName: name(target), feature: 'failover' }, true)
    return receipt(r, 200, result => ({ url: httpsUrl(object(result).url) }))
}
