import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'
import type { AppSettings } from '../types'

type PinnedEndpoint = { url: string; pin: string }
type PinnedRequest = (endpoint: PinnedEndpoint, path: string, init?: RequestInit) => Promise<Response>
let pinnedRequest: PinnedRequest = async () => { throw new Error('Pinned transport was not configured in this test.') }
let passkeyRequestOptions: Record<string, unknown> | undefined
const passkeyCredential = { id: 'credential-id', rawId: 'cmF3LWlk', type: 'public-key', response: { clientDataJSON: 'Y2xpZW50LWRhdGE=', authenticatorData: 'YXV0aC1kYXRh', signature: 'c2lnbmF0dXJl', userHandle: null } }
mock.module('./pinned-desktop-transport', () => ({
    requestPinnedDesktopAgent: (endpoint: PinnedEndpoint, path: string, init?: RequestInit) => pinnedRequest(endpoint, path, init),
}))
mock.module('./device-proof', () => ({
    getDevicePublicJwk: async () => ({ kty: 'EC', crv: 'P-256', x: 'test-x', y: 'test-y' }),
    createDeviceProof: async (_token: string, _method: string, url: string) => ({ proof: 'test-dpop', url }),
}))
mock.module('react-native-passkeys', () => ({
    get: async (options: Record<string, unknown>) => {
        passkeyRequestOptions = options
        return passkeyCredential
    },
}))

class TestSealedData {
    constructor(readonly bytes: Buffer) {}

    async combined() {
        return this.bytes.toString('base64')
    }

    static fromCombined(encoded: string) {
        return new TestSealedData(Buffer.from(encoded, 'base64'))
    }
}

mock.module('expo-crypto', () => ({
    AESEncryptionKey: {
        import: async (hex: string) => ({ bytes: Buffer.from(hex, 'hex') }),
    },
    AESSealedData: TestSealedData,
    getRandomBytesAsync: async (count: number) => new Uint8Array(randomBytes(count)),
    aesEncryptAsync: async (plaintext: Uint8Array, key: { bytes: Buffer }) => {
        const iv = randomBytes(12)
        const cipher = createCipheriv('aes-256-gcm', key.bytes, iv)
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])
        return new TestSealedData(Buffer.concat([iv, ciphertext]))
    },
    aesDecryptAsync: async (sealed: TestSealedData, key: { bytes: Buffer }) => {
        const iv = sealed.bytes.subarray(0, 12)
        const ciphertext = sealed.bytes.subarray(12, -16)
        const tag = sealed.bytes.subarray(-16)
        const decipher = createDecipheriv('aes-256-gcm', key.bytes, iv)
        decipher.setAuthTag(tag)
        return new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()]))
    },
}))

const { startMobileImpersonation, stopMobileImpersonation, isHanasandOrganizationMember, apiFetch, fetchAiModels, createHanasandBrowserSignInUrl, fetchNotes, AuthenticationError, exchangeHanasandMobileSsoCode, fetchDesktopAgentStatus, isHanasandGoogleSignInConfigured, loginToHanasand, loginWithHanasandPasskey, refreshHanasandSession, runDesktopAgentCommand } = await import('./api')

const settings: AppSettings = {
    themeMode: 'obsidian',
    workspaceMode: 'coding',
    siteBaseUrl: 'https://hanasand.com',
    apiBaseUrl: 'https://example.test/api',
    cdnBaseUrl: 'https://cdn.example.test/api',
    authToken: 'test-token',
    userId: 'test-user',
    impersonationToken: '',
    impersonatingUserId: '',
    impersonatingUserName: '',
    codexUrl: 'https://hanasand.com/ai',
    codexApiPath: '/tools/ai',
    desktopAgentBaseUrl: '',
    vpnUrlScheme: 'ciscoanyconnect://',
    remoteDesktopHost: '',
    remoteDesktopUser: '',
    vncHost: '',
    serverBaseUrl: '',
    serverStartPath: '/start',
    serverStopPath: '/stop',
    serverLogsPath: '/logs',
}

