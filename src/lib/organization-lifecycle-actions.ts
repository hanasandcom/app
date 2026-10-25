export type OrganizationLifecycleAction = 'archive' | 'reactivate' | 'delete'

/** Fail closed when lifecycle state is missing or malformed. */
export function organizationLifecycleActions(status?: string | null): OrganizationLifecycleAction[] {
    switch (status?.toLowerCase()) {
        case 'active': return ['archive', 'delete']
        case 'archived': return ['reactivate', 'delete']
        default: return []
    }
}

export function organizationLifecycleTarget(action: OrganizationLifecycleAction) {
    switch (action) {
        case 'archive': return 'archived' as const
        case 'reactivate': return 'active' as const
        case 'delete': return 'deleted' as const
    }
}
