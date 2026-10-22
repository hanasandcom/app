import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { AppSettings } from '../types'
import type { AccountSession } from './profile-api'

let calls: Array<{ settings: AppSettings; url: string; init: RequestInit }> = []
let response = () => Response.json({ sessions: [] })
mock.module('react-native', () => ({ Platform: { OS: 'ios' } }))
mock.module('react-native-passkeys', () => ({ create: async () => null, isSupported: () => false }))
mock.module('./api', () => ({
    apiFetch: async (settings: AppSettings, url: string, init: RequestInit) => {
        calls.push({ settings, url, init })
        return response()
    },
}))
const { describeAccountSession, filterAccountSessions, fetchOrganizations, fetchAccountSessions, revokeAccountSession, revokeOtherAccountSessions, logOutCurrentAccountSession } = await import('./profile-api')
const settings = { apiBaseUrl: 'https://api.example.test/api/', authToken: 'synthetic-token', userId: 'synthetic-user', impersonationToken: '' } as AppSettings
const session = (changes: Partial<AccountSession> = {}): AccountSession => ({
    token_id: 3, id: 'synthetic-user', ip: '203.0.113.10', current: false, user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Version/18.0 Safari/605.1',
    created_at: '2026-10-01T10:00:00Z', last_seen_at: '2026-10-22T12:00:00Z', revoked_at: null,
    network: { provider: 'Example ISP', city: 'Oslo', region: 'Oslo', country: 'Norway' }, ...changes,
})

beforeEach(() => { calls = []; response = () => Response.json({ sessions: [] }) })

describe('native device session review', () => {
    it('shows browser and operating system with deduplicated location', () => {
        expect(describeAccountSession(session())).toEqual({ device: 'Safari on macOS', address: 'Public IP 203.0.113.10', network: 'Example ISP', location: 'Oslo, Norway' })
    })

    it('recognizes Edge and Firefox iOS before Chrome and Safari agent tokens', () => {
        expect(describeAccountSession(session({ user_agent: 'Windows Chrome/130 Safari/600 Edg/130' })).device).toBe('Edge on Windows')
        expect(describeAccountSession(session({ user_agent: 'iPhone FxiOS/130 Safari/600' })).device).toBe('Firefox on iPhone')
    })

    it('recognizes desktop, mobile, and automation clients', () => {
        expect(describeAccountSession(session({ user_agent: 'HanasandDesktop/1.0' })).device).toBe('Hanasand desktop app')
        expect(describeAccountSession(session({ user_agent: 'okhttp/4.9' })).device).toBe('Mobile app')
        expect(describeAccountSession(session({ user_agent: 'curl/8.0' })).device).toBe('Automation or API client')
    })

    it('does not invent a device for legacy proxy agents without a public address', () => {
        expect(describeAccountSession(session({ user_agent: 'Bun/1.3.13', ip: null })).device).toBe('Device details unavailable')
        expect(describeAccountSession(session({ user_agent: '', ip: null })).device).toBe('Device details unavailable')
    })

    it('preserves private addresses without assigning public geolocation or an ISP', () => {
        expect(describeAccountSession(session({ ip: null, private_ip: '10.0.0.7' }))).toMatchObject({ address: 'Private IP 10.0.0.7', network: 'Private network', location: 'Unavailable for private addresses' })
    })

    it('reports missing network information explicitly', () => {
        expect(describeAccountSession(session({ ip: null, network: null }))).toMatchObject({ address: 'Public IP was not captured for this login', network: 'Unavailable', location: 'Unavailable' })
    })

    it('searches all query terms across device, IP, region, network and current state', () => {
        const current = session({ current: true })
        const remote = session({ token_id: 4, user_agent: 'Android Chrome/130', network: { city: 'Bergen', region: 'Vestland', country: 'Norway' } })
        expect(filterAccountSessions([current, remote], '  SAFARI oslo  ')).toEqual([current])
        expect(filterAccountSessions([current, remote], 'vestland android')).toEqual([remote])
        expect(filterAccountSessions([current, remote], 'this device 203.0.113')).toEqual([current])
        expect(filterAccountSessions([current, remote], 'unknown-ip')).toEqual([])
        expect(filterAccountSessions([current, remote], '  ')).toEqual([current, remote])
    })
})