const originalFetch = globalThis.fetch

function mockFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
    globalThis.fetch = handler as unknown as typeof fetch
}

beforeEach(() => {
    pinnedRequest = async () => { throw new Error('Pinned transport was not configured in this test.') }
    passkeyRequestOptions = undefined
    mockFetch(async () => new Response(JSON.stringify({ error: 'Rejected' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
    }))
})

afterEach(() => {
    globalThis.fetch = originalFetch
})

describe('refreshHanasandSession error classification', () => {
    it('keeps assigned Identity role IDs and accepts historical role shapes', async () => {
        mockFetch(async () => Response.json({ id: settings.userId, token: 'synthetic-refreshed-token', roles: [
            { role_id: 'analyst', id: 'unrelated-assignment-id' }, 'source_operator', { id: 'system_admin' }, { name: 'legacy-role' }, {},
        ] }))
        expect((await refreshHanasandSession(settings)).roles).toEqual(['analyst', 'source_operator', 'system_admin', 'legacy-role'])
    })
    it('marks explicit HTTP 401 and 403 responses as authentication rejection', async () => {
        for (const status of [401, 403]) {
            mockFetch(async () => new Response(JSON.stringify({ error: 'Rejected' }), {
                status,
                headers: { 'Content-Type': 'application/json' },
            }))
            await expect(refreshHanasandSession(settings)).rejects.toBeInstanceOf(AuthenticationError)
        }
    })

    it('keeps server, network, and malformed success-body errors generic', async () => {
        mockFetch(async () => new Response(JSON.stringify({ error: 'Unavailable' }), { status: 500 }))
        await expect(refreshHanasandSession(settings)).rejects.toThrow('Unavailable')
        await expect(refreshHanasandSession(settings)).rejects.not.toBeInstanceOf(AuthenticationError)

        mockFetch(async () => { throw new TypeError('Network request failed') })
        await expect(refreshHanasandSession(settings)).rejects.toThrow('Network request failed')
        await expect(refreshHanasandSession(settings)).rejects.not.toBeInstanceOf(AuthenticationError)

        mockFetch(async () => new Response('{}', { status: 200 }))
        await expect(refreshHanasandSession(settings)).rejects.toThrow('Unable to sign in.')
        await expect(refreshHanasandSession(settings)).rejects.not.toBeInstanceOf(AuthenticationError)
    })
})

describe('secure API transport', () => {
    it('rejects HTTP even when the target is on a private LAN', async () => {
        let requestCount = 0
        mockFetch(async () => {
            requestCount += 1
            return new Response('{}', { status: 200 })
        })

        await expect(fetchDesktopAgentStatus({
            ...settings,
            apiBaseUrl: 'http://192.168.1.20:8080/api',
        })).rejects.toThrow('Blocked insecure plaintext endpoint')
        expect(requestCount).toBe(0)
    })
})

describe('desktop agent discovery retry', () => {
    it('does not cache an HTTP failure as an empty presence result', async () => {
        let discoveryRequests = 0
        mockFetch(async input => {
            if (String(input).endsWith('/desktop-agent/presence')) {
                discoveryRequests += 1
                if (discoveryRequests === 1) return new Response('{"error":"temporarily unavailable"}', { status: 503 })
                return Response.json({ agents: [] })
            }
            throw new Error(`Unexpected request: ${String(input)}`)
        })

        const requestSettings = { ...settings, authToken: 'desktop-discovery-retry-token' }
        await expect(fetchDesktopAgentStatus(requestSettings)).rejects.toThrow('HTTP 503')
        await expect(fetchDesktopAgentStatus(requestSettings)).rejects.toThrow('No HTTPS desktop agent')
        expect(discoveryRequests).toBe(2)
    })

    it('times out a stalled presence request and exposes a retryable error', async () => {
        mockFetch(async (_input, init) => new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
        }))

        await expect(fetchDesktopAgentStatus({ ...settings, authToken: 'desktop-discovery-timeout-token' }))
            .rejects.toThrow('Desktop agent discovery timed out. Check your connection and retry.')
    }, 15_000)
})

