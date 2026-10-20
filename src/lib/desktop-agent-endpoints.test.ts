import { describe, expect, it } from 'bun:test'
import { normalizePinnedDesktopAgentEndpoint, trustedDesktopAgentEndpoints } from './desktop-agent-endpoints'

describe('pinned desktop agent endpoints', () => {
    it('accepts HTTPS with a lowercase SHA-256 pin and normalizes a trailing slash', () => {
        expect(normalizePinnedDesktopAgentEndpoint('https://mac.local:45731/', 'a'.repeat(64))).toEqual({
            url: 'https://mac.local:45731',
            pin: 'a'.repeat(64),
        })
    })

    it('rejects HTTP, malformed pins, credentials, queries, and fragments', () => {
        expect(normalizePinnedDesktopAgentEndpoint('http://mac.local:45731', 'a'.repeat(64))).toBeNull()
        expect(normalizePinnedDesktopAgentEndpoint('https://mac.local:45731', 'A'.repeat(64))).toBeNull()
        expect(normalizePinnedDesktopAgentEndpoint('https://user@mac.local:45731', 'a'.repeat(64))).toBeNull()
        expect(normalizePinnedDesktopAgentEndpoint('https://mac.local:45731?x=1', 'a'.repeat(64))).toBeNull()
        expect(normalizePinnedDesktopAgentEndpoint('https://mac.local:45731#fragment', 'a'.repeat(64))).toBeNull()
    })

    it('uses only pins from authenticated presence records and prefers the configured HTTPS host', () => {
        const endpoints = trustedDesktopAgentEndpoints([
            { deviceId: 'without-pin', endpoints: ['https://untrusted.local:45731'], tlsCertificateSha256: '' },
            { deviceId: 'bad-pin', endpoints: ['https://bad.local:45731'], tlsCertificateSha256: 'not-a-pin' },
            { deviceId: 'first', endpoints: ['https://first.local:45731'], tlsCertificateSha256: 'a'.repeat(64) },
            { deviceId: 'preferred', endpoints: ['https://preferred.local:45731'], tlsCertificateSha256: 'b'.repeat(64) },
        ], 'https://preferred.local:45731')

        expect(endpoints).toEqual([
            { url: 'https://preferred.local:45731', pin: 'b'.repeat(64) },
            { url: 'https://first.local:45731', pin: 'a'.repeat(64) },
        ])
    })
})
