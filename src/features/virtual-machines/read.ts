import type { ToolOrganization } from '../../lib/organization-tools'
import type { AppSettings } from '../../types'
import type { VmRead, VmReadSet } from './controller'
import type { VmServices } from './services'
import type * as api from './api'
import type { Scoped, Vm, VmDetails, VmMetric, VmManagement } from './model'
import { VmError, vmScope } from './transport'
export type VmSnapshot = {
    inventory: Scoped<Vm[]> | null; vm: Scoped<Vm> | null; management: Scoped<VmManagement> | null
    platform: Awaited<ReturnType<typeof api.loadPlatformAccess>> | null
    products: Awaited<ReturnType<typeof api.loadProducts>> | null; productsPending: boolean
    details: Scoped<VmDetails | null> | null; metrics: Scoped<VmMetric[]> | null
    organizations: ToolOrganization[] | null; errors: string[]; reads: VmReadSet
}
export const emptySnapshot = (): VmSnapshot => ({ inventory: null, vm: null, management: null, platform: null, products: null, productsPending: false, details: null, metrics: null, organizations: null, errors: [],
    reads: { inventory: false, target: false, management: false, platform: false, products: false, details: false, services: false } })
export function preserveVmSnapshot(previous: VmSnapshot, partial: VmSnapshot): VmSnapshot {
    return {
        ...partial,
        inventory: partial.inventory ?? previous.inventory,
        vm: partial.vm ?? previous.vm,
        management: partial.management ?? previous.management,
        platform: partial.platform ?? previous.platform,
        products: partial.products ?? previous.products,
        details: partial.details ?? previous.details,
        metrics: partial.metrics ?? previous.metrics,
        organizations: partial.organizations ?? previous.organizations,
    }
}
function canReuseWorkspaceReads(settings: AppSettings, previous: VmSnapshot | undefined, target: string) {
    if (!previous?.inventory || !previous.reads.inventory || previous.inventory.scope !== vmScope(settings)) return false
    if (!previous.inventory.value.some(vm => vm.name.toLowerCase() === target.toLowerCase())) return false
    if (!previous.platform || previous.platform.scope !== vmScope(settings) || previous.organizations === null) return false
    return true
}
export const safeVmMessage = (error: unknown) => error instanceof VmError && error.name !== 'AbortError' ? error.message : 'This VM information is unavailable. Refresh to try again.'
function mergeVmRecord(current: Vm, incoming: Vm): Vm {
    const merged = { ...current }
    for (const key of Object.keys(merged) as (keyof Vm)[]) {
        const currentValue = current[key], incomingValue = incoming[key]
        const currentHasValue = currentValue !== null && currentValue !== '' && (!Array.isArray(currentValue) || currentValue.length > 0)
        const incomingHasValue = incomingValue !== null && incomingValue !== '' && (!Array.isArray(incomingValue) || incomingValue.length > 0)
        if (!currentHasValue && incomingHasValue) Object.assign(merged, { [key]: incomingValue })
    }
    return merged
}
// A failed supplemental read stays unavailable. It never becomes a fabricated empty list or permission.
export async function readVmWorkspace(settings: AppSettings, read: VmRead, services: VmServices, onProgress?: (snapshot: VmSnapshot) => void, previous?: VmSnapshot): Promise<VmSnapshot> {
    const result = emptySnapshot(), signal = read.signal
    const publish = () => {
        if (!signal.aborted) onProgress?.({ ...result, errors: [...result.errors], reads: { ...result.reads } })
    }
    const take = async <T>(run: () => Promise<T>, accept: (value: T) => void) => {
        try { const value = await run(); if (!signal.aborted) accept(value) }
        catch (error) { if (!signal.aborted) result.errors.push(safeVmMessage(error)) }
        publish()
    }
    const hasTarget = !!read.target && read.kind !== 'stop_all' && read.kind !== 'setup_plan'
    const reuseWorkspace = hasTarget && canReuseWorkspaceReads(settings, previous, read.target)
    if (reuseWorkspace && previous) {
        result.inventory = previous.inventory
        result.platform = previous.platform
        result.products = previous.products
        result.organizations = previous.organizations
        result.reads.inventory = true
        result.reads.platform = previous.reads.platform
        result.reads.products = !!previous.products?.value.plans.some(plan => plan.id === 'failover')
            && !!previous.products.value.containers.some(vm => vm.name === read.target)
    }
    const inventories: { owned: Scoped<Vm[]> | null; accessible: Scoped<Vm[]> | null } = { owned: null, accessible: null }
    let inventoryRequestsSettled = 0
    const takeInventory = async (source: keyof typeof inventories, load: () => Promise<Scoped<Vm[]>>) => {
        try {
            const inventory = await load()
            if (!signal.aborted) inventories[source] = inventory
        } catch (error) {
            if (!signal.aborted) result.errors.push(safeVmMessage(error))
        } finally {
            inventoryRequestsSettled++
            if (!signal.aborted) {
                const available = [inventories.owned, inventories.accessible].filter((inventory): inventory is Scoped<Vm[]> => inventory !== null)
                if (available.length) {
                    const rows = new Map<string, Vm>()
                    for (const inventory of available) for (const vm of inventory.value) {
                        const identity = vm.name.toLowerCase(), current = rows.get(identity)
                        rows.set(identity, current ? mergeVmRecord(current, vm) : vm)
                    }
                    result.inventory = { ...(inventories.owned ?? inventories.accessible!), value: [...rows.values()] }
                }
                result.reads.inventory = inventoryRequestsSettled === 2 && inventories.owned !== null && inventories.accessible !== null
                publish()
            }
        }
    }

    const targetAvailable = !hasTarget
    result.reads.target = targetAvailable
    // Failover pricing is only an optional checkout affordance. Keep it off the
    // critical path so a slow billing read cannot hold the VM controls locked.
    const shouldLoadProducts = hasTarget && (!reuseWorkspace || !previous?.products) && !settings.impersonationToken && !settings.impersonatingUserId
    result.productsPending = shouldLoadProducts
    const productsPending = shouldLoadProducts
        ? take(() => services.loadProducts(settings, signal), value => {
            result.products = value
            result.reads.products = value.value.plans.some(plan => plan.id === 'failover') && value.value.containers.some(vm => vm.name === read.target)
        }).finally(() => { if (!signal.aborted) { result.productsPending = false; publish() } })
        : undefined
    await Promise.all([
        ...(!reuseWorkspace ? [
            takeInventory('owned', () => services.loadInventory(settings, signal)),
            takeInventory('accessible', () => services.loadAccessibleInventory(settings, signal)),
            take(() => services.loadPlatformAccess(settings, signal), value => { result.platform = value; result.reads.platform = value.value.canEdit }),
            take(() => services.organizations(settings, signal), value => { result.organizations = value }),
        ] : []),
        ...(hasTarget ? [
            take(() => services.loadVm(settings, read.target, signal), value => { result.vm = value; result.reads.target = true }),
            take(() => services.loadPublicServices(settings, read.target, signal), value => { result.management = value; result.reads.management = value.value.canManage; result.reads.services = true }),
            take(() => services.loadDetails(settings, read.target, signal), value => { result.details = value; result.reads.details = true }),
            take(() => services.loadMetrics(settings, read.target, signal), value => { result.metrics = value }),
        ] : []),
    ])
    // take() handles errors and publishes the result when pricing arrives.
    // Do not wait for it here; checkout performs its own fresh eligibility read.
    void productsPending
    return result
}