describe('browser sign-in routing', () => {
    const challenge = 'a'.repeat(43)

    it('starts Google on the callback website so its host-only mobile cookie survives', () => {
        const production = { ...settings, apiBaseUrl: 'https://api.hanasand.com/api' }
        const url = new URL(createHanasandBrowserSignInUrl(production, 'google', challenge))
        expect(url.origin).toBe('https://hanasand.com')
        expect(url.pathname).toBe('/api/auth/social/google/start')
        expect(url.searchParams.get('mobile_challenge')).toBe(challenge)
    })

    it('starts SSO on the website mobile handoff route', () => {
        const production = { ...settings, apiBaseUrl: 'https://api.hanasand.com/api' }
        const url = new URL(createHanasandBrowserSignInUrl(production, 'sso', challenge))
        expect(url.origin).toBe('https://hanasand.com')
        expect(url.pathname).toBe('/api/auth/mobile/sso/start')
        expect(url.searchParams.get('code_challenge')).toBe(challenge)
    })

    it('preserves explicitly configured custom authentication endpoints', () => {
        const url = new URL(createHanasandBrowserSignInUrl(settings, 'google', challenge))
        expect(url.origin).toBe('https://example.test')
        expect(url.pathname).toBe('/api/auth/social/google/start')
    })
})

describe('Google sign-in availability route', () => {
    it('reads the configured provider state from the website auth proxy', async () => {
        let requestedUrl = ''
        mockFetch(async input => {
            requestedUrl = String(input)
            return new Response(JSON.stringify({ providers: [{ provider: 'google', configured: true }] }), { status: 200 })
        })

        await expect(isHanasandGoogleSignInConfigured(settings)).resolves.toBe(true)
        expect(requestedUrl).toBe('https://example.test/api/auth/social/providers')
    })

    it('returns false when Google is not configured and surfaces a missing route clearly', async () => {
        mockFetch(async () => new Response(JSON.stringify({ providers: [{ provider: 'google', configured: false }] }), { status: 200 }))
        await expect(isHanasandGoogleSignInConfigured(settings)).resolves.toBe(false)

        mockFetch(async () => new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }))
        await expect(isHanasandGoogleSignInConfigured(settings)).rejects.toThrow('Not found')

        mockFetch(async () => new Response('{}', { status: 404 }))
        await expect(isHanasandGoogleSignInConfigured(settings)).rejects.toThrow('Request failed with HTTP 404.')
    })
})

