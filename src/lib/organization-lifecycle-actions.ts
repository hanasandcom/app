export type OrganizationLifecycleAction = 'archive' | 'reactivate' | 'delete'

/** Fail closed when lifecycle state is missing or malformed. */
export function organizationLifecycleActions(status?: string | null): OrganizationLifecycleAction[] {
    switch (status?.toLowerCase()) {
        case 'active': return ['archive', 'delete']
        case 'archived': return ['reactivate', 'delete']
        default: return []
    }
}
