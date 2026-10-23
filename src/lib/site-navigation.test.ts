import { nativeToolForPath } from './native-tool-navigation'
import { describe, expect, it } from 'bun:test'
import { siteNavigation, workspacePageDefinition, type SiteNavigationItem } from '../data/site-navigation'

function leaves(items: SiteNavigationItem[]): SiteNavigationItem[] {
    return items.flatMap(item => item.items ? leaves(item.items) : [item])
}

describe('native website navigation', () => {
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
        expect(nativeToolForPath('/ti/timeliness')).toBe('delivery-health')
        expect(nativeToolForPath('/organizations/api-keys')).toBe('api-keys')
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
            expect(items.some(item => item.tab === tab && !item.disabledReason)).toBe(true)
        }
        expect(items.some(item => item.label === 'Utilities')).toBe(false)
        expect(items.find(item => item.path === '/watchlists')?.tab).toBe('Watchlists')
        expect(items.find(item => item.path === '/watchlists')?.disabledReason).toBeUndefined()
    })

    it('opens native Support queue while Profile keeps personal tickets', () => {
        const item = leaves(siteNavigation('account-id')).find(row => row.path === '/support')
        expect(item?.tab).toBe('Tools')
        expect(nativeToolForPath('/support')).toBe('support-desk')
        expect(item?.disabledReason).toBeUndefined()
    })

    it('marks pages without a native workflow as website links', () => {
        const items = leaves(siteNavigation('account-id'))
        expect(items.some(item => item.disabledReason)).toBe(true)
        for (const item of items.filter(item => !item.tab && !workspacePageDefinition(item.path || ''))) {
            expect(item.disabledReason).toBeTruthy()
        }
    })
})

it('keeps delivery history separate from destination configuration and registers new menu jobs', () => {
    const items = leaves(siteNavigation('synthetic-user'))
    for (const [path, tool] of Object.entries({ '/findings/delivery': 'delivery-history', '/findings/actions': 'integrations', '/system/ai': 'ai-metrics', '/management/organizations': 'organization-directory' } as const)) {
        expect(nativeToolForPath(path)).toBe(tool)
        expect(items.some(item => item.path === path && item.tab === 'Tools' && !item.disabledReason)).toBe(true)
    }
    expect(items.find(item => item.label === 'Integrations')?.path).toBe('/findings/actions')
})

it('registers Findings investigation, Rule Tuning, API reference and complete JSON as native jobs', () => {
    const items = leaves(siteNavigation('synthetic-user'))
    for (const [path, tool] of Object.entries({ '/findings': 'findings', '/rules/tuning': 'rule-tuning', '/api': 'api-reference', '/api/openapi': 'openapi-json' } as const)) {
        expect(nativeToolForPath(path)).toBe(tool)
        expect(items.some(item => item.path === path && item.tab === 'Tools' && !item.disabledReason)).toBe(true)
    }
})

it('opens management Users in the native directory workflow', () => {
    const item = leaves(siteNavigation('synthetic-user')).find(row => row.path === '/management/users')
    expect(item?.tab).toBe('Tools')
    expect(item?.disabledReason).toBeUndefined()
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
    expect(item?.disabledReason).toBeUndefined()
    expect(nativeToolForPath(item?.path)).toBe('thesis')
})