describe('mobile authentication route contracts', () => {
    it('posts password credentials to the API login route and normalizes the session', async () => {
        let requestUrl = ''
        let requestBody: unknown
        mockFetch(async (input, init) => {
            requestUrl = String(input)
            requestBody = JSON.parse(String(init?.body))
            return new Response(JSON.stringify({ id: 'user-1', name: 'User', token: 'session-token' }), { status: 200 })
        })

        await expect(loginToHanasand(settings, ' analyst ', 'password'))
            .resolves.toMatchObject({ id: 'user-1', token: 'session-token' })
        expect(requestUrl).toBe('https://example.test/api/auth/mobile/login')
        expect(requestBody).toEqual({ id: 'analyst', password: 'password' })
    })

    it('exchanges the mobile PKCE code through the frontend auth proxy', async () => {
        let requestUrl = ''
        let requestMethod = ''
        let requestBody: unknown
        mockFetch(async (input, init) => {
            requestUrl = String(input)
            requestMethod = init?.method || 'GET'
            requestBody = JSON.parse(String(init?.body))
            return new Response(JSON.stringify({ id: 'user-1', name: 'User', token: 'session-token' }), { status: 200 })
        })

        await expect(exchangeHanasandMobileSsoCode(settings, 'a'.repeat(43), 'v'.repeat(43)))
            .resolves.toMatchObject({ id: 'user-1', token: 'session-token' })
        expect(requestUrl).toBe('https://example.test/api/auth/mobile/sso/exchange')
        expect(requestMethod).toBe('POST')
        expect(requestBody).toEqual({ code: 'a'.repeat(43), verifier: 'v'.repeat(43) })
    })

    it('loads passkey options and posts the assertion to the mobile verification proxy', async () => {
        const requests: Array<{ url: string, method: string, body: unknown }> = []
        mockFetch(async (input, init) => {
            const url = String(input)
            const method = init?.method || 'GET'
            const body = init?.body ? JSON.parse(String(init.body)) : undefined
            requests.push({ url, method, body })
            return requests.length === 1
                ? new Response(JSON.stringify({ challengeId: 'challenge-1', publicKey: { challenge: 'Y2hhbGxlbmdl', rpId: 'hanasand.com' } }), { status: 200 })
                : new Response(JSON.stringify({ id: 'user-1', token: 'session-token' }), { status: 200 })
        })

        await expect(loginWithHanasandPasskey(settings, 'analyst')).resolves.toMatchObject({ id: 'user-1', token: 'session-token' })
        expect(requests).toEqual([
            { url: 'https://example.test/api/auth/passkeys/authenticate/options?username=analyst', method: 'GET', body: undefined },
            { url: 'https://example.test/api/auth/mobile/passkeys/authenticate/verify', method: 'POST', body: { challengeId: 'challenge-1', credential: passkeyCredential } },
        ])
        expect(passkeyRequestOptions).toMatchObject({ challenge: 'Y2hhbGxlbmdl', rpId: 'hanasand.com' })
    })
})

