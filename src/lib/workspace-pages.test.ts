import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { AppSettings } from '../types'
import { workspacePageDefinition, type WorkspaceSection } from '../data/site-navigation'

const originalFetch = globalThis.fetch
const publicRequests: Array<{ url: string; init?: RequestInit }> = []
const requests: Array<{ settings: AppSettings; url: string; init: RequestInit }> = []
let response = () => Response.json({ checks: [] })
mock.module('./api', () => ({ apiFetch: async (settings: AppSettings, url: string, init: RequestInit) => { requests.push({ settings, url, init }); return response() } }))
mock.module('react-native', () => ({ BackHandler: {}, Pressable: () => null, Text: () => null, TextInput: () => null, View: () => null }))
mock.module('../components/ui', () => ({ GlassCard: () => null, InlineNotice: () => null, PillButton: () => null, Screen: () => null, SectionTitle: () => null }))
mock.module('../theme/context', () => ({ useAppTheme: () => ({}) }))
const { workspaceRequestUrl, fetchWorkspaceSection, workspaceRows, workspaceSectionNotice, workspaceFieldValue, workspaceDetailRow } = await import('../screens/WorkspacePageScreen')
const settings = { apiBaseUrl: 'https://api.example.test/api', siteBaseUrl: 'https://site.example.test', userId: 'synthetic-user', authToken: 'synthetic-token', selectedOrganizationId: 'synthetic-org', impersonationToken: '' } as AppSettings
beforeEach(() => { globalThis.fetch = originalFetch; publicRequests.length = 0; requests.length = 0; response = () => Response.json({ checks: [] }) })

