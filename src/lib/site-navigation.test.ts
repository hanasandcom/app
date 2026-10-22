import { describe, expect, it } from 'bun:test'
import { siteNavigation, workspacePageDefinition, type SiteNavigationItem } from '../data/site-navigation'

function leaves(items: SiteNavigationItem[]): SiteNavigationItem[] {
    return items.flatMap(item => item.items ? leaves(item.items) : [item])
}

describe('native website navigation', () => {
    it('uses the website public status contract for both status sections', () => {
        const status = workspacePageDefinition('/status')
        expect(status?.sections.length).toBe(2)
        for (const section of status!.sections) {
            expect(section.endpoint).toBe('api/status')
            expect(section.origin).toBe('site')
        }
    })

    it('opens account and workspace tasks in native screens', () => {
        const items = leaves(siteNavigation('account-id'))
        for (const tab of ['Profile', 'Mail', 'Notes', 'Images', 'Organizations', 'Automations']) {
            expect(items.some(item => item.tab === tab && !item.disabledReason)).toBe(true)
        }
        expect(items.some(item => item.label === 'Utilities')).toBe(false)
    })

    it('marks pages without a native workflow as website links', () => {
        const items = leaves(siteNavigation('account-id'))
        expect(items.some(item => item.disabledReason)).toBe(true)
        for (const item of items.filter(item => !item.tab && !workspacePageDefinition(item.path || ''))) {
            expect(item.disabledReason).toBeTruthy()
        }
    })
})