describe('desktop command proof', () => {
    it('refuses to contact an endpoint without an authenticated certificate pin', async () => {
        const requestSettings = { ...settings, authToken: 'no-pin-token', desktopAgentBaseUrl: 'http://192.168.1.20:45731' }
        let fetchCalls = 0
        let pinnedCalls = 0
        mockFetch(async () => {
            fetchCalls += 1
            return new Response(JSON.stringify({ agents: [{
                deviceId: 'mac', endpoints: ['http://192.168.1.20:45731'],
            }] }), { status: 200 })
        })
        pinnedRequest = async () => {
            pinnedCalls += 1
            return new Response('{}')
        }

        await expect(fetchDesktopAgentStatus(requestSettings)).rejects.toThrow('valid certificate pin')
        expect(fetchCalls).toBe(1)
        expect(pinnedCalls).toBe(0)
    })

    it('rejects authenticated bridge responses that are not encrypted', async () => {
        const requestSettings = { ...settings, authToken: 'unencrypted-response-token', desktopAgentBaseUrl: 'https://desktop.example.test:45731' }
        mockFetch(async () => new Response(JSON.stringify({ agents: [{
            deviceId: 'mac', endpoints: ['https://desktop.example.test:45731'], tlsCertificateSha256: 'a'.repeat(64),
        }] }), { status: 200 }))
        pinnedRequest = async () => new Response(JSON.stringify({ ok: true }), { status: 200 })

        await expect(fetchDesktopAgentStatus(requestSettings)).rejects.toThrow('without the required encryption envelope')
    })

    it('retries a timed-out read-only desktop status once and never retries a command', async () => {
        const requestSettings = { ...settings, authToken: 'status-timeout-token', desktopAgentBaseUrl: 'https://desktop.example.test:45731' }
        mockFetch(async () => new Response(JSON.stringify({ agents: [{
            deviceId: 'mac', endpoints: ['https://desktop.example.test:45731'], tlsCertificateSha256: 'c'.repeat(64),
        }] }), { status: 200 }))
        const certificate = createHash('sha256')
            .update(`hanasand-desktop-agent-session-v1\n${requestSettings.userId}\n${requestSettings.authToken}`)
            .digest('hex')
        const key = createHash('sha256').update(`hanasand-desktop-agent-transport-v1\n${certificate}`).digest()
        let statusCalls = 0
        pinnedRequest = async (_endpoint, path) => {
            if (path === 'status' && ++statusCalls === 1) throw new Error('The request timed out.')
            const iv = randomBytes(12)
            const cipher = createCipheriv('aes-256-gcm', key, iv)
            const encrypted = Buffer.concat([cipher.update(JSON.stringify({ ok: true, agent: 'Hanasand' })), cipher.final(), cipher.getAuthTag()])
            return Response.json({ encrypted: true, payload: Buffer.concat([iv, encrypted]).toString('base64') })
        }
        await expect(fetchDesktopAgentStatus(requestSettings)).resolves.toMatchObject({ ok: true, agent: 'Hanasand' })
        expect(statusCalls).toBe(2)

        statusCalls = 0
        pinnedRequest = async () => { statusCalls++; throw new Error('The request timed out.') }
        await expect(runDesktopAgentCommand(requestSettings, 'mac_control_status')).rejects.toThrow('The request timed out.')
        expect(statusCalls).toBe(1)
    }, 5_000)

    it('encrypts commands and authenticates the exact encrypted request body with HMAC-SHA256', async () => {
        const requestSettings = { ...settings, authToken: 'encrypted-command-token', desktopAgentBaseUrl: 'https://desktop.example.test:45731' }
        const command = `mac_control_type_text:${'ø🚲'.repeat(50)}`
        let capturedInit: RequestInit | undefined
        let capturedEndpoint: PinnedEndpoint | undefined
        mockFetch(async () => new Response(JSON.stringify({ agents: [{
            deviceId: 'mac', endpoints: ['https://desktop.example.test:45731'], tlsCertificateSha256: 'b'.repeat(64),
        }] }), { status: 200 }))
        const certificate = createHash('sha256')
            .update(`hanasand-desktop-agent-session-v1\n${requestSettings.userId}\n${requestSettings.authToken}`)
            .digest('hex')
        const aesKey = createHash('sha256')
            .update(`hanasand-desktop-agent-transport-v1\n${certificate}`)
            .digest()
        pinnedRequest = async (endpoint, _path, init) => {
            capturedEndpoint = endpoint
            capturedInit = init
            const iv = randomBytes(12)
            const cipher = createCipheriv('aes-256-gcm', aesKey, iv)
            const encrypted = Buffer.concat([cipher.update(JSON.stringify({ ok: true })), cipher.final(), cipher.getAuthTag()])
            return new Response(JSON.stringify({ encrypted: true, payload: Buffer.concat([iv, encrypted]).toString('base64') }), { status: 200 })
        }

        const result = await runDesktopAgentCommand(requestSettings, command)
        expect(result.ok).toBe(true)
        expect(capturedEndpoint).toEqual({ url: 'https://desktop.example.test:45731', pin: 'b'.repeat(64) })

        const wireBody = String(capturedInit?.body)
        const envelope = JSON.parse(wireBody) as { encrypted: boolean; payload: string }
        expect(envelope.encrypted).toBe(true)
        const sealed = Buffer.from(envelope.payload, 'base64')
        const decipher = createDecipheriv('aes-256-gcm', aesKey, sealed.subarray(0, 12))
        decipher.setAuthTag(sealed.subarray(-16))
        const plaintext = Buffer.concat([decipher.update(sealed.subarray(12, -16)), decipher.final()]).toString('utf8')
        expect(plaintext).toBe(JSON.stringify({ command }))

        const headers = new Headers(capturedInit?.headers)
        const timestamp = headers.get('X-Hanasand-Session-Timestamp')!
        const nonce = headers.get('X-Hanasand-Session-Nonce')!
        const proof = headers.get('X-Hanasand-Session-Proof')!
        const bodyHash = createHash('sha256').update(wireBody).digest('hex')
        const material = `POST\n/command\n${timestamp}\n${nonce}\n${bodyHash}`
        const expectedProof = createHmac('sha256', certificate).update(material).digest('hex')

        expect(proof).toBe(expectedProof)
        expect(proof).not.toBe(createHmac('sha256', certificate).update(
            `POST\n/command\n${timestamp}\n${nonce}\n${createHash('sha256').update(`${wireBody}altered`).digest('hex')}`,
        ).digest('hex'))
    })
})


