import type { AppSettings } from '../../types'
import type { VmController, VmOperation } from './controller'
import type { VmServices } from './services'
import type { VmSnapshot } from './read'
import { canCreateVm } from './authority'
import { VmError } from './transport'
export type FreshVm = Pick<VmSnapshot, 'vm' | 'management' | 'platform' | 'products'>
export function acceptsVmResult(ops: VmController, op: VmOperation, settings: AppSettings) { return ops.operationCurrent(op) && ops.sessionCurrent(settings) }
export async function freshVmOperation(settings: AppSettings, services: VmServices, ops: VmController, op: VmOperation): Promise<FreshVm> {
    const ensure = () => { if (!acceptsVmResult(ops, op, settings)) throw new VmError('VM access changed before this action.', 403) }
    const read = async <T>(run: () => Promise<T>) => { ensure(); const result = await run(); ensure(); return result }
    if (['create', 'reprovision', 'setup_plan'].includes(op.kind)) {
        await read(() => services.loadInventory(settings, op.signal))
        if (settings.selectedOrganizationId && settings.selectedOrganizationId !== 'personal') {
            const memberships = await read(() => services.organizations(settings, op.signal))
            if (!canCreateVm(settings, memberships)) throw new VmError('Current active organization owner or admin access is required.', 403)
        }
    }
    const vm = ['create', 'setup_plan', 'stop_all'].includes(op.kind) ? null : await read(() => services.loadVm(settings, op.target, op.signal))
    if (vm?.value.deleted_at && !['restore', 'delete'].includes(op.kind)) throw new VmError('Restore this VM before managing it.', 409)
    const platform = ['delete', 'restore', 'stop_all', 'reprovision'].includes(op.kind) ? await read(() => services.loadPlatformAccess(settings, op.signal)) : null
    if (['delete', 'restore', 'stop_all'].includes(op.kind) && platform?.value.canEdit !== true) throw new VmError('Current Hanasand editing access is required.', 403)
    if (op.kind === 'reprovision') {
        if (vm?.value.owner !== settings.userId && platform?.value.canEdit !== true) throw new VmError('Current VM ownership or Hanasand editing access is required.', 403)
        if ((await read(() => services.loadDetails(settings, op.target, op.signal))).value !== null) throw new VmError('This VM already has stored details and cannot be resumed through creation.', 409)
    }
    const management = vm && !['delete', 'restore', 'checkout', 'assign', 'collect', 'ssh_sync', 'sudo'].includes(op.kind)
        ? await read(() => services.loadPublicServices(settings, op.target, op.signal)) : null
    if (management && !management.value.canManage) throw new VmError('Current permission to manage this VM is required.', 403)
    const products = op.kind === 'checkout' ? await read(() => services.loadProducts(settings, op.signal)) : null
    ensure(); return { vm, management, platform, products }
}
