import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createHash, createHmac } from 'node:crypto'
import type { AppSettings } from '../types'
import { AuthenticationError, refreshHanasandSession, runDesktopAgentCommand } from './api'

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
    it('authenticates the exact serialized command body with HMAC-SHA256', async () => {
        const requestSettings = { ...settings, desktopAgentBaseUrl: 'http://127.0.0.1:45731' }
        const command = `mac_control_type_text:${'ø🚲'.repeat(50)}`
        let capturedInit: RequestInit | undefined
        mockFetch(async (_input, init) => {
            capturedInit = init
            return new Response(JSON.stringify({ ok: true }), { status: 200 })
        })

        await runDesktopAgentCommand(requestSettings, command)

        const body = JSON.stringify({ command })
        const headers = new Headers(capturedInit?.headers)
        const timestamp = headers.get('X-Hanasand-Session-Timestamp')!
        const nonce = headers.get('X-Hanasand-Session-Nonce')!
        const proof = headers.get('X-Hanasand-Session-Proof')!
        const certificate = createHash('sha256')
            .update(`hanasand-desktop-agent-session-v1\n${settings.userId}\n${settings.authToken}`)
            .digest('hex')
        const bodyHash = createHash('sha256').update(body).digest('hex')
        const material = `POST\n/command\n${timestamp}\n${nonce}\n${bodyHash}`
        const expectedProof = createHmac('sha256', certificate).update(material).digest('hex')

        expect(capturedInit?.body).toBe(body)
        expect(proof).toBe(expectedProof)
        expect(proof).not.toBe(createHmac('sha256', certificate).update(
            `POST\n/command\n${timestamp}\n${nonce}\n${createHash('sha256').update(JSON.stringify({ command: `${command}altered` })).digest('hex')}`,
        ).digest('hex'))
    })
})