describe('workspace transport', () => {
    it('retains authentication status for model discovery recovery', async () => {
        for (const status of [401, 403]) {
            mockFetch(async () => new Response(JSON.stringify({ error: 'Synthetic authorization rejected' }), { status }))
            let failure: unknown
            try { await fetchAiModels(settings) } catch (cause) { failure = cause }
            expect(failure).toBeInstanceOf(Error)
            expect((failure as Error & { status: number }).status).toBe(status)
        }
    })

    it('forwards discovery cancellation and skips a pre-aborted model read', async () => {
        const controller = new AbortController()
        let calls = 0
        mockFetch(async (_input, init) => {
            calls++
            expect(init?.signal).toBe(controller.signal)
            return new Response(JSON.stringify({ connected: [] }))
        })
        expect(await fetchAiModels(settings, controller.signal)).toEqual([])
        controller.abort()
        await expect(fetchAiModels(settings, controller.signal)).rejects.toThrow('cancelled')
        expect(calls).toBe(1)
    })

    it('preserves authenticated proof and cancellation with a native streaming transport', async () => {
        let globalCalls = 0
        mockFetch(async () => { globalCalls++; throw new Error('The buffered fetch must not handle this stream.') })
        const target = 'https://api.hanasand.com/api/traffic/live'
        const controller = new AbortController()
        const selected = { ...settings, apiBaseUrl: 'https://api.hanasand.com/api', authToken: 'synthetic-bound-token', selectedOrganizationId: 'org-123' }
        let sent: RequestInit | undefined
        const streaming = (async (input: RequestInfo | URL, init?: RequestInit) => {
            expect(String(input)).toBe(target)
            sent = init
            return new Response('event: ready\ndata: {}\n\n', { headers: { 'content-type': 'text/event-stream' } })
        }) as typeof fetch
        const response = await apiFetch(selected, target, { signal: controller.signal, headers: { Accept: 'text/event-stream' } }, streaming)
        const sentHeaders = new Headers(sent?.headers)
        expect(sentHeaders.get('Authorization')).toBe('Bearer synthetic-bound-token')
        expect(sentHeaders.get('dpop')).toBe('test-dpop')
        expect(sentHeaders.get('x-device-proof-url')).toBe(target)
        expect(sentHeaders.get('x-device-proof-method')).toBe('GET')
        expect(sentHeaders.get('x-organization-id')).toBe('org-123')
        expect(sentHeaders.get('Accept')).toBe('text/event-stream')
        expect(sent?.signal).toBe(controller.signal)
        expect(sent?.credentials).toBe('omit')
        expect(await response.text()).toContain('event: ready')
        expect(globalCalls).toBe(0)
    })

    it('sends the selected organization only to the configured API origin', async () => {
        const requests: Headers[] = []
        mockFetch(async (_input, init) => { requests.push(new Headers(init?.headers)); return new Response('{}') })
        const selected = { ...settings, selectedOrganizationId: 'org-123' }
        await apiFetch(selected, `${settings.apiBaseUrl}/notes`)
        await apiFetch(selected, 'https://other.example.test/notes')
        await apiFetch({ ...selected, selectedOrganizationId: 'personal' }, `${settings.apiBaseUrl}/notes`)
        expect(requests.map(value => value.get('x-organization-id'))).toEqual(['org-123', null, null])
    })

    it('lets the native transport supply the multipart boundary', async () => {
        let sentHeaders = new Headers()
        let sentBody: BodyInit | null | undefined
        let credentials: RequestCredentials | undefined
        mockFetch(async (_input, init) => { sentHeaders = new Headers(init?.headers); sentBody = init?.body; credentials = init?.credentials; return new Response('{}') })
        const form = new FormData()
        form.append('prompt', 'connection check')
        await apiFetch(settings, 'https://hanasand.com/api/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: form })
        expect(sentHeaders.has('Content-Type')).toBe(false)
        expect(sentBody).toBe(form)
        expect(credentials).toBe('omit')
    })
})


describe('notes response integrity', () => {
    it('rejects a malformed response instead of treating it as an empty library', async () => {
        for (const body of ['{', '{}', 'null']) {
            mockFetch(async () => new Response(body, { status: 200 }))
            await expect(fetchNotes(settings)).rejects.toThrow('invalid response')
        }
        mockFetch(async () => new Response('[]', { status: 200 }))
        await expect(fetchNotes(settings)).resolves.toEqual([])
    })
})

describe('native organization membership discovery', () => {
    it('signs the direct Identity URL and recognizes Hanasand membership', async () => {
        let target = ''
        let sent: Headers | undefined
        globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
            target = String(input)
            sent = new Headers(init?.headers)
            return Response.json({ organizations: [{ slug: 'hanasand', lifecycleStatus: 'active' }] })
        }, { preconnect: () => {} }) as typeof fetch
        expect(await isHanasandOrganizationMember({ ...settings, apiBaseUrl: 'https://api.hanasand.com/api' })).toBe(true)
        expect(target).toBe('https://identity.hanasand.com/api/organizations')
        expect(sent?.get('dpop')).toBe('test-dpop')
        expect(sent?.get('x-device-proof-url')).toBe(target)
        expect(sent?.get('authorization')).toBe('Bearer test-token')
    })
})


