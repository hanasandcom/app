import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import { p256 } from '@noble/curves/nist.js'

const DEVICE_KEY_STORAGE = 'hanasand-mobile.device-proof-key'
const encoder = new TextEncoder()

export type DevicePublicJwk = { kty: 'EC'; crv: 'P-256'; x: string; y: string }
type DeviceKey = { privateKey: Uint8Array; publicJwk: DevicePublicJwk }
let cachedKey: DeviceKey | undefined

function base64Url(bytes: Uint8Array) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    let result = ''
    for (let index = 0; index < bytes.length; index += 3) {
        const a = bytes[index]
        const b = bytes[index + 1]
        const c = bytes[index + 2]
        result += alphabet[a >> 2]
        result += alphabet[((a & 3) << 4) | ((b ?? 0) >> 4)]
        if (b !== undefined) result += alphabet[((b & 15) << 2) | ((c ?? 0) >> 6)]
        if (c !== undefined) result += alphabet[c & 63]
    }
    return result
}

function fromBase64Url(value: string) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    const bytes: number[] = []
    let buffer = 0
    let bits = 0
    for (const character of value) {
        const digit = alphabet.indexOf(character)
        if (digit < 0) throw new Error('Invalid stored device key.')
        buffer = (buffer << 6) | digit
        bits += 6
        if (bits >= 8) {
            bits -= 8
            bytes.push((buffer >> bits) & 255)
        }
    }
    return Uint8Array.from(bytes)
}

async function loadOrCreateDeviceKey(): Promise<DeviceKey> {
    if (cachedKey) return cachedKey
    const stored = await SecureStore.getItemAsync(DEVICE_KEY_STORAGE)
    let privateKey: Uint8Array
    if (stored) {
        privateKey = fromBase64Url(stored)
        if (!p256.utils.isValidSecretKey(privateKey)) throw new Error('The saved device key is invalid. Sign in again.')
    } else {
        do {
            privateKey = await Crypto.getRandomBytesAsync(32)
        } while (!p256.utils.isValidSecretKey(privateKey))
        await SecureStore.setItemAsync(DEVICE_KEY_STORAGE, base64Url(privateKey), {
            keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        })
    }

    const point = p256.getPublicKey(privateKey, false)
    const publicJwk: DevicePublicJwk = {
        kty: 'EC',
        crv: 'P-256',
        x: base64Url(point.slice(1, 33)),
        y: base64Url(point.slice(33, 65)),
    }
    cachedKey = { privateKey, publicJwk }
    return cachedKey
}

export async function getDevicePublicJwk() {
    return (await loadOrCreateDeviceKey()).publicJwk
}

export async function createDeviceProof(token: string, method: string, requestUrl: string) {
    const device = await loadOrCreateDeviceKey()
    const url = new URL(requestUrl)
    url.search = ''
    url.hash = ''
    const htu = url.toString().replace(/\/$/, '')
    const tokenHash = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, encoder.encode(token))
    const header = { typ: 'dpop+jwt', alg: 'ES256', jwk: device.publicJwk }
    const claims = {
        htm: method.toUpperCase(),
        htu,
        iat: Math.floor(Date.now() / 1000),
        jti: Crypto.randomUUID(),
        ath: base64Url(new Uint8Array(tokenHash)),
    }
    const signingInput = `${base64Url(encoder.encode(JSON.stringify(header)))}.${base64Url(encoder.encode(JSON.stringify(claims)))}`
    const signature = p256.sign(encoder.encode(signingInput), device.privateKey, { lowS: true })
    return { proof: `${signingInput}.${base64Url(signature)}`, publicJwk: device.publicJwk, url: htu }
}
