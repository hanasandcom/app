import type { ToolOrganization } from '../../lib/organization-tools'
import type { AppSettings } from '../../types'
import type { VmRead, VmReadSet } from './controller'
import type { VmServices } from './services'
import type * as api from './api'
import type { Scoped, Vm, VmDetails, VmMetric, VmManagement } from './model'
export type VmSnapshot = {
    inventory: Scoped<Vm[]> | null; vm: Scoped<Vm> | null; management: Scoped<VmManagement> | null
    platform: Awaited<ReturnType<typeof api.loadPlatformAccess>> | null
    products: Awaited<ReturnType<typeof api.loadProducts>> | null
    details: Scoped<VmDetails | null> | null; metrics: Scoped<VmMetric[]> | null
    organizations: ToolOrganization[] | null; errors: string[]; reads: VmReadSet
}
export const emptySnapshot = (): VmSnapshot => ({ inventory: null, vm: null, management: null, platform: null, products: null, details: null, metrics: null, organizations: null, errors: [],
    reads: { inventory: false, target: false, management: false, platform: false, products: false, details: false, services: false } })
export const safeVmMessage = (error: unknown) => error instanceof Error && error.name !== 'AbortError' && error.message.startsWith('VM ') ? error.message : 'This VM information is unavailable. Refresh to try again.'
// A failed supplemental read stays unavailable. It never becomes a fabricated empty list or permission.
export async function readVmWorkspace(settings: AppSettings, read: VmRead, services: VmServices, onProgress?: (snapshot: VmSnapshot) => void): Promise<VmSnapshot> {
    const result = emptySnapshot(), signal = read.signal
    const publish = () => {
        if (!signal.aborted) onProgress?.({ ...result, errors: [...result.errors], reads: { ...result.reads } })
    }
    const take = async <T>(run: () => Promise<T>, accept: (value: T) => void) => {
        try { const value = await run(); if (!signal.aborted) accept(value) }
        catch (error) { if (!signal.aborted) result.errors.push(safeVmMessage(error)) }
        publish()
    }
    const inventories: Scoped<Vm[]>[] = []
    let inventoryRequestsSettled = 0
    const takeInventory = async (load: () => Promise<Scoped<Vm[]>>) => {
        try {
            const inventory = await load()
            if (!signal.aborted) inventories.push(inventory)
        } catch (error) {
            if (!signal.aborted) result.errors.push(safeVmMessage(error))
        } finally {
            inventoryRequestsSettled++
            if (!signal.aborted) {
                if (inventories.length) {
                    const rows = new Map<string, Vm>()
                    for (const inventory of inventories) for (const vm of inventory.value) if (!rows.has(vm.name)) rows.set(vm.name, vm)
                    result.inventory = { ...inventories[0], value: [...rows.values()] }
                }
                result.reads.inventory = inventoryRequestsSettled === 2 && inventories.length === 2
                publish()
            }
        }
    }

    const targetAvailable = !read.kind || read.kind === 'setup_plan'
    const hasTarget = !!read.target && read.kind !== 'stop_all' && read.kind !== 'setup_plan'
    result.reads.target = targetAvailable
    await Promise.all([
        takeInventory(() => services.loadInventory(settings, signal)),
        takeInventory(() => services.loadAccessibleInventory(settings, signal)),
        take(() => services.loadPlatformAccess(settings, signal), value => { result.platform = value; result.reads.platform = value.value.canEdit }),
        take(() => services.organizations(settings, signal), value => { result.organizations = value }),
        ...(!settings.impersonationToken && !settings.impersonatingUserId ? [take(() => services.loadProducts(settings, signal), value => {
            result.products = value
            result.reads.products = value.value.plans.some(plan => plan.id === 'failover') && value.value.containers.some(vm => vm.name === read.target)
        })] : []),
        ...(hasTarget ? [
            take(() => services.loadVm(settings, read.target, signal), value => { result.vm = value; result.reads.target = true }),
            take(() => services.loadPublicServices(settings, read.target, signal), value => { result.management = value; result.reads.management = value.value.canManage; result.reads.services = true }),
            take(() => services.loadDetails(settings, read.target, signal), value => { result.details = value; result.reads.details = true }),
            take(() => services.loadMetrics(settings, read.target, signal), value => { result.metrics = value }),
        ] : []),
    ])
    return result
}