it('membership discovery distinguishes verified empty membership from unavailable or malformed responses', async () => {
    mockFetch(async () => Response.json({ organizations: [] }))
    expect(await isHanasandOrganizationMember(settings)).toBe(false)
    for (const status of [401, 403, 502, 503]) {
        mockFetch(async () => Response.json({ error: 'Synthetic failure' }, { status }))
        await expect(isHanasandOrganizationMember(settings)).rejects.toThrow(status === 401 ? 'Sign in again' : 'could not be checked')
    }
    for (const body of ['{}', 'null', '{']) {
        mockFetch(async () => new Response(body))
        await expect(isHanasandOrganizationMember(settings)).rejects.toThrow('invalid response')
    }
    mockFetch(async () => { throw new Error('Synthetic offline') })
    await expect(isHanasandOrganizationMember(settings)).rejects.toThrow('Synthetic offline')
})

it('model discovery rejects malformed envelopes without replacing them with zero clients', async () => {
    for (const body of ['{', 'null', '{}', '{"error":"unavailable"}', '{"connected":{}}', '{"connected":null}', '{"connected":[{}]}', '{"connected":[null]}']) {
        mockFetch(async () => new Response(body))
        await expect(fetchAiModels(settings)).rejects.toThrow('invalid response')
    }
    mockFetch(async () => Response.json({ connected: [] }))
    await expect(fetchAiModels(settings)).resolves.toEqual([])
})

