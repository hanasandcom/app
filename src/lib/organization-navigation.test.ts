import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import { siteNavigation, type SiteNavigationItem } from '../data/site-navigation'
import { organizationSectionForPath } from './organization-navigation'

const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
const screen = readFileSync(new URL('../screens/OrganizationsScreen.tsx', import.meta.url), 'utf8')

describe('organization menu navigation', () => {
    it('maps canonical paths to Overview, Team and Settings without matching similar paths', () => {
        expect(organizationSectionForPath('/organizations')).toBe('Overview')
        expect(organizationSectionForPath('/organizations/team')).toBe('Team')
        expect(organizationSectionForPath('/organizations/settings')).toBe('Settings')
        expect(organizationSectionForPath()).toBe('Overview')
        for (const path of ['/organizations/team-other', '/organizations/settings/details', 'Team', 'Organization Settings']) {
            expect(organizationSectionForPath(path)).toBe('Overview')
        }
    })

    it('resolves the actual organization menu paths independently of labels', () => {
        const leaves = (items: SiteNavigationItem[]): SiteNavigationItem[] => items.flatMap(item => item.items ? leaves(item.items) : [item])
        const items = leaves(siteNavigation('synthetic-user')).filter(item => item.tab === 'Organizations')
        expect(items.map(item => [item.path, organizationSectionForPath(item.path)])).toEqual([
            ['/organizations', 'Overview'], ['/organizations/settings', 'Settings'], ['/organizations/team', 'Team'],
        ])
        expect(app).toContain('navigation.navigate(\'Organizations\', { section: organizationSectionForPath(item.path) })')
        expect(app).toContain('initialSection={route.params?.section}')
    })

    it('wires focus changes so repeating the same Team request reselects Team', () => {
        // Menu -> Team -> manual Overview -> Menu -> Team keeps the same
        // route parameter. Focus must also trigger section synchronization.
        expect(screen).toContain('const focused = useIsFocused()')
        expect(screen).toContain('useEffect(() => { if (focused) setTab(initialSection || \'Overview\') }, [focused, initialSection])')
        expect(['/organizations/team', '/organizations/settings', '/organizations/team'].map(organizationSectionForPath)).toEqual(['Team', 'Settings', 'Team'])
    })

    it('changes the active tab without remounting or resetting the organization and drafts', () => {
        expect(app.split('\n').find(line => line.includes('<OrganizationsScreen'))).not.toMatch(/\bkey=/)
        expect(app).toContain('setWorkspaceOpen(false); navigation.navigate(\'Organizations\', { section: \'Overview\' })')
        const synchronization = screen.match(/useEffect\(\(\) => \{ if \(focused\)[^\n]+/)?.[0]
        expect(synchronization).not.toMatch(/setSelectedId|setDraft|setInviteEmails|setCreateName|onSelectOrganization/)
        expect(screen).toContain('const [selectedId, setSelectedId] = useState(selectedOrganizationId || \'\')')
        expect(screen).toContain('const [draft, setDraft] = useState<OrganizationSettings>({})')
    })
})
