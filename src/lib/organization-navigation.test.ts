import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import { siteNavigation, type SiteNavigationItem } from '../data/site-navigation'
import { organizationSectionForPath } from './organization-navigation'

const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
const screen = readFileSync(new URL('../screens/OrganizationsScreen.tsx', import.meta.url), 'utf8')
const ui = readFileSync(new URL('../components/ui.tsx', import.meta.url), 'utf8')

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

    it('puts selected Team and Settings content first while keeping the chooser in Overview or no organization', () => {
        expect(screen).toContain('title={selected && tab !== \'Overview\' ? tab : \'Organizations\'}')
        expect(screen).toContain('subtitle={selected?.name || \'Your workspaces\'}')
        expect(screen).toContain('{(!selected || tab === \'Overview\') && <GlassCard')
        const tabs = screen.indexOf('([\'Overview\', \'Team\', \'Settings\'] as const).map')
        expect(tabs).toBeGreaterThan(0)
        expect(tabs).toBeLessThan(screen.indexOf('title=\'Your organizations\''))
        expect(tabs).toBeLessThan(screen.indexOf('title=\'Members\''))
        expect(screen).toContain('label={creating ? \'Cancel creation\' : \'Create organization\'}')
    })

    it('resets only scroll position on focus or tab changes through the existing ScrollView', () => {
        expect(screen).toContain('const scrollViewRef = useRef<ScrollView>(null)')
        expect(screen).toContain('scrollViewRef={scrollViewRef}')
        expect(screen).toContain('useEffect(() => { if (focused) scrollViewRef.current?.scrollTo({ y: 0, animated: false }) }, [focused, tab])')
        expect(ui).toContain('scrollViewRef?: Ref<ScrollView>')
        expect(ui).toContain('<ScrollView ref={scrollViewRef} contentContainerStyle={[styles.content, contentStyle]}>')
        const scrollEffect = screen.split('\n').find(line => line.includes('scrollViewRef.current?.scrollTo'))
        expect(scrollEffect).not.toMatch(/setSelectedId|setDraft|setInviteEmails|setCreateName|onSelectOrganization/)
    })

    it('opens an organization after a directory or user-detail handoff saves its workspace selection', () => {
        expect(app).toContain('onSelectOrganization={id => void openOrganizationWorkspace(id)}')
        const open = app.slice(app.indexOf('async function openOrganizationWorkspace'), app.indexOf('function openWebsite'))
        expect(open).toContain('if (!await selectWorkspace(id)) {')
        expect(open).toContain("Alert.alert('Unable to open organization'")
        expect(open).toContain('setOrganizationRevision(value => value + 1)')
        expect(open).toContain("navigation.navigate('Organizations', { section: 'Overview' })")
        expect(open.indexOf('await selectWorkspace(id)')).toBeLessThan(open.indexOf("navigation.navigate('Organizations'"))
    })

})
