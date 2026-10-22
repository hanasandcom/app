import { expect, mock, test } from 'bun:test'
import { createHash, randomUUID } from 'node:crypto'

let reads = 0
let writes = 0
let failWrite = true
let randomCounter = 0

mock.module('expo-secure-store', () => ({
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
    getItemAsync: async () => { reads++; await Promise.resolve(); return null },
    setItemAsync: async () => {
        writes++
        await Promise.resolve()
        if (failWrite) { failWrite = false; throw new Error('Keychain temporarily unavailable') }
    },
}))
mock.module('expo-crypto', () => ({
    CryptoDigestAlgorithm: { SHA256: 'SHA256' },
    randomUUID,
    getRandomBytesAsync: async () => {
        const key = new Uint8Array(32)
        key[31] = ++randomCounter
        return key
    },
    digest: async (_algorithm: string, input: Uint8Array) => Uint8Array.from(createHash('sha256').update(input).digest()).buffer,
}))

test('concurrent first requests share one persisted device key and retry after storage failure', async () => {
    const { getDevicePublicJwk, createDeviceProof } = await import('./device-proof')
    await expect(getDevicePublicJwk()).rejects.toThrow('Keychain temporarily unavailable')
    const keys = await Promise.all(Array.from({ length: 6 }, () => getDevicePublicJwk()))
    expect(reads).toBe(2)
    expect(writes).toBe(2)
    for (const key of keys) expect(key).toEqual(keys[0])
    const { proof } = await createDeviceProof('synthetic-session', 'GET', 'https://hanasand.com/api/backend/ai/workspace')
    const header = JSON.parse(Buffer.from(proof.split('.')[0], 'base64url').toString())
    expect(header.jwk).toEqual(keys[0])
    expect(await getDevicePublicJwk()).toEqual(keys[0])
    expect(reads).toBe(2)
})
