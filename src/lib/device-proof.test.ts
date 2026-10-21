import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { createHash } from 'node:crypto'
import { p256 } from '@noble/curves/nist.js'

let storedKey: string | null = null
mock.module('expo-secure-store', () => ({
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
    getItemAsync: async () => storedKey,
    setItemAsync: async (_key: string, value: string) => { storedKey = value },
}))
mock.module('expo-crypto', () => ({
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    CryptoDigestEncoding: { HEX: 'hex', BASE64: 'base64' },
    CryptoDigestOptions: {},
    CryptoEncoding: { HEX: 'hex', BASE64: 'base64' },
    digest: async (_algorithm: string, data: Uint8Array) => new Uint8Array(createHash('sha256').update(data).digest()).buffer,
    getRandomBytesAsync: async (count: number) => {
        const key = new Uint8Array(count)
        key[count - 1] = 1
        return key
    },
    randomUUID: () => 'e41a2a45-34fa-4d91-84e0-623e4e5ed123',
}))

const { createDeviceProof } = await import('./device-proof')

describe('mobile device proof', () => {
    beforeEach(() => { storedKey = null })

    it('creates an ES256 proof bound to its P-256 public key, token, method, and URL', async () => {
        const token = 'session-token'
        const signed = await createDeviceProof(token, 'post', 'https://cdn.hanasand.com/api/share?x=1')
        const [encodedHeader, encodedClaims, encodedSignature] = signed.proof.split('.')
        const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString())
        const claims = JSON.parse(Buffer.from(encodedClaims, 'base64url').toString())
        const point = Uint8Array.from([
            4,
            ...Buffer.from(signed.publicJwk.x, 'base64url'),
            ...Buffer.from(signed.publicJwk.y, 'base64url'),
        ])
        const accessTokenHash = createHash('sha256').update(token).digest('base64url')

        expect(header).toEqual({ typ: 'dpop+jwt', alg: 'ES256', jwk: signed.publicJwk })
        expect(claims).toMatchObject({ htm: 'POST', htu: 'https://cdn.hanasand.com/api/share', ath: accessTokenHash })
        expect(p256.verify(Buffer.from(encodedSignature, 'base64url'), Buffer.from(`${encodedHeader}.${encodedClaims}`), point)).toBe(true)
        expect(signed.url).toBe(claims.htu)
    })
})