describe('maintained workspace API contracts', () => {
    it('selects the requested incident and aliases from the full standalone response', () => {
        const section = workspacePageDefinition('/status')!.sections.find(item => item.listPath === 'incidents')!
        const first = { id: 'first', title: 'First' }
        const second = { id: 'second', title: 'Second', aliases: ['previous-id'] }
        expect(workspaceDetailRow({ incidents: [first, second] }, section, 'second')).toEqual(second)
        expect(workspaceDetailRow({ incidents: [first, second] }, section, 'previous-id')).toEqual(second)
        expect(workspaceDetailRow({ incidents: [first, second] }, section, 'absent')).toEqual({})
    })
    it('requests the full status API, deduplicatable across all sections, and preserves more than seven checks', async () => {
        const sections = workspacePageDefinition('/status')!.sections
        const checks = Array.from({ length: 23 }, (_, index) => ({ service: `service-${index}`, check_name: `Check ${index}`, status: 'up', checked_at: new Date().toISOString() }))
        globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => { publicRequests.push({ url: String(url), init }); return Response.json({ checks }) }) as typeof fetch
        expect(new Set(sections.map(section => workspaceRequestUrl(settings, section))).size).toBe(1)
        const services = sections.find(section => section.listPath === 'checks')!
        const payload = await fetchWorkspaceSection(settings, services, new AbortController().signal)
        expect(new URL(publicRequests[0].url).pathname).toBe('/api/status')
        expect(new URL(publicRequests[0].url).searchParams.get('dashboard')).toBe('true')
        expect(publicRequests[0].init?.signal).toBeInstanceOf(AbortSignal)
        expect(new URL(publicRequests[0].url).origin).toBe('https://status.hanasand.com')
        expect(new URL(publicRequests[0].url).searchParams.has('organizationId')).toBe(false)
        expect(publicRequests[0].init?.credentials).toBe('omit')
        expect(new Headers(publicRequests[0].init?.headers).get('Authorization')).toBeNull()
        expect(workspaceRows(payload, services)).toHaveLength(23)
        expect(services.titlePath).toBe('check_name')
    })

    it('reports unavailable and stale monitoring honestly without discarding last evidence', () => {
        const definition = workspacePageDefinition('/status')!.sections[1]
        const now = Date.parse('2026-10-22T12:00:00Z')
        const check = { service: 'core', check_name: 'API', status: 'up', checked_at: '2026-10-22T11:59:00Z' }
        expect(workspaceSectionNotice({ monitoring: 'live', checks: [check] }, definition, now)).toBeUndefined()
        const stale = { monitoring: 'live', checks: [{ ...check, checked_at: '2026-10-22T11:50:00Z' }] }
        expect(workspaceSectionNotice(stale, definition, now)).toContain('last received evidence')
        expect(workspaceRows(stale, definition)).toHaveLength(1)
        expect(workspaceSectionNotice({ monitoring: 'unavailable', checks: [check] }, definition, now)).toContain('unavailable')
        expect(workspaceSectionNotice({ monitoring: 'live', checks: [] }, definition, now)).toContain('unavailable')
    })

    it('loads an incident by its encoded ID and shows only explicit timeline fields', () => {
        const incident = workspacePageDefinition('/status')!.sections.find(section => section.listPath === 'incidents')!
        const url = new URL(workspaceRequestUrl(settings, incident, 'incident/a?b'))
        expect(url.searchParams.get('incident')).toBe('incident/a?b')
        expect(incident.detailObjectPath).toBe('incidents')
        expect(workspaceFieldValue({ updates: [{ at: '2026-10-22', status: 'resolved', message: 'Recovered', token: 'do-not-render' }] }, ['Updates', 'updates', 'updates'])).toBe('2026-10-22 · resolved · Recovered')
    })

    it('uses website log routing and actual rows/cursor/query contracts for all log views', () => {
        for (const path of ['/logs', '/logs/realtime', '/logs/search']) {
            const definition = workspacePageDefinition(path)!.sections[0]
            const url = new URL(workspaceRequestUrl(settings, definition, undefined, 'synthetic search', 'cursor/next'))
            expect(url.origin).toBe('https://site.example.test')
            expect(url.pathname).toBe('/api/backend/logs/search')
            expect(url.searchParams.get('search')).toBe('synthetic search')
            expect(url.searchParams.get('cursor')).toBe('cursor/next')
            expect(url.searchParams.get('paginate')).toBe('1')
            expect(definition.listPath).toBe('rows')
            expect(workspaceRows({ rows: [{ id: 'log' }], next_cursor: 'next' }, definition)).toEqual([{ id: 'log' }])
            if (path === '/logs/realtime') expect(url.searchParams.get('severity')).toBe('high,critical')
        }
    })

    it('keeps case collection cursors separate and exposes partial-source warnings', () => {
        const sections = workspacePageDefinition('/cases')!.sections
        expect(sections).toHaveLength(2)
        const url = new URL(workspaceRequestUrl(settings, sections[0], undefined, undefined, 'next'))
        expect(url.searchParams.get('collection')).toBe('intelligence')
        expect(url.searchParams.has('page')).toBe(false)
        expect(url.searchParams.get('cursor')).toBe('next')
        expect(workspaceSectionNotice({ warnings: ['Monitoring unavailable', { secret: 'ignored' }] }, sections[0])).toBe('Monitoring unavailable')
    })

    it('preserves organization and impersonation scope and rejects plaintext and malformed payloads', async () => {
        const definition: WorkspaceSection = { label: 'Scoped records', endpoint: 'organizations/:organizationId/items/:userId', listPath: 'items', fields: [] }
        const impersonated = { ...settings, impersonatingUserId: 'other/user', impersonationToken: 'synthetic-impersonation' }
        const url = new URL(workspaceRequestUrl(impersonated, definition))
        expect(url.pathname).toBe('/api/organizations/synthetic-org/items/other%2Fuser')
        expect(url.searchParams.get('organizationId')).toBe('synthetic-org')
        response = () => Response.json({ error: { message: 'Denied' } }, { status: 403 })
        await expect(fetchWorkspaceSection(impersonated, definition, new AbortController().signal)).rejects.toThrow('Denied')
        expect(new Headers(requests[0].init.headers).get('x-impersonation-token')).toBe('synthetic-impersonation')
        expect(() => workspaceRequestUrl({ ...settings, apiBaseUrl: 'http://api.example.test' }, definition)).toThrow('HTTPS')
        expect(() => workspaceRows({ items: {} }, definition)).toThrow('invalid list')
        expect(workspaceRows({ items: [{ id: 1 }, null, 2] }, definition)).toEqual([{ id: 1 }])
    })
})
