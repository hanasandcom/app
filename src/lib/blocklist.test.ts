import { beforeEach, expect, mock, test } from 'bun:test'
import type { AppSettings } from '../types'

const calls: Array<{ settings: AppSettings; url: URL; init: RequestInit }> = []
let send: (url: URL, init: RequestInit) => Response | Promise<Response>
mock.module('./api', () => ({ apiFetch: async (settings: AppSettings, input: string, init: RequestInit) => {
    const url = new URL(input); calls.push({ settings, url, init }); return send(url, init)
} }))
const { deleteBlocklistEntry, filterBlocklist, listBlocklist, saveBlocklistEntry } = await import('./blocklist')
type BlocklistEntry = import('./blocklist').BlocklistEntry

const settings = { userId: 'fixture-admin', authToken: 'fixture-token', cdnBaseUrl: 'https://cdn.example.test/api', impersonationToken: '', impersonatingUserId: '' } as AppSettings
const overviewRow = (change: Record<string, unknown> = {}) => ({
    id: 12, type: 'ip', value: '203.0.113.20', is_vpn: false, is_proxy: true, is_tor: false, is_relay: false,
    owner: 'Example ISP', location: { country: 'NO', region: 'Vestland', city: 'Bergen' }, requests: [],
    created_at: '2026-10-20T10:00:00.000Z', updated_at: '2026-10-21T10:00:00.000Z', ...change,
})
const rawEntry = (change: Record<string, unknown> = {}) => ({ id: 12, metric: 'ip', value: '203.0.113.20', is_vpn: false, is_proxy: true, is_tor: false, is_relay: false, ...change })
const draft = { type: 'ip' as const, value: '203.0.113.21', is_vpn: false, is_proxy: false, is_tor: false }
beforeEach(() => { calls.length = 0; send = () => Response.json([overviewRow()]) })

test('loads only the CDN overview with the bound account transport', async () => {
    expect(await listBlocklist(settings)).toMatchObject([{ id: 12, type: 'ip', value: '203.0.113.20', is_proxy: true, location: { city: 'Bergen' } }])
    expect(calls).toHaveLength(1)
    expect(calls[0].url.toString()).toBe('https://cdn.example.test/api/blocklist/overview')
    expect(calls[0].settings).toBe(settings)
    expect(calls[0].init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' })
    const headers = new Headers(calls[0].init.headers)
    expect(headers.get('authorization')).toBe('Bearer fixture-token')
    expect(headers.get('id')).toBe('fixture-admin')
    expect(headers.has('cookie')).toBe(false)
})

test('rejects malformed, oversized, or duplicate overview entries instead of displaying a false list', async () => {
    for (const body of [null, {}, Array.from({ length: 101 }, () => overviewRow()), [overviewRow(), overviewRow()], [overviewRow({ id: 0 })], [overviewRow({ type: 'unknown' })], [overviewRow({ is_tor: 'false' })]]) {
        send = () => Response.json(body)
        await expect(listBlocklist(settings)).rejects.toThrow(/invalid|duplicate/i)
    }
})

test('creates with the CDN metric/value contract and recognizes existing entries', async () => {
    send = (_url, init) => {
        expect(init.method).toBe('POST')
        expect(JSON.parse(String(init.body))).toEqual({ metric: 'ip', value: '203.0.113.21' })
        return Response.json(rawEntry({ id: 13, value: '203.0.113.21' }), { status: 201 })
    }
    expect(await saveBlocklistEntry(settings, draft)).toEqual({ kind: 'saved' })
    send = () => Response.json({ message: 'Entry already exists' })
    expect(await saveBlocklistEntry(settings, draft)).toEqual({ kind: 'duplicate' })
})

test('updates a selected entry with only the permitted fields and exact CDN route', async () => {
    const entry = { ...overviewRow(), owner: 'should not be writable' } as BlocklistEntry
    send = (url, init) => {
        expect(url.pathname).toBe('/api/blocklist/12')
        expect(init.method).toBe('PUT')
        expect(JSON.parse(String(init.body))).toEqual({ metric: 'ip', value: '203.0.113.21', is_vpn: false, is_proxy: false, is_tor: false })
        return Response.json(rawEntry({ value: '203.0.113.21' }))
    }
    expect(await saveBlocklistEntry(settings, draft, entry)).toEqual({ kind: 'saved' })
})

test('deletes only the selected entry and validates the returned receipt', async () => {
    send = (url, init) => {
        expect(url.pathname).toBe('/api/blocklist/12')
        expect(init.method).toBe('DELETE')
        return Response.json({ message: 'Blocklist entry deleted', deleted: rawEntry() })
    }
    await expect(deleteBlocklistEntry(settings, 12)).resolves.toBeUndefined()
    send = () => Response.json({ deleted: rawEntry({ id: 13 }) })
    await expect(deleteBlocklistEntry(settings, 12)).rejects.toThrow('different entry')
})

test('requires a signed-in, non-impersonated account and an HTTPS CDN before sending', async () => {
    for (const changed of [
        { authToken: '' }, { userId: '' }, { impersonationToken: 'delegated' }, { impersonatingUserId: 'other' },
        { cdnBaseUrl: 'http://cdn.example.test/api' }, { cdnBaseUrl: 'https://user@cdn.example.test/api' }, { cdnBaseUrl: 'https://cdn.example.test/api?token=secret' },
    ]) await expect(listBlocklist({ ...settings, ...changed })).rejects.toThrow()
    await expect(saveBlocklistEntry(settings, { ...draft, value: '  ' })).rejects.toThrow('Enter a value')
    await expect(saveBlocklistEntry(settings, { ...draft, value: 'a\nb' })).rejects.toThrow('one line')
    await expect(deleteBlocklistEntry(settings, 0)).rejects.toThrow('valid blocklist entry')
    expect(calls).toHaveLength(0)
})

test('keeps authorization and service failures visible and filters without extra requests', async () => {
    for (const status of [401, 403, 429, 503]) {
        send = () => Response.json({ error: 'sensitive backend detail' }, { status })
        const expected = status === 401 || status === 403 ? 'does not have permission' : status === 429 ? 'Too many blocklist requests' : '(503)'
        await expect(listBlocklist(settings)).rejects.toThrow(expected)
    }
    send = () => Response.json([overviewRow(), overviewRow({ id: 13, type: 'user_agent', value: 'Fixture Browser', is_proxy: false, location: { country: null, region: null, city: null } })])
    const loaded = await listBlocklist(settings)
    expect(filterBlocklist(loaded, 'bergen')).toHaveLength(1)
    expect(filterBlocklist(loaded, '', 'user_agent').map(entry => entry.id)).toEqual([13])
    expect(calls).toHaveLength(5)
})