describe('Identity impersonation contracts', () => {
    const own = { ...settings, apiBaseUrl: 'https://api.hanasand.com/api' }
    const token = 'a'.repeat(43)
    const receipt = () => ({ token, target: { id: 'target-user', name: 'Synthetic target' }, expiresAt: new Date(Date.now() + 3600000).toISOString() })
    it('signs direct Identity start and parses the top-level target without changing the actor session', async () => {
        const original = JSON.stringify(own)
        mockFetch(async (input, init) => {
            expect(String(input)).toBe('https://identity.hanasand.com/api/impersonation/start')
            expect(init?.method).toBe('POST')
            expect(init?.credentials).toBe('omit')
            expect(JSON.parse(String(init?.body))).toEqual({ targetId: 'target-user' })
            const sent = new Headers(init?.headers)
            expect(sent.get('authorization')).toBe('Bearer test-token')
            expect(sent.get('x-impersonation-token')).toBeNull()
            expect(sent.get('x-device-proof-url')).toBe(String(input))
            return Response.json(receipt())
        })
        expect(await startMobileImpersonation(own, 'target-user')).toMatchObject({ token, targetId: 'target-user', targetName: 'Synthetic target' })
        expect(JSON.stringify(own)).toBe(original)
    })
    it('rejects either impersonated mode, self and invalid targets before transport', async () => {
        let calls = 0; mockFetch(async () => { calls++; return Response.json(receipt()) })
        for (const changed of [{ impersonationToken: token }, { impersonatingUserId: 'other' }]) await expect(startMobileImpersonation({ ...own, ...changed }, 'target-user')).rejects.toThrow('own account')
        for (const id of [own.userId, '', ' target-user', 'a\nb', 'a'.repeat(201)]) await expect(startMobileImpersonation(own, id)).rejects.toThrow()
        expect(calls).toBe(0)
    })
    it('rejects wrong, missing, expired and nested receipts without automatic retries', async () => {
        for (const value of [{ ...receipt(), token: '' }, { ...receipt(), target: { id: 'foreign', name: 'Other' } }, { token, session: { target: receipt().target }, expiresAt: receipt().expiresAt }, { ...receipt(), expiresAt: '2000-01-01T00:00:00Z' }, {}]) {
            let calls = 0; mockFetch(async () => { calls++; return Response.json(value) })
            await expect(startMobileImpersonation(own, 'target-user')).rejects.toThrow('receipt could not be verified')
            expect(calls).toBe(1)
        }
    })
    it('revokes with POST stop and the original actor plus delegated token', async () => {
        mockFetch(async (input, init) => {
            expect(String(input)).toBe('https://identity.hanasand.com/api/impersonation/stop')
            expect(init?.method).toBe('POST'); expect(init?.body).toBeUndefined()
            const sent = new Headers(init?.headers)
            expect(sent.get('authorization')).toBe('Bearer test-token')
            expect(sent.get('id')).toBe(own.userId)
            expect(sent.get('x-impersonation-token')).toBe(token)
            expect(sent.get('dpop')).toBe('test-dpop')
            return Response.json({ ok: true })
        })
        await stopMobileImpersonation({ ...own, impersonationToken: token })
    })
    it('does not silently acknowledge failed or malformed revocation', async () => {
        for (const response of [() => Response.json({ error: 'synthetic failure' }, { status: 503 }), () => Response.json({}), () => { throw new Error('synthetic offline') }]) {
            let calls = 0; mockFetch(async () => { calls++; return response() })
            await expect(stopMobileImpersonation({ ...own, impersonationToken: token })).rejects.toThrow()
            expect(calls).toBe(1)
        }
    })
    it('makes no request without a delegated token or after pre-abort', async () => {
        let calls = 0; mockFetch(async () => { calls++; return Response.json(receipt()) })
        await stopMobileImpersonation(own)
        await stopMobileImpersonation({ ...own, impersonatingUserId: 'target-without-token' })
        const abort = new AbortController(); abort.abort()
        await expect(startMobileImpersonation(own, 'target-user', abort.signal)).rejects.toThrow('cancelled')
        await expect(stopMobileImpersonation({ ...own, impersonationToken: token }, abort.signal)).rejects.toThrow('cancelled')
        expect(calls).toBe(0)
    })
    it('binds Return persistence to the intent captured before revocation, including partial local states', async () => {
        const app = await Bun.file(new URL('../App.tsx', import.meta.url)).text()
        const start = app.indexOf('async function returnToOwnView()')
        const action = app.slice(start, app.indexOf('if (!settings && bootstrapError)', start))
        expect(action).toContain('(!before.impersonationToken && !before.impersonatingUserId)')
        expect(action.indexOf('const saveRevision = settingsWriteRevision()')).toBeLessThan(action.indexOf('await stopMobileImpersonation('))
        expect(action).toContain('if (!sameSession() || settingsWriteRevision() !== saveRevision) return')
        expect(action).toContain('await saveSettings(next, saveRevision)')
        expect(action).toContain('if (!sameSession() || settingsWriteRevision() !== saveRevision + 1) return')
        expect(app).toContain('!!(settings.impersonatingUserId || settings.impersonationToken)')
    })
})
