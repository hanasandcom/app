import type { RootTabParamList } from '../types'

export type NavigationItem = {
    label: string
    href?: string
    items?: NavigationItem[]
    visible?: boolean
}

export type NavigationAccess = {
    id: string
    canManageOrganizations?: boolean
    canViewInternalPages?: boolean
    hasContentOrganization?: boolean
    hasHanasandOrganization?: boolean
    thesisSheets?: Array<{ label: string, href: string }>
    hasVMs?: boolean
    canReviewIntel?: boolean
}

function getDashboardNavigation(access: NavigationAccess): NavigationItem[] {
    const {
        id,
        hasContentOrganization = false,
        hasHanasandOrganization = false,
        thesisSheets = [],
        hasVMs = false,
    } = access
    const isAdmin = access.canViewInternalPages === true
    const canManageContent = access.canViewInternalPages === true
    const canManageOrganizations = access.canManageOrganizations === true
    const canManageSystem = access.canViewInternalPages === true
    const canReviewIntel = access.canReviewIntel === true || access.canViewInternalPages === true
    const link = (label: string, href: string, visible = true): NavigationItem => ({ label, href, visible })
    const group = (label: string, items: NavigationItem[], visible = true): NavigationItem => ({ label, items, visible })
    const sections = [
        group('Security & intelligence', [
            group('Investigations', [
                link('Cases', '/cases'),
                link('Threat Search', '/ti'),
            ]),
            group('Intelligence', [
                link('Latest Activity', '/ti/activity', isAdmin),
                link('Actors', '/findings/actors'),
                link('Actor Profiles', '/ti/profiles', isAdmin),
            ]),
            group('Monitoring', [
                link('Watchlists', '/watchlists'),
                link('Findings', '/findings'),
                link('Delivery', '/findings/actions'),
                link('Virtual Machines', '/system/virtual-machines', hasVMs),
                link('Repositories', '/repositories'),
            ]),
            group('Collection', [
                link('Feeds', '/ti/sources', isAdmin),
                link('Collection', '/ti/runs', isAdmin),
                link('Delivery Health', '/ti/timeliness', canReviewIntel),
            ]),
            group('Security tools', [
                link('Sandbox', '/sandbox'),
                link('Security Scanner', canManageSystem ? '/scanner' : '/solutions/scanner'),
                link('Check Password', '/pwned'),
                link('Load test', '/test'),
            ]),
        ]),
        group('Logs & rules', [
            group('Logs', [
                link('Log Dashboard', '/logs', canManageSystem),
                link('Realtime', '/logs/realtime', canManageSystem),
                link('Search', '/logs/search', canManageSystem),
                link('Errors', '/logs/errors', canManageSystem),
            ]),
            group('Traffic', [
                link('Overview', '/traffic', canManageSystem),
                link('Recent traffic', '/traffic/recent', canManageSystem),
                link('Live map', '/traffic/map', canManageSystem),
                link('Blocklist', '/traffic/blocklist', canManageSystem),
            ]),
            group('Rules', [
                link('Match Rules', '/rules/match'),
                link('Analysis Rules', '/rules/analysis'),
                link('Detection Rules', '/rules/detection'),
                link('Tuning', '/rules/tuning', canManageSystem),
            ]),
        ]),
        group('Infrastructure', [
            group('System', [
                link('Overview', '/system'),
                link('Containers', '/system/containers'),
                link('Hosts', '/system/hosts', isAdmin),
            ]),
            group('Compute', [
                link('Virtual Machines', '/vms', hasVMs),
                link('Host Updates', '/system/updates', isAdmin),
            ]),
            group('Health', [
                link('AI Metrics', '/system/ai', canManageSystem),
                link('Vulnerabilities', '/vulnerabilities', canManageSystem),
                link('Rate Limits', '/system/rates', isAdmin),
                link('Load Testing', '/load-testing', canManageSystem),
            ]),
            group('Data management', [
                link('Database', '/db', isAdmin),
                link('Backups', '/db/backups', isAdmin),
            ]),
        ]),
        group('Automation', [
            link('Health Checks', '/automation/health'),
            link('Cron Jobs', '/automation/cron'),
        ]),
        group('Content', [
            group('Writing', [
                link('Notes', '/notes', canManageContent || hasContentOrganization),
                link('Articles', '/content/articles', canManageContent || hasContentOrganization),
                link('Thoughts', '/content/thoughts', canManageContent || hasContentOrganization),
            ]),
            group('Media', [
                link('Gallery', '/gallery'),
                link('Uploads', '/upload'),
            ]),
            nestedGroup('Thesis', thesisSheets.length
                ? thesisSheets.map(sheet => link(sheet.label, sheet.href))
                : [link('Overview', '/thesis')], hasHanasandOrganization),
        ]),
        group('Communication', [
            link('Mail', '/mail'),
            link('Support Chats', '/support'),
        ]),
        group('Organization', [
            link('Overview', '/organizations'),
            group('Settings & billing', [
                link('Organization Settings', '/organizations/settings'),
                link('Privacy & Retention', '/organizations/privacy'),
                link('Subscription', '/subscription'),
            ]),
            group('Access & credentials', [
                link('Team', '/organizations/team'),
                link('API Keys', '/organizations/api-keys'),
                link('Service Accounts', '/management/service-accounts', isAdmin),
            ]),
            group('Integrations', [
                link('Integrations', '/findings/delivery'),
            ]),
            group('Monitoring & activity', [
                link('Events & Cases', '/organizations/events'),
                link('Activity', '/organizations/activity'),
            ]),
        ]),
        group('Administration', [
            link('Organizations', '/management/organizations', canManageOrganizations),
            link('Users', '/management/users', isAdmin),
        ]),
        group('Resources', [link('API Docs', '/api'), link('OpenAPI JSON', '/api/openapi')]),
        group('Account', [
            link('Profile', `/profile/${id}`),
            link('Security', `/profile/${id}/security`),
            link('Sessions', `/profile/${id}/sessions`),
            link('SSH Keys', `/profile/${id}/ssh-keys`),
            link('Tickets', `/profile/${id}/support`),
        ]),
    ]
    function nestedGroup(label: string, items: NavigationItem[], visible = true): NavigationItem {
        if (items.length <= 5) return group(label, items, visible)
        return group(label, [...items.slice(0, 4), nestedGroup('More sheets', items.slice(4))], visible)
    }
    const permitted = (items: NavigationItem[]): NavigationItem[] => items
        .filter(item => item.visible !== false)
        .map(item => item.items ? { ...item, items: permitted(item.items) } : item)
        .filter(item => !item.items || item.items.length > 0)
    return permitted(sections)
}


