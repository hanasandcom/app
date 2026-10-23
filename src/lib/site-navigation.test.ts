import { nativeToolForPath } from './native-tool-navigation'
import { describe, expect, it } from 'bun:test'
import { siteNavigation, toggleNavigationGroup, workspacePageDefinition, type SiteNavigationItem } from '../data/site-navigation'

function leaves(items: SiteNavigationItem[]): SiteNavigationItem[] {
    return items.flatMap(item => item.items ? leaves(item.items) : [item])
}

describe('native website navigation', () => {
    it('toggles collapsed top-level menu groups by their unique path key', () => {
        const initial = { Workspace: true, Automation: true }
        const expanded = toggleNavigationGroup(initial, 'Security & intelligence', false)
        expect(expanded).toEqual({ Workspace: true, Automation: true, 'Security & intelligence': true })
        expect(toggleNavigationGroup(expanded, 'Security & intelligence', true)['Security & intelligence']).toBe(false)
    })

    it('lets default-open groups collapse and keeps same-named nested groups independent', () => {
        const initial = { Communication: true, 'Organization/Settings & billing': true }
        const collapsed = toggleNavigationGroup(initial, 'Communication', initial.Communication)
        expect(collapsed.Communication).toBe(false)
        expect(collapsed['Organization/Settings & billing']).toBe(true)
        expect(toggleNavigationGroup(initial, 'Organization/Settings & billing', initial['Organization/Settings & billing'])['Organization/Settings & billing']).toBe(false)
    })

    it('uses both explicit case collections in every investigation and organization view', () => {
        const canonical = workspacePageDefinition('/cases')!.sections
        for (const path of ['/cases', '/organizations/events', '/organizations/activity']) {
            const page = workspacePageDefinition(path)!
            const cases = page.sections.filter(section => section.endpoint.startsWith('api/cases'))
            expect(cases.map(section => section.endpoint)).toEqual(canonical.map(section => section.endpoint))
            expect(cases.map(section => new URL(section.endpoint, 'https://synthetic.invalid').searchParams.get('collection'))).toEqual(['intelligence', 'monitoring'])
            expect(cases[0].cursorParam).toBe('cursor')
            expect(cases[0].cursorPath).toBe('nextCursor')
            expect(page.requiresOrganization).toBe(path === '/cases' ? undefined : true)
        }
    })
    it('resolves each native Tools menu leaf to a distinct registered workflow', () => {
        const visit = (items: ReturnType<typeof siteNavigation>) => {
            for (const item of items) {
                if (item.tab === 'Tools') expect(nativeToolForPath(item.path)).toBeTruthy()
                if (item.items) visit(item.items)
            }
        }
        visit(siteNavigation('synthetic-user'))
        expect(nativeToolForPath('/ti')).toBe('threat-search')
        expect(nativeToolForPath('/pwned')).toBe('password-check')
        expect(nativeToolForPath('/subscription')).toBe('subscription')
        expect(nativeToolForPath('/system/hosts')).toBe('hosts')
        expect(nativeToolForPath('/system/updates')).toBe('host-updates')
        expect(nativeToolForPath('/ti/profiles')).toBe('intel-profiles')
        expect(nativeToolForPath('/findings/actors')).toBe('actors')
        expect(nativeToolForPath('/ti/activity')).toBe('latest-activity')
        expect(nativeToolForPath('/ti/timeliness')).toBe('delivery-health')
        expect(nativeToolForPath('/organizations/api-keys')).toBe('api-keys')
        expect(nativeToolForPath('/management/service-accounts')).toBe('service-accounts')
        for (const category of ['match', 'analysis', 'detection'] as const) {
            expect(nativeToolForPath(`/rules/${category}`)).toBe(`rules-${category}`)
            expect(leaves(siteNavigation('synthetic-user')).find(item => item.path === `/rules/${category}`)?.tab).toBe('Tools')
        }
        expect(nativeToolForPath('/traffic/map')).toBe('traffic-map')
        expect(nativeToolForPath('/traffic')).toBe('traffic-overview')
        expect(nativeToolForPath('/traffic/recent')).toBe('traffic-recent')
        expect(nativeToolForPath('/system/rates')).toBe('rate-limits')
        expect(nativeToolForPath('/db')).toBe('database')
        expect(nativeToolForPath('/db/backups')).toBe('backups')
        expect(nativeToolForPath('/unknown')).toBeUndefined()
        const items = leaves(siteNavigation('synthetic-user'))
        for (const path of ['/ti/profiles', '/ti/timeliness', '/organizations/api-keys']) {
            expect(items.find(item => item.path === path)?.tab).toBe('Tools')
        }
    })
    it('uses the maintained full status API without the public seven-check projection', () => {
        const status = workspacePageDefinition('/status')
        expect(status?.sections.length).toBe(4)
        for (const section of status!.sections) {
            expect(section.endpoint).toBe('api/status?dashboard=true')
            expect(section.origin).toBe('status')
            expect(section.statusFeed).toBe(true)
        }
    })

    it('keeps log dashboard counters separate from paginated search and realtime views', () => {
        for (const path of ['/logs', '/logs/search', '/logs/realtime']) {
            const section = workspacePageDefinition(path)!.sections[0]
            const params = new URL(section.endpoint, 'https://synthetic.invalid/').searchParams
            const dashboard = path === '/logs'
            const realtime = path === '/logs/realtime'
            expect(section.origin).toBe('site')
            expect(params.get('hours')).toBe('24')
            expect(params.get('hql')).toBe(`Logs | take ${realtime ? 100 : 200}`)
            expect(params.get('stats')).toBe(dashboard ? '1' : null)
            expect(params.get('paginate')).toBe(dashboard ? null : '1')
            expect(params.has('stats') && params.has('paginate')).toBe(false)
            expect(params.get('realtime')).toBe(realtime ? '1' : null)
            expect(params.get('severity')).toBe(realtime ? 'high,critical' : null)
            expect(section.cursorPath).toBe(dashboard ? undefined : 'next_cursor')
            expect(section.cursorParam).toBe(dashboard ? undefined : 'cursor')
        }
        expect(workspacePageDefinition('/logs/errors')!.sections[0].endpoint).toBe('api/backend/logs/errors?limit=150')
    })

    it('opens account and workspace tasks in native screens', () => {
        const items = leaves(siteNavigation('account-id'))
        for (const tab of ['Profile', 'Mail', 'Notes', 'Images', 'Organizations', 'Automations']) {
            expect(items.some(item => item.tab === tab && !item.opensWebsite)).toBe(true)
        }
        expect(items.some(item => item.label === 'Utilities')).toBe(false)
        expect(items.find(item => item.path === '/watchlists')?.tab).toBe('Watchlists')
        expect(items.find(item => item.path === '/watchlists')?.opensWebsite).toBeUndefined()
    })

    it('opens native Support queue while Profile keeps personal tickets', () => {
        const item = leaves(siteNavigation('account-id')).find(row => row.path === '/support')
        expect(item?.tab).toBe('Tools')
        expect(nativeToolForPath('/support')).toBe('support-desk')
        expect(item?.opensWebsite).toBeUndefined()
    })

    it('marks pages without a native workflow as website links', () => {
        const items = leaves(siteNavigation('account-id'))
        expect(items.filter(item => item.opensWebsite).some(item => item.path === '/sandbox' || item.path === '/scanner')).toBe(false)
        expect(items.find(item => item.path === '/sandbox')?.opensWebsite).toBeUndefined()
        expect(items.find(item => item.path === '/scanner')?.opensWebsite).toBeUndefined()
        expect(items.find(item => item.path === '/sandbox')?.tab).toBe('Tools')
        expect(items.find(item => item.path === '/scanner')?.tab).toBe('Tools')
        expect(nativeToolForPath('/sandbox')).toBe('sandbox')
        expect(nativeToolForPath('/scanner')).toBe('security-scanner')
        expect(nativeToolForPath('/findings/actors')).toBe('actors')
        expect(items.find(item => item.path === '/ti/activity')?.tab).toBe('Tools')
        expect(items.find(item => item.path === '/ti/activity')?.opensWebsite).toBeUndefined()
        for (const item of items.filter(item => !item.tab && !workspacePageDefinition(item.path || ''))) {
            expect(item.opensWebsite).toBe(true)
        }
    })
    it('keeps native viewport routes inside the app', () => {
        const items = leaves(siteNavigation('account-id'))
        for (const path of ['/sandbox', '/scanner']) expect(items.find(item => item.path === path)?.tab).toBe('Tools')
    })
    it('opens the existing CDN blocklist API in the native traffic workflow', () => {
        const item = leaves(siteNavigation('account-id')).find(row => row.path === '/traffic/blocklist')
        expect(item?.tab).toBe('Tools')
        expect(item?.opensWebsite).toBeUndefined()
        expect(nativeToolForPath('/traffic/blocklist')).toBe('traffic-blocklist')
    })
    it('opens the authenticated TI collection history natively', () => {
        const item = leaves(siteNavigation('account-id')).find(row => row.path === '/ti/runs')
        expect(item?.tab).toBe('Tools')
        expect(item?.opensWebsite).toBeUndefined()
        expect(nativeToolForPath('/ti/runs')).toBe('ti-runs')
    })
    it('opens the authenticated TI source inventory natively', () => {
        const item = leaves(siteNavigation('account-id')).find(row => row.path === '/ti/sources')
        expect(item?.tab).toBe('Tools')
        expect(item?.opensWebsite).toBeUndefined()
        expect(nativeToolForPath('/ti/sources')).toBe('ti-sources')
    })
})

