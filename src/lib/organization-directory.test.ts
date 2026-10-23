import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { AppSettings } from '../types'
const calls: Array<{ settings: AppSettings; url: string; init: RequestInit }> = []
let handler: (url: string) => Response | Promise<Response>
mock.module('./api', () => ({ apiFetch: async (settings: AppSettings, url: string, init: RequestInit) => {
    calls.push({ settings, url, init }); return handler(url)
} }))
const directory = await import('./organization-directory')
const settings = { userId: 'synthetic-user', authToken: 'synthetic-token', apiBaseUrl: 'https://api.hanasand.com/api',
    siteBaseUrl: 'https://hanasand.com', impersonationToken: '', impersonatingUserId: '', selectedOrganizationId: '' } as AppSettings
const raw = { id: 'org.one:@', name: 'Example 2', slug: 'example', status: 'active', member_count: 2,
    created_at: '2026-10-01T00:00:00Z', last_active_at: '2026-10-20T12:00:00Z' }
const member = { id: raw.id, name: raw.name, role: 'reader', lifecycleStatus: 'active' }
const memberships = [{ id: raw.id, name: raw.name, role: 'reader', status: 'active' }]
const signal = () => new AbortController().signal
beforeEach(() => {
    calls.length = 0
    handler = (url) => Response.json(url.endsWith('/management/organizations') ? { organizations: [raw] } : { organizations: [member] })
})

