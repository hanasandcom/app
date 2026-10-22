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

const { apiFetch, createHanasandBrowserSignInUrl, fetchNotes, AuthenticationError, exchangeHanasandMobileSsoCode, fetchDesktopAgentStatus, isHanasandGoogleSignInConfigured, loginToHanasand, loginWithHanasandPasskey, refreshHanasandSession, runDesktopAgentCommand } = await import('./api')

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
