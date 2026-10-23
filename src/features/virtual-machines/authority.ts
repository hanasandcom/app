import type { AppSettings } from '../../types'
import type { ToolOrganization } from '../../lib/organization-tools'
import { ownAccount } from './transport'
export function canCreateVm(settings: AppSettings, organizations: ToolOrganization[] | null): boolean {
    if (!ownAccount(settings)) return false
    const selected = settings.selectedOrganizationId
    return !selected || selected === 'personal' || !!organizations?.some(row => row.id === selected && row.status === 'active' && ['owner', 'admin'].includes(row.role))
}