it('keeps delivery history separate from destination configuration and registers new menu jobs', () => {
    const items = leaves(siteNavigation('synthetic-user'))
    for (const [path, tool] of Object.entries({ '/findings/actions': 'delivery-history', '/findings/delivery': 'integrations', '/system/ai': 'ai-metrics', '/management/organizations': 'organization-directory' } as const)) {
        expect(nativeToolForPath(path)).toBe(tool)
        expect(items.some(item => item.path === path && item.tab === 'Tools' && !item.opensWebsite)).toBe(true)
    }
    expect(items.find(item => item.label === 'Delivery')?.path).toBe('/findings/actions')
    expect(items.find(item => item.label === 'Integrations')?.path).toBe('/findings/delivery')
    expect(items.find(item => item.label === 'Security Scanner')?.path).toBe('/scanner')
    expect(items.some(item => item.label === 'Vulnerabilities')).toBe(false)
})

it('registers Findings investigation, Rule Tuning, API reference and complete JSON as native jobs', () => {
    const items = leaves(siteNavigation('synthetic-user'))
    for (const [path, tool] of Object.entries({ '/findings': 'findings', '/rules/tuning': 'rule-tuning', '/api': 'api-reference', '/api/openapi': 'openapi-json' } as const)) {
        expect(nativeToolForPath(path)).toBe(tool)
        expect(items.some(item => item.path === path && item.tab === 'Tools' && !item.opensWebsite)).toBe(true)
    }
})

