import type { OrganizationSection } from '../types'

export function organizationSectionForPath(path?: string): OrganizationSection {
    if (path === '/organizations/team') return 'Team'
    if (path === '/organizations/settings') return 'Settings'
    return 'Overview'
}