export type WorkspaceField = [label: string, path: string, format?: 'bytes' | 'percent' | 'date' | 'masked' | 'updates']
export type WorkspaceSection = {
    label: string
    endpoint: string
    origin?: 'site' | 'status'
    listPath?: string
    titlePath?: string
    fields: WorkspaceField[]
    detailEndpoint?: string
    detailKey?: string
    detailObjectPath?: string
    detailTreePath?: string
    detailFields?: WorkspaceField[]
    searchParam?: string
    cursorPath?: string
    cursorParam?: string
    statusFeed?: boolean
}
export type WorkspacePageDefinition = { path: string; requiresOrganization?: boolean; sections: WorkspaceSection[] }
const vmFields: WorkspaceField[] = [['Status', 'status'], ['Reason', 'status_reason'], ['Host', 'primary_host'], ['System', 'config_image_description|config_image_os'], ['CPU cores', 'limits_cpu'], ['Memory', 'limits_memory'], ['IPv4', 'device_eth0_ipv4_address'], ['Created', 'created', 'date'], ['Last used', 'last_used', 'date']]
const fileFields: WorkspaceField[] = [['Name', 'path|filename|alias|id'], ['Owner', 'owner'], ['Updated', 'timestamp|updated_at|updated|last_updated', 'date'], ['Content', 'content']]
const logFields: WorkspaceField[] = [['Service', 'service|normalized.service'], ['Level', 'level|normalized.level|normalized.severity'], ['Message', 'message|normalized.message'], ['Host', 'host|normalized.host'], ['Time', 'created_at|event_timestamp', 'date'], ['Source', 'source']]
const eventFields: WorkspaceField[] = [['Status', 'status'], ['Severity', 'severity'], ['Summary', 'summary|description'], ['Created', 'createdAt|firstSeenAt|alertedAt', 'date'], ['Updated', 'updatedAt', 'date']]
const definitions: WorkspacePageDefinition[] = [
    { path: '/system', sections: [
        { label: 'Host', endpoint: 'system/snapshot', titlePath: 'systemTelemetry.system.os', fields: [['Operating system', 'systemTelemetry.system.os'], ['Load', 'systemTelemetry.system.load'], ['Memory used', 'systemTelemetry.system.memory.used', 'bytes'], ['Memory total', 'systemTelemetry.system.memory.total', 'bytes'], ['Memory usage', 'systemTelemetry.system.memory.percent', 'percent'], ['Disk', 'systemTelemetry.system.disk'], ['Temperature', 'systemTelemetry.system.temperature'], ['Processes', 'systemTelemetry.system.processes'], ['Updated', 'generated_at', 'date']] },
    ] },
    { path: '/system/containers', sections: [{ label: 'Containers', endpoint: 'docker', listPath: 'containers', titlePath: 'name', fields: [['Image', 'image'], ['State', 'state'], ['Status', 'status'], ['Health', 'health'], ['CPU', 'stats.cpu_percent|cpu', 'percent'], ['Memory', 'stats.memory_bytes|memory', 'bytes'], ['Restarts', 'restart_count'], ['Created', 'created_at', 'date']] }] },
    ...['/vms', '/system/virtual-machines'].map(path => ({ path, sections: [{ label: 'Virtual machines', endpoint: 'vms/:userId', listPath: '', titlePath: 'name', fields: vmFields }] })),
    { path: '/status', sections: [
        // Use the same standalone monitoring feed as the website; the old API snapshot is retired.
        { label: 'Overview', endpoint: 'api/status?dashboard=true', origin: 'status', statusFeed: true, fields: [['Overall', 'overall'], ['Monitoring', 'monitoring'], ['Last verified', 'last_verified_at|generated_at', 'date'], ['History available', 'history_available']] },
        { label: 'Service checks', endpoint: 'api/status?dashboard=true', origin: 'status', statusFeed: true, listPath: 'checks', titlePath: 'check_name', fields: [['Service', 'service'], ['Status', 'status'], ['Latency (ms)', 'latency_ms'], ['Message', 'message'], ['90 day uptime', 'uptime_90d'], ['Checked', 'checked_at', 'date']] },
        { label: 'Incidents', endpoint: 'api/status?dashboard=true', origin: 'status', statusFeed: true, listPath: 'incidents', titlePath: 'title', fields: [['Service', 'service'], ['Status', 'status'], ['Impact', 'impact'], ['Started', 'started_at', 'date'], ['Resolved', 'resolved_at', 'date'], ['Summary', 'summary']], detailEndpoint: 'api/status?incident=:id', detailObjectPath: 'incidents', detailFields: [['Status', 'status'], ['Service', 'service'], ['Check', 'check_name'], ['Started', 'started_at', 'date'], ['Resolved', 'resolved_at', 'date'], ['Summary', 'summary'], ['Cause', 'cause'], ['Updates', 'updates', 'updates']] },
        { label: 'Daily history', endpoint: 'api/status?dashboard=true', origin: 'status', statusFeed: true, listPath: 'history', titlePath: 'check_name', fields: [['Service', 'service'], ['Day', 'date'], ['Status', 'status'], ['Samples', 'samples'], ['Healthy', 'healthy_samples'], ['Degraded', 'degraded_samples'], ['Failed', 'failed_samples'], ['Incidents', 'incident_ids']] },
    ] },
    { path: '/cases', sections: [
        { label: 'Intelligence cases', endpoint: 'api/cases?collection=intelligence&page=1', origin: 'site', listPath: 'items|cases', titlePath: 'title', fields: [...eventFields, ['Owner', 'assignedOwner'], ['Review', 'reviewState']], cursorPath: 'nextCursor', cursorParam: 'cursor' },
        { label: 'Monitoring cases', endpoint: 'api/cases?collection=monitoring&view=summary', origin: 'site', listPath: 'items|cases', titlePath: 'title', fields: [...eventFields, ['Priority', 'priority'], ['Owner', 'assignedOwner']] },
    ] },
    { path: '/repositories', sections: [
        { label: 'Repositories', endpoint: 'projects/user/:userId', listPath: '', titlePath: 'alias', fields: [['Owner', 'owner'], ['Files', 'file_count'], ['Size', 'total_size', 'bytes'], ['Updated', 'last_updated', 'date']], detailEndpoint: 'project/:id', detailKey: 'alias', detailObjectPath: 'share', detailTreePath: 'tree', detailFields: fileFields },
        { label: 'Files', endpoint: 'share/user/:userId', listPath: '', titlePath: 'path|filename|alias|id', fields: fileFields, detailEndpoint: 'share/:id', detailKey: 'id' },
    ] },
    { path: '/content/articles', sections: [{ label: 'Articles', endpoint: 'articles?workspace=true', listPath: '', titlePath: 'title', fields: [['Created', 'created', 'date'], ['Updated', 'modified', 'date'], ['Size', 'size', 'bytes']], detailEndpoint: 'article/:id', detailKey: 'id', detailFields: [['Title', 'title'], ['Updated', 'modified', 'date'], ['Article', 'content']] }] },
    { path: '/content/thoughts', sections: [{ label: 'Thoughts', endpoint: 'thoughts?workspace=true', listPath: '', titlePath: 'title', fields: [['Created', 'created_at|created', 'date'], ['Updated', 'updated_at|modified', 'date'], ['Thought', 'content|body']] }] },
    ...['/logs', '/logs/realtime', '/logs/search'].map(path => ({ path, sections: [{ label: path === '/logs/realtime' ? 'Recent high severity logs' : 'Logs', endpoint: `api/backend/logs/search?hours=24&hql=Logs%20%7C%20take%20200&paginate=1${path === '/logs/realtime' ? '&realtime=1&severity=high,critical' : path === '/logs' ? '&stats=1' : ''}`, origin: 'site' as const, listPath: 'rows', titlePath: 'normalized.message|id', fields: logFields, searchParam: 'search', cursorPath: 'next_cursor', cursorParam: 'cursor' }] })),
    { path: '/logs/errors', sections: [{ label: 'Errors', endpoint: 'api/backend/logs/errors?limit=150', origin: 'site', listPath: 'errors', titlePath: 'message|error_code', fields: [...logFields, ['Status code', 'status_code'], ['Path', 'path'], ['Error code', 'error_code']] }] },
    ...['match', 'analysis', 'detection'].map(category => ({ path: `/rules/${category}`, requiresOrganization: true, sections: [{ label: `${category[0].toUpperCase()}${category.slice(1)} rules`, endpoint: `rules?view=list&category=${category}`, listPath: 'rules', titlePath: 'name|id', fields: [['Description', 'description'], ['Enabled', 'enabled'], ['Matches', 'hitCount'], ['Updated', 'updatedAt|updated_at', 'date']] as WorkspaceField[], detailEndpoint: 'rules/:id', detailKey: 'id', detailObjectPath: 'rule', detailFields: [['Name', 'name'], ['Description', 'description'], ['Enabled', 'enabled'], ['Stage', 'definition.stage'], ['Action', 'definition.action'], ['Query', 'definition.query']] as WorkspaceField[] }] })),
    { path: '/watchlists', requiresOrganization: true, sections: [{ label: 'Watchlists', endpoint: 'organizations/:organizationId/watchlists', listPath: 'watchlistItems', titlePath: 'value', fields: [['Kind', 'kind'], ['Status', 'status'], ['Notes', 'notes'], ['Tags', 'tags'], ['Created', 'createdAt', 'date'], ['Updated', 'updatedAt', 'date']] }] },
    { path: '/organizations/api-keys', requiresOrganization: true, sections: [{ label: 'API keys', endpoint: 'organizations/:organizationId/api-keys', listPath: 'apiKeys', titlePath: 'name', fields: [['Prefix', 'keyPrefix|key_prefix', 'masked'], ['Enabled', 'enabled'], ['Expires', 'expiresAt|expires_at', 'date'], ['Last used', 'lastUsedAt|last_used_at', 'date']] }] },
    { path: '/organizations/privacy', requiresOrganization: true, sections: [
        { label: 'Retention', endpoint: 'organizations/:organizationId/privacy', fields: [['Organization', 'organization.name'], ['Status', 'organization.status'], ['Retention days', 'organization.retention_days'], ['Protected events', 'protection.protected_events'], ['Protected evidence', 'protection.explanation']] },
        { label: 'Retention runs', endpoint: 'organizations/:organizationId/privacy', listPath: 'runs', titlePath: 'trigger_type|id', fields: [['Status', 'status'], ['Created', 'created_at', 'date'], ['Completed', 'completed_at', 'date'], ['Error', 'error']] },
        { label: 'Privacy requests', endpoint: 'organizations/:organizationId/privacy', listPath: 'requests', titlePath: 'request_type|id', fields: [['Status', 'status'], ['Requested', 'requested_at', 'date'], ['Completed', 'completed_at', 'date']] },
    ] },
    { path: '/organizations/events', requiresOrganization: true, sections: [
        { label: 'Events', endpoint: 'api/findings/alerts', origin: 'site', listPath: 'alerts|items|results', titlePath: 'title|id', fields: eventFields },
        { label: 'Cases', endpoint: 'api/cases', origin: 'site', listPath: 'cases|items|results', titlePath: 'title|id', fields: eventFields },
    ] },
    { path: '/organizations/activity', requiresOrganization: true, sections: [{ label: 'Recent events', endpoint: 'api/findings/alerts', origin: 'site', listPath: 'alerts|items|results', titlePath: 'title|id', fields: eventFields }, { label: 'Recent cases', endpoint: 'api/cases', origin: 'site', listPath: 'cases|items|results', titlePath: 'title|id', fields: eventFields }] },
]