it('opens management Users in the native directory workflow', () => {
    const item = leaves(siteNavigation('synthetic-user')).find(row => row.path === '/management/users')
    expect(item?.tab).toBe('Tools')
    expect(item?.opensWebsite).toBeUndefined()
    expect(nativeToolForPath(item?.path)).toBe('user-management')
})

it('shares the native load-test workflow between its public and administration menu paths', () => {
    const items = leaves(siteNavigation('synthetic-user'))
    for (const path of ['/test', '/load-testing']) {
        expect(items.find(item => item.path === path)?.tab).toBe('Tools')
        expect(nativeToolForPath(path)).toBe('load-tests')
    }
})

it('opens Thesis in its native shared document workflow', () => {
    const item = leaves(siteNavigation('synthetic-user')).find(row => row.path === '/thesis')
    expect(item?.tab).toBe('Tools')
    expect(item?.opensWebsite).toBeUndefined()
    expect(nativeToolForPath(item?.path)).toBe('thesis')
})

it('opens organization privacy in its native retention workflow', () => {
    const item = leaves(siteNavigation('synthetic-user')).find(row => row.path === '/organizations/privacy')
    expect(item?.tab).toBe('Tools')
    expect(item?.opensWebsite).toBeUndefined()
    expect(nativeToolForPath(item?.path)).toBe('organization-privacy')
})