describe('registered Identity directory contract', () => {
    it('uses direct Identity GETs and existing membership discovery without a Core proxy', async () => {
        const value = await directory.loadOrganizationDirectory(settings, signal())
        expect(calls.map((call) => call.url).sort()).toEqual([
            'https://identity.hanasand.com/api/management/organizations', 'https://identity.hanasand.com/api/organizations'
        ])
        expect(value.memberships).toEqual(memberships)
        expect(value.organizations[0].memberCount).toBe(2)
        for (const call of calls) {
            expect(call.settings).toBe(settings)
            expect(call.init.cache).toBe('no-store')
            expect(call.init.method || 'GET').toBe('GET')
            expect(call.init.body).toBeUndefined()
        }
        const request = calls.find((call) => call.url.includes('/management/'))!
        expect(new Headers(request.init.headers).get('Authorization')).toBe('Bearer synthetic-token')
        expect(new Headers(request.init.headers).get('id')).toBe(settings.userId)
    })
    it('handles genuinely empty directories without inventing membership', async () => {
        handler = () => Response.json({ organizations: [] })
        expect(await directory.loadOrganizationDirectory(settings, signal())).toEqual({ organizations: [], memberships: [] })
    })
    it('never converts authorization, throttling or service errors into an empty directory', async () => {
        for (const status of [401, 403, 429, 500, 503]) {
            calls.length = 0
            handler = () => Response.json({ error: 'private-server-details' }, { status })
            await expect(directory.loadOrganizationDirectory(settings, signal())).rejects.toThrow()
            expect(calls.filter((call) => call.url.includes('/management/'))).toHaveLength(1)
        }
    })
    it('requires a real organizations envelope and rejects ambiguous entries', () => {
        expect(() => directory.parseDirectory([])).toThrow('incomplete')
        expect(() => directory.parseDirectory({ organizations: [{}] })).toThrow('invalid')
        expect(() => directory.parseDirectory({ organizations: [raw, raw] })).toThrow('duplicate')
        expect(() => directory.parseDirectory({ organizations: null })).toThrow('incomplete')
    })
    it('projects only directory fields and keeps unknown measurements unavailable', () => {
        const [value] = directory.parseDirectory({ organizations: [{ ...raw, member_count: null, status: undefined,
            last_active_at: 'invalid', created_at: null, email: 'private@example.invalid', audit_safe_metadata: { secret: 'discard' } }] })
        expect(value.memberCount).toBeNull()
        expect(value.status).toBe('unknown')
        expect(value.createdAt).toBeNull()
        expect(value.lastActiveAt).toBeNull()
        expect(JSON.stringify(value)).not.toContain('private@example.invalid')
        expect(JSON.stringify(value)).not.toContain('discard')
        expect(directory.parseDirectory({ organizations: [{ ...raw, member_count: '0' }] })[0].memberCount).toBe(0)
    })
    it('rejects insecure destinations and already-cancelled reads before network calls', async () => {
        await expect(directory.loadOrganizationDirectory({ ...settings, apiBaseUrl: 'http://example.invalid/api' }, signal())).rejects.toThrow('HTTPS')
        const cancelled = new AbortController(); cancelled.abort()
        await expect(directory.loadOrganizationDirectory(settings, cancelled.signal)).rejects.toThrow('cancelled')
        expect(calls).toHaveLength(0)
    })
})
describe('own active membership switching', () => {
    const organization = directory.parseDirectory({ organizations: [raw] })[0]
    it('does not treat directory visibility or administrative roles as membership', () => {
        expect(directory.canSwitchDirectoryOrganization(settings, organization, [])).toBe(false)
        expect(directory.canSwitchDirectoryOrganization(settings, organization, [{ ...memberships[0], id: 'another', role: 'owner' }])).toBe(false)
        expect(directory.canSwitchDirectoryOrganization(settings, organization, memberships)).toBe(true)
    })
    it('requires both current directory lifecycle and membership lifecycle to be active', () => {
        for (const status of ['archived', 'deleted', 'unknown', '', 'Active']) {
            expect(directory.canSwitchDirectoryOrganization(settings, { ...organization, status }, memberships)).toBe(false)
            expect(directory.canSwitchDirectoryOrganization(settings, organization, [{ ...memberships[0], status }])).toBe(false)
        }
    })
    it('blocks both impersonation states and missing account credentials', () => {
        for (const change of [{ impersonationToken: 'synthetic' }, { impersonatingUserId: 'target' }, { authToken: '' }, { userId: '' }])
            expect(directory.canSwitchDirectoryOrganization({ ...settings, ...change }, organization, memberships)).toBe(false)
    })
    it('remounts account/workspace scope for every authority-bearing setting change', () => {
        for (const change of [{ authToken: 'new' }, { userId: 'new' }, { apiBaseUrl: 'https://other.invalid/api' },
            { selectedOrganizationId: 'new' }, { impersonationToken: 'new' }, { impersonatingUserId: 'new' }])
            expect(directory.directoryScope({ ...settings, ...change })).not.toBe(directory.directoryScope(settings))
    })
})
describe('local directory search and sorting', () => {
    const organizations = directory.parseDirectory({ organizations: [raw, { ...raw, id: 'second', name: 'Example 10', slug: 'another',
        status: 'archived', member_count: 5, created_at: '2026-09-01', last_active_at: null }] })
    it('searches the website fields and leaves the input list untouched', () => {
        expect(directory.directoryRows(organizations, 'ARCHIVED', 'name', 'asc').map((row) => row.id)).toEqual(['second'])
        expect(directory.directoryRows(organizations, 'another', 'name', 'asc')).toHaveLength(1)
        expect(directory.directoryRows(organizations, 'missing', 'name', 'asc')).toEqual([])
        expect(organizations[0].id).toBe(raw.id)
    })
    it('supports all six sort modes, stable ties and direction changes', () => {
        const firstAscending = { name: raw.id, slug: 'second', status: raw.id, members: raw.id, created: 'second', lastActive: raw.id }
        for (const sort of directory.directorySorts) {
            expect(directory.directoryRows(organizations, '', sort.key, 'asc')[0].id).toBe(firstAscending[sort.key])
            if (sort.key !== 'lastActive') expect(directory.directoryRows(organizations, '', sort.key, 'desc')[0].id).not.toBe(firstAscending[sort.key])
        }
        expect(directory.directoryRows(organizations, '', 'lastActive', 'desc')[1].lastActiveAt).toBeNull()
    })
})
describe('directory lifecycle and switch receipt gates', () => {
    it('aborts actual read transport and rejects late data after hide and scope return', async () => {
        const requests = new directory.DirectoryRequests()
        const request = requests.start()
        let release!: (value: Response) => void
        handler = (url) => url.includes('/management/') ? new Promise((resolve) => { release = resolve }) : Response.json({ organizations: [member] })
        const pending = directory.loadOrganizationDirectory(settings, request.controller.signal)
        const transport = calls.find((call) => call.url.includes('/management/'))!.init.signal!
        requests.invalidate()
        expect(transport.aborted).toBe(true)
        const returned = requests.start()
        release(Response.json({ organizations: [raw] }))
        const value = await pending
        let selected = ''
        if (requests.canApply(request, true) && directory.canSwitchDirectoryOrganization(settings, value.organizations[0], value.memberships)) selected = raw.id
        expect(selected).toBe('')
        expect(requests.finish(request)).toBe(false)
        expect(requests.canApply(returned, true)).toBe(true)
        expect(requests.canApply(returned, false)).toBe(false)
        requests.invalidate()
        expect(requests.canApply(returned, true)).toBe(false)
    })
    it('requires the screen to recheck both lists before dispatching its sole switch callback', async () => {
        const source = await Bun.file(new URL('../screens/OrganizationDirectoryScreen.tsx', import.meta.url)).text()
        expect(source).toContain('const current = await loadOrganizationDirectory(settings, operation.controller.signal)')
        expect(source).toContain('!canSwitchDirectoryOrganization(settings, target, current.memberships)')
        expect(source).toContain('requests.current.canApply(operation, visible())')
        expect(source).toContain('onSelectOrganization(target.id)')
        expect(source).toContain('requests.current.invalidate()')
        expect(source).not.toContain("method: 'POST'")
        expect(source).toContain('Show 50 more loaded organizations')
    })
})
