import { beforeEach, expect, mock, test } from 'bun:test'
import type { AppSettings } from '../types'
const calls: Array<{ settings: AppSettings; url: string; init: RequestInit }> = []
let handle: (url: string, init: RequestInit) => Response | Promise<Response>
mock.module('./api', () => ({ apiFetch: async (settings: AppSettings, url: string, init: RequestInit) => {
    calls.push({ settings, url, init }); return handle(url, init)
} }))
const api = await import('./user-management')
const settings = { apiBaseUrl: 'https://api.hanasand.com/api', siteBaseUrl: 'https://hanasand.com', userId: 'actor', authToken: 'synthetic-token', selectedOrganizationId: 'selected', impersonationToken: '', impersonatingUserId: '' } as AppSettings
const org = { id: 'org.one:@', name: 'Example', slug: 'example', status: 'active' }
const row = (change = {}) => ({ id: 'actor', username: 'actor', name: 'Actor', email: 'actor@example.invalid', active: true, avatar: '', created_at: '2026-10-01T00:00:00Z', last_login_at: null, deactivated_at: null, deactivated_by: null, organization_memberships: [org], ...change })
const signal = () => new AbortController().signal
const access = () => ({ scope: api.userManagementScope(settings), canRead: true, canWrite: true })
beforeEach(() => {
    calls.length = 0
    handle = url => Response.json(url.includes('management/organizations') ? { allowed: true, canEdit: true } : [row()])
})
test('directory uses exact Core users and direct Identity permission contracts without an organization grant', async () => {
    const snapshot = await api.loadUserManagement(settings, signal())
    expect(calls.map(call => call.url)).toEqual(['https://identity.hanasand.com/api/management/organizations?internalPages=1', 'https://api.hanasand.com/api/users'])
    expect(snapshot.access.canWrite).toBe(true)
    expect(snapshot.users[0]).toMatchObject({ id: 'actor', email: 'actor@example.invalid', lastLoginAt: null, organizations: [org] })
    for (const call of calls) {
        expect(call.init).toMatchObject({ cache: 'no-store', credentials: 'omit', redirect: 'error' })
        expect(new Headers(call.init.headers).get('authorization')).toBe('Bearer synthetic-token')
        expect(call.settings.selectedOrganizationId).toBeUndefined()
    }
})
test('valid empty and canonical no-users404 differ from unavailable or malformed data', async () => {
    for (const body of [[], { error: 'There are no users.' }]) {
        handle = url => Response.json(url.includes('management/') ? { allowed: true, canEdit: true } : body, { status: Array.isArray(body) || url.includes('management/') ? 200 : 404 })
        expect((await api.loadUserManagement(settings, signal())).users).toEqual([])
    }
    for (const value of [{}, [row({ email: 123 })], [row({ active: null })], [row({ organization_memberships: null })], [row(), row()], [row({ id: '../bad' })]])
        expect(() => api.parseManagedUsers(value)).toThrow()
    for (const status of [401, 403, 404, 503]) {
        handle = () => Response.json({ error: 'private-detail' }, { status })
        await expect(api.loadUserManagement(settings, signal())).rejects.not.toThrow('private-detail')
    }
})
test('read success never grants writes; actor lifecycle and both impersonation fields remain authoritative', async () => {
    for (const change of [{ impersonationToken: 'opaque' }, { impersonatingUserId: 'other' }]) {
        const impersonated = { ...settings, ...change }
        const snapshot = await api.loadUserManagement(impersonated, signal())
        expect(snapshot.access.canWrite).toBe(false); expect(snapshot.users[0].email).toBeNull()
        const count = calls.length
        await expect(api.changeManagedUser(impersonated, { ...access(), scope: api.userManagementScope(impersonated) }, 'target', 'delete', signal())).rejects.toThrow()
        expect(calls).toHaveLength(count)
    }
    handle = url => Response.json(url.includes('management/') ? { allowed: true, canEdit: false } : [row()])
    expect((await api.loadUserManagement(settings, signal())).access.canWrite).toBe(false)
    handle = url => Response.json(url.includes('management/') ? { allowed: true, canEdit: true } : [row({ active: false })])
    expect((await api.loadUserManagement(settings, signal())).access.canWrite).toBe(false)
})
test('reserved placeholder filtering preserves server ordering without hiding every inactive user', () => {
    const users = api.parseManagedUsers([row({ id: 'admin', username: 'admin', active: false, name: 'A' }), row({ id: 'normal', username: 'normal', active: false, name: 'B' }), row({ id: 'active-admin', username: 'admin', name: 'C' })])
    expect(api.visibleManagedUsers(users, '', false).map(user => user.id)).toEqual(['normal', 'active-admin'])
    expect(api.visibleManagedUsers(users, '', true)).toHaveLength(3)
    expect(api.visibleManagedUsers(users, 'ACTOR@', true)).toHaveLength(3)
    expect(api.visibleManagedUsers(users, 'normal', true).map(user => user.id)).toEqual(['normal'])
    expect(api.visibleManagedUsers([...users].reverse(), '', true).map(user => user.id)).toEqual([...users].reverse().map(user => user.id))
})
test('profile visibility is an actual scoped GET, not inferred from directory visibility', async () => {
    handle = () => Response.json(row({ id: 'user:@', deletion_scheduled_at: null }))
    const profile = await api.loadManagedProfile(settings, 'user:@', signal())
    expect(profile.id).toBe('user:@'); expect(calls[0].url).toEndWith('/user/user%3A%40')
    handle = () => Response.json({ error: 'not shared' }, { status: 404 })
    await expect(api.loadManagedProfile(settings, 'user:@', signal())).rejects.toMatchObject({ status: 404 })
    handle = () => Response.json(row({ id: 'other' }))
    await expect(api.loadManagedProfile(settings, 'user:@', signal())).rejects.toThrow('selected')
    expect(api.managedProfileUrl(settings, 'user:@')).toBe('https://hanasand.com/profile/user%3A%40')
    expect(api.managedProfileUrl({ ...settings, siteBaseUrl: 'https://password:secret@example.invalid' }, 'user')).toBeNull()
    expect(api.managedAvatarUrl(settings, '/avatar.png')).toBe('https://hanasand.com/avatar.png')
    for (const avatar of ['javascript:bad', 'http://unsafe.invalid/image', 'https://user:password@example.invalid/image']) expect(api.managedAvatarUrl(settings, avatar)).toBeNull()
})
test('organization handoff requires actor own active membership and target active lifecycle', async () => {
    const snapshot = await api.loadUserManagement(settings, signal())
    expect(api.mayOpenUserOrganization(settings, snapshot, org)).toBe(true)
    expect(api.mayOpenUserOrganization(settings, snapshot, { ...org, id: 'unrelated' })).toBe(false)
    expect(api.mayOpenUserOrganization(settings, snapshot, { ...org, status: 'archived' })).toBe(false)
    expect(api.mayOpenUserOrganization({ ...settings, impersonatingUserId: 'other' }, snapshot, org)).toBe(false)
})
test('activation and deactivation verify exact returned target/state and send only the canonical boolean', async () => {
    for (const action of ['activate', 'deactivate'] as const) {
        handle = () => Response.json({ id: 'target', active: action === 'activate' })
        const receipt = await api.changeManagedUser(settings, access(), 'target', action, signal())
        expect(receipt).toEqual({ id: 'target', action, active: action === 'activate' })
        expect(calls.at(-1)!.init.method).toBe('PUT')
        expect(JSON.parse(String(calls.at(-1)!.init.body))).toEqual({ active: action === 'activate' })
    }
    handle = () => Response.json({ id: 'wrong', active: false })
    await expect(api.changeManagedUser(settings, access(), 'target', 'deactivate', signal())).rejects.toMatchObject({ uncertain: true })
})
test('deletion schedules30days and handles an authoritative ownership blocker without claiming physical deletion', async () => {
    handle = () => Response.json({ pending_deletion: true, user: { id: 'target', deletion_scheduled_at: '2026-11-22T00:00:00Z' }, message: 'User scheduled for deletion.' })
    expect(await api.changeManagedUser(settings, access(), 'target', 'delete', signal())).toEqual({ id: 'target', action: 'delete', deletionScheduledAt: '2026-11-22T00:00:00Z' })
    expect(calls[0].init.method).toBe('DELETE'); expect(calls[0].init.body).toBeUndefined()
    handle = () => Response.json({ code: 'organization_ownership_transfer_required', organization_id: org.id, organization_name: org.name, active_api_key: true }, { status: 409 })
    await expect(api.changeManagedUser(settings, access(), 'target', 'delete', signal())).rejects.toMatchObject({ status: 409, blocker: { id: org.id, name: org.name, activeApiKey: true } })
})
test('interrupted or server-error mutations remain unknown and are never retried', async () => {
    handle = () => Response.json({}, { status: 500 })
    await expect(api.changeManagedUser(settings, access(), 'target', 'delete', signal())).rejects.toMatchObject({ uncertain: true })
    expect(calls).toHaveLength(1)
    const cancel = new AbortController()
    handle = () => { cancel.abort(); return Response.json({ id: 'target', active: false }) }
    await expect(api.changeManagedUser(settings, access(), 'target', 'deactivate', cancel.signal)).rejects.toMatchObject({ uncertain: true })
    expect(calls).toHaveLength(2)
})
test('unsafe configuration, stale authority and pre-abort stop before transport', async () => {
    const cancel = new AbortController(); cancel.abort()
    await expect(api.loadUserManagement(settings, cancel.signal)).rejects.toThrow('cancelled')
    await expect(api.loadUserManagement({ ...settings, apiBaseUrl: 'http://unsafe.invalid' }, signal())).rejects.toThrow('HTTPS')
    await expect(api.changeManagedUser(settings, { ...access(), scope: 'old' }, 'target', 'delete', signal())).rejects.toThrow('verify')
    expect(calls).toHaveLength(0)
})
test('old read/confirmation cannot unlock or change a newer write; only explicit current read unlocks once', () => {
    const ops = new api.UserManagementOperations(); ops.visible = true; ops.selection = 'first'
    const oldRead = ops.beginRead(true)
    const confirmation = ops.confirm('scope', 'delete')
    expect(ops.canConfirm(confirmation, 'scope')).toBe(true)
    ops.beginWrite(); ops.locked = true; ops.endWrite()
    expect(ops.finishRead(oldRead.ticket)).toBe(false)
    expect(ops.canConfirm(confirmation, 'scope')).toBe(false)
    const automatic = ops.beginRead(false)
    expect(ops.finishRead(automatic.ticket)).toBe(true); expect(ops.locked).toBe(true)
    const manual = ops.beginRead(true)
    expect(ops.finishRead(manual.ticket)).toBe(true); expect(ops.locked).toBe(false)
    ops.locked = true
    ops.finishRead(manual.ticket); expect(ops.locked).toBe(true)
    const failed = ops.beginRead(true); ops.failRead(failed.ticket)
    ops.finishRead(failed.ticket); expect(ops.locked).toBe(true)
    const hidden = ops.confirm('scope', 'activate'); ops.visible = false
    expect(ops.canConfirm(hidden, 'scope')).toBe(false)
})
test('screen binds native targets/lifecycle and exposes incompatible impersonation as unavailable without network', async () => {
    const screen = await Bun.file(new URL('../screens/UserManagementScreen.tsx', import.meta.url)).text()
    const detail = await Bun.file(new URL('../components/UserManagementDetail.tsx', import.meta.url)).text()
    for (const required of ['key={userManagementScope(props.settings)}', 'ops.beginRead(explicit)', 'ops.canConfirm(confirmation', 'AppState.addEventListener(\'change\'', 'ops.beginWrite()']) expect(screen).toContain(required)
    expect(detail).toContain('key={`user-detail:${boundary}:${user.id}`}')
    expect(detail).toContain('label=\'Impersonation unavailable\' disabled')
    expect(detail).not.toContain('startMobileImpersonation'); expect(screen).not.toContain('startMobileImpersonation')
    expect(screen).not.toContain('setInterval'); expect(screen).not.toContain('AsyncStorage')
})