it('opens Articles and Thoughts in their native editorial workflows', () => {
    const items = leaves(siteNavigation('synthetic-user'))
    for (const [path, tool] of Object.entries({ '/content/articles': 'articles', '/content/thoughts': 'thoughts' } as const)) {
        const item = items.find(row => row.path === path)
        expect(item?.tab).toBe('Tools')
        expect(item?.opensWebsite).toBeUndefined()
        expect(nativeToolForPath(item?.path)).toBe(tool)
    }
})

it('opens System and Containers in their native runtime workflows', () => {
    const items = leaves(siteNavigation('synthetic-user'))
    for (const [path, tool] of Object.entries({ '/system': 'system-overview', '/system/containers': 'system-containers' } as const)) {
        expect(nativeToolForPath(path)).toBe(tool)
        expect(items.find(item => item.path === path)?.tab).toBe('Tools')
    }
})

it('opens the registered monitoring case workflow while keeping both collection contracts explicit', () => {
    expect(nativeToolForPath('/cases')).toBe('monitoring-cases')
    expect(leaves(siteNavigation('synthetic-user')).find(item => item.path === '/cases')?.tab).toBe('Tools')
    expect(workspacePageDefinition('/cases')?.sections).toHaveLength(2)
})

it('fresh case and health handoffs remount even when the requested ID repeats', async () => {
    // Model the native screen remount boundary: local selection B must not survive a new request for A.
    let nonce = 0, mountedKey = '', selection = ''
    const handoff = (id: string) => {
        const key = JSON.stringify([id, ++nonce])
        if (key !== mountedKey) { mountedKey = key; selection = id }
    }
    expect(selection).toBe('')
    handoff('A'); expect(selection).toBe('A')
    selection = 'B'; expect(selection).toBe('B')
    handoff('A')
    expect(selection).toBe('A')
    expect(nonce).toBe(2)
    const app = await Bun.file(new URL('../App.tsx', import.meta.url)).text()
    expect(app).toContain('handoffId: ++navigationHandoff.current')
    expect(app).toContain('key={JSON.stringify([route.params?.automationId, route.params?.handoffId])}')
    expect(app).toContain('key={JSON.stringify([route.params.tool, route.params.caseId, route.params.handoffId])}')
    const health = app.slice(app.indexOf('function openHealthCheck'), app.indexOf('function openMonitoredActors'))
    expect(health.indexOf('sessionTransition.current')).toBeLessThan(health.indexOf('navigation.navigate'))
    expect(app).toContain('onOpenHealthCheck={openHealthCheck}')
    expect(app).toContain('automationId: undefined, handoffId: undefined')
})


it('both VM menu paths and the System fallback use the native VM workflow', async () => {
    for (const path of ['/vms', '/system/virtual-machines']) {
        expect(nativeToolForPath(path)).toBe('virtual-machines')
        expect(leaves(siteNavigation('synthetic-user')).find(item => item.path === path)?.tab).toBe('Tools')
    }
    const app = await Bun.file(new URL('../App.tsx', import.meta.url)).text()
    expect(app).toContain('onOpenVms={openVms}')
    const open = app.slice(app.indexOf('function openVms()'), app.indexOf('async function openVmCheckout'))
    expect(open.indexOf('sessionTransition.current')).toBeLessThan(open.indexOf('navigation.navigate'))
    expect(app).toContain('onOpenVmCheckout={openVmCheckout}')
})
