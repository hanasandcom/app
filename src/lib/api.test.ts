import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'
import type { AppSettings } from '../types'

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

const { AuthenticationError, fetchDesktopAgentStatus, refreshHanasandSession, runDesktopAgentCommand } = await import('./api')

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

describe('desktop command proof', () => {
    it('rejects authenticated bridge responses that are not encrypted', async () => {
        const requestSettings = { ...settings, desktopAgentBaseUrl: 'http://localhost:45731' }
        mockFetch(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))

        await expect(fetchDesktopAgentStatus(requestSettings)).rejects.toThrow('without the required encryption envelope')
    })

    it('encrypts commands and authenticates the exact encrypted request body with HMAC-SHA256', async () => {
        const requestSettings = { ...settings, desktopAgentBaseUrl: 'http://127.0.0.1:45731' }
        const command = `mac_control_type_text:${'ø🚲'.repeat(50)}`
        let capturedInit: RequestInit | undefined
        const certificate = createHash('sha256')
            .update(`hanasand-desktop-agent-session-v1\n${settings.userId}\n${settings.authToken}`)
            .digest('hex')
        const aesKey = createHash('sha256')
            .update(`hanasand-desktop-agent-transport-v1\n${certificate}`)
            .digest()
        mockFetch(async (_input, init) => {
            capturedInit = init
            const iv = randomBytes(12)
            const cipher = createCipheriv('aes-256-gcm', aesKey, iv)
            const encrypted = Buffer.concat([cipher.update(JSON.stringify({ ok: true })), cipher.final(), cipher.getAuthTag()])
            return new Response(JSON.stringify({ encrypted: true, payload: Buffer.concat([iv, encrypted]).toString('base64') }), { status: 200 })
        })

        const result = await runDesktopAgentCommand(requestSettings, command)
        expect(result.ok).toBe(true)

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