export function workspacePageDefinition(path: string) {
    const canonical = path === '/shares' ? '/repositories' : path === '/organizations/watchlists' ? '/watchlists' : path
    return definitions.find(page => page.path === canonical)
}
export type SiteNavigationItem = {
    label: string
    path?: string
    tab?: keyof RootTabParamList
    items?: SiteNavigationItem[]
    disabledReason?: string
}

export function siteNavigation(userId: string, access?: Omit<NavigationAccess, 'id'>): SiteNavigationItem[] {
    const tabs: Record<string, keyof RootTabParamList> = { '/': 'Home', '/mail': 'Mail', '/notes': 'Notes', '/gallery': 'Images', '/upload': 'Images', '/scan': 'Scan', '/organizations': 'Organizations', '/organizations/team': 'Organizations', '/organizations/settings': 'Organizations', '/automation/health': 'Automations', '/automation/cron': 'Automations' }
    const convert = (item: NavigationItem): SiteNavigationItem => {
        if (item.items) return { label: item.label, items: item.items.map(convert) }
        const path = item.href || ''
        const tab = path.startsWith(`/profile/${userId}`) ? 'Profile' : tabs[path]
        const supported = tab || workspacePageDefinition(path)
        const area = path.split('/').filter(Boolean)[0] || item.label
        return { label: item.label, path, ...(tab ? { tab } : {}), ...(!supported ? { disabledReason: `${item.label} needs a native ${area} workflow before it can be opened here.` } : {}) }
    }
    const fullAccess = { canManageOrganizations: true, canViewInternalPages: true, hasContentOrganization: true, hasHanasandOrganization: true, hasVMs: true, canReviewIntel: true }
    return [
        { label: 'Workspace', items: [{ label: 'Home', path: '/', tab: 'Home' }, { label: 'Scan documents', path: '/scan', tab: 'Scan' }, { label: 'Service status', path: '/status' }] },
        ...getDashboardNavigation({ id: userId, ...(access ?? fullAccess) }).map(convert),
    ]
}