test('actual synthetic late directory GET cannot unlock a newer server-error mutation', async () => {
    const ops = new api.UserManagementOperations(); ops.visible = true
    const read = ops.beginRead(true)
    let finish!: (response: Response) => void
    const delayed = new Promise<Response>(resolve => { finish = resolve })
    handle = (url, init) => url.includes('management/') ? Response.json({ allowed: true, canEdit: true })
        : init.method === 'DELETE' ? Response.json({}, { status: 500 }) : delayed
    const loading = api.loadUserManagement(settings, read.controller.signal).then(() => ops.finishRead(read.ticket)).catch(cause => {
        expect(cause).toBeInstanceOf(api.UserManagementError)
        return false
    })
    // Let permission discovery reach the synthetic Core GET before the write starts.
    await new Promise(resolve => setTimeout(resolve, 0))
    ops.beginWrite()
    expect(read.controller.signal.aborted).toBe(true)
    await expect(api.changeManagedUser(settings, access(), 'target', 'delete', signal())).rejects.toMatchObject({ uncertain: true })
    ops.locked = true; ops.endWrite()
    finish(Response.json([row()]))
    expect(await loading).toBe(false)
    expect(ops.locked).toBe(true)
    expect(calls.filter(call => call.init.method === 'DELETE')).toHaveLength(1)
})
test('replacing detail native targets prevents an old activation or deletion button from targeting a new selection', () => {
    const ops = new api.UserManagementOperations(); ops.visible = true; ops.selection = 'first'
    let next = 0, target = 0, boundary = -1
    const targets = new Map<number, () => void>(), attempts: string[] = []
    function commit() {
        if (boundary !== ops.generation) { targets.delete(target); target = ++next; boundary = ops.generation }
        const confirmation = ops.confirm('scope', 'delete')
        targets.set(target, () => { if (ops.canConfirm(confirmation, 'scope')) attempts.push(confirmation.selection) })
        return target
    }
    const oldTarget = commit(), oldCallback = targets.get(oldTarget)!
    ops.invalidate(); ops.selection = 'second'
    oldCallback(); expect(attempts).toEqual([])
    const current = commit()
    targets.get(oldTarget)?.(); expect(attempts).toEqual([])
    targets.get(current)?.(); expect(attempts).toEqual(['second'])
})