describe('existing Identity session contracts', () => {
    it('reads production organizations from Identity without changing custom account targets', async () => {
        response = () => Response.json({ organizations: [] })
        await fetchOrganizations({ ...settings, apiBaseUrl: 'https://api.hanasand.com/api/' })
        expect(calls[0].url).toBe('https://identity.hanasand.com/api/organizations')
        await fetchOrganizations(settings)
        expect(calls[1].url).toBe('https://api.example.test/api/organizations')
    })

    it('loads the actual session envelope through authenticated managed transport', async () => {
        response = () => Response.json({ sessions: [session({ private_ip: '10.0.0.7' })] })
        expect(await fetchAccountSessions(settings)).toEqual([session({ private_ip: '10.0.0.7' })])
        expect(calls[0].url).toBe('https://api.example.test/api/auth/sessions')
        expect(calls[0].settings).toBe(settings)
        expect(new Headers(calls[0].init.headers).get('authorization')).toBe('Bearer synthetic-token')
        expect(calls[0].init.signal).toBeInstanceOf(AbortSignal)
    })

    it('revokes only the selected server token ID', async () => {
        response = () => Response.json({ revoked: true, token_id: 3 })
        await revokeAccountSession(settings, 3)
        expect(calls[0].url).toBe('https://api.example.test/api/auth/sessions/3')
        expect(calls[0].init.method).toBe('DELETE')
    })

    it('does not report success when the server did not revoke the session', async () => {
        response = () => Response.json({ revoked: false, token_id: 3 })
        await expect(revokeAccountSession(settings, 3)).rejects.toThrow('could not be revoked')
    })

    it('preserves the current device when revoking other sessions', async () => {
        response = () => Response.json({ revoked: 2 })
        await revokeOtherAccountSessions(settings)
        expect(calls[0].url).toBe('https://api.example.test/api/auth/sessions/revoke')
        expect(calls[0].init.method).toBe('POST')
        expect(JSON.parse(String(calls[0].init.body))).toEqual({ keep_current: true })
    })

    it('revokes the selected current session before clearing local credentials', async () => {
        let cleared = false
        response = () => { expect(cleared).toBe(false); return Response.json({ revoked: true }) }
        const result = await logOutCurrentAccountSession(settings, async () => {
            expect(calls.length).toBe(1)
            expect(calls[0].url).toBe('https://api.example.test/api/auth/sessions/3')
            expect(calls[0].init.method).toBe('DELETE')
            cleared = true
        }, session({ current: true }))
        expect(result).toEqual({ serverRevoked: true })
        expect(cleared).toBe(true)
    })

    it('uses the same policy for security-page logout without an already loaded session', async () => {
        let cleared = false
        response = () => calls.length === 1
            ? Response.json({ sessions: [session({ token_id: 9 }), session({ current: true })] })
            : Response.json({ revoked: true })
        await logOutCurrentAccountSession(settings, async () => { cleared = true })
        expect(calls.map(call => [call.url, call.init.method || 'GET'])).toEqual([
            ['https://api.example.test/api/auth/sessions', 'GET'],
            ['https://api.example.test/api/auth/sessions/3', 'DELETE'],
        ])
        expect(cleared).toBe(true)
    })

    it('clears local credentials and reports unconfirmed server revocation when DELETE fails', async () => {
        let cleared = false
        response = () => Response.json({ revoked: false })
        expect(await logOutCurrentAccountSession(settings, async () => { cleared = true }, session({ current: true }))).toEqual({ serverRevoked: false })
        expect(calls[0].init.method).toBe('DELETE')
        expect(cleared).toBe(true)
    })

    it('allows local logout when offline or session lookup returns 401', async () => {
        for (const failure of ['offline', 'expired']) {
            calls = []
            let cleared = false
            response = () => {
                if (failure === 'offline') throw new Error('Network unavailable')
                return Response.json({ error: 'Session expired.' }, { status: 401 })
            }
            expect(await logOutCurrentAccountSession(settings, async () => { cleared = true })).toEqual({ serverRevoked: false })
            expect(calls).toHaveLength(1)
            expect(calls[0].init.method).toBeUndefined()
            expect(cleared).toBe(true)
        }
    })

    it('allows local logout without revoking a non-current or already revoked selection', async () => {
        for (const selected of [session(), session({ current: true, revoked_at: '2026-10-22T12:00:00Z' })]) {
            let cleared = false
            expect(await logOutCurrentAccountSession(settings, async () => { cleared = true }, selected)).toEqual({ serverRevoked: false })
            expect(cleared).toBe(true)
        }
        expect(calls).toHaveLength(0)
    })

    it('allows local logout when the server list has no current session', async () => {
        let cleared = false
        response = () => Response.json({ sessions: [session()] })
        expect(await logOutCurrentAccountSession(settings, async () => { cleared = true })).toEqual({ serverRevoked: false })
        expect(cleared).toBe(true)
        expect(calls).toHaveLength(1)
    })

    it('propagates local credential-clear failure with and without confirmed server revocation', async () => {
        for (const revoked of [true, false]) {
            response = () => Response.json({ revoked })
            await expect(logOutCurrentAccountSession(settings, async () => { throw new Error('SecureStore unavailable') }, session({ current: true }))).rejects.toThrow('SecureStore unavailable')
        }
    })

    it('reports authorization and malformed list failures', async () => {
        response = () => Response.json({ error: 'Session expired.' }, { status: 401 })
        await expect(fetchAccountSessions(settings)).rejects.toThrow('Session expired.')
        response = () => Response.json({ sessions: null })
        await expect(fetchAccountSessions(settings)).rejects.toThrow('invalid list')
    })
})
