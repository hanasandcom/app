import * as Crypto from 'expo-crypto'
import type { AgentAutomation, AgentAutomationPayload, AgentAutomationRun, AiFileSummary, AiRunDetails, AiToolUseSummary, AppSettings, DashboardRole, DashboardUser, DashboardUserRoleAssignment, DesktopAgentPresence, DesktopAgentStatus, GptClient, HanasandAuthSession, MailAddress, MailboxItem, MailMessage, MailMessageSummary, MailOverview, MailSendResult, ManagedCronJob, Note, ShareSummary, ShareTreeItem } from '../types'
import { AuthenticationError, PendingDeletionError } from './api-errors'
import { trustedDesktopAgentEndpoints } from './desktop-agent-endpoints'
import { requestPinnedDesktopAgent } from './pinned-desktop-transport'
export { AuthenticationError, PendingDeletionError } from './api-errors'

const desktopAgentRequestBodyBytes = 64 * 1024
const defaultMailApiBaseUrl = process.env.EXPO_PUBLIC_MAIL_API_BASE_URL || 'https://mail.hanasand.com/api'
const desktopAgentCoverTrafficIntervalMs = 1_000
const desktopAgentPresenceCacheMs = 15_000
const desktopAgentMaximumQueuedRequests = 32
const desktopAgentMaximumInFlightRequests = 4

type DesktopAgentQueueEntry = {
    settings: AppSettings
    path: string
    init?: RequestInit
    resolve: (response: Response) => void
    reject: (error: unknown) => void
}

let desktopAgentTrafficSettings: AppSettings | null = null
let desktopAgentTrafficTimer: ReturnType<typeof setTimeout> | null = null
let desktopAgentTrafficInFlight = 0
let desktopAgentRealRequestInFlight = false
const desktopAgentTrafficQueue: DesktopAgentQueueEntry[] = []
let cachedDesktopAgentPresence: {
    key: string
    expiresAt: number
    agents: DesktopAgentPresence[]
    pending?: Promise<DesktopAgentPresence[]>
} | null = null

function headers(settings: AppSettings) {
    const next: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: settings.authToken ? `Bearer ${settings.authToken}` : '',
        id: settings.userId || '',
    }
    if (settings.impersonationToken) {
        next['x-impersonation-token'] = settings.impersonationToken
    }
    return next
}

async function apiFetch(settings: AppSettings | undefined, input: RequestInfo | URL, init: RequestInit = {}) {
    const requestUrl = String(input)
    const url = new URL(requestUrl)
    const managed = url.protocol === 'https:' && (url.hostname === 'hanasand.com' || url.hostname.endsWith('.hanasand.com'))
    if (!managed) return fetch(input, init)

    const requestHeaders = new Headers(init.headers)
    if (settings) {
        for (const [name, value] of Object.entries(headers(settings))) {
            if (value) requestHeaders.set(name, value)
        }
    }
    const { createDeviceProof, getDevicePublicJwk } = await import('./device-proof')
    const devicePublicJwk = await getDevicePublicJwk()
    requestHeaders.set('x-device-public-jwk', JSON.stringify(devicePublicJwk))
    if (settings?.authToken) {
        const signed = await createDeviceProof(settings.authToken, init.method || 'GET', requestUrl)
        requestHeaders.set('dpop', signed.proof)
        requestHeaders.set('x-device-proof-url', signed.url)
        requestHeaders.set('x-device-proof-method', (init.method || 'GET').toUpperCase())
    }
    return fetch(input, { ...init, headers: requestHeaders })
}

function requireAppAuth(settings: AppSettings, purpose: string) {
    if (!settings.apiBaseUrl || !settings.authToken || !settings.userId) {
        throw new Error(`Log in again to ${purpose}.`)
    }
}

function requireCdnAuth(settings: AppSettings, purpose: string) {
    if (!settings.cdnBaseUrl || !settings.authToken || !settings.userId) {
        throw new Error(`Log in again to ${purpose}.`)
    }
}

function baseUrl(value: string) {
    return value.trim().replace(/\/+$/, '')
}

function pathPart(value: string) {
    return value.trim().replace(/^\/+/, '')
}

function assertSecureTransport(url: string) {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:') return
    throw new Error(`Blocked insecure plaintext endpoint: ${parsed.origin}. Use HTTPS for Hanasand services.`)
}

function joinUrl(base: string, path: string) {
    const cleanBase = baseUrl(base)
    const cleanPath = pathPart(path)
    const next = cleanPath ? `${cleanBase}/${cleanPath}` : cleanBase
    assertSecureTransport(next)
    return next
}

function identityUrl(settings: AppSettings, path: string) {
    const defaultApiBase = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.hanasand.com/api'
    const defaultSiteBase = 'https://hanasand.com'
    return baseUrl(settings.apiBaseUrl) === baseUrl(defaultApiBase) && baseUrl(settings.siteBaseUrl) === defaultSiteBase
        ? joinUrl(settings.siteBaseUrl, `api/${pathPart(path)}`)
        : joinUrl(settings.apiBaseUrl, path)
}

function mailUrl(path: string) {
    return joinUrl(defaultMailApiBaseUrl, path)
}

async function fetchDesktopAgentPresence(settings: AppSettings) {
    requireAppAuth(settings, 'discover the desktop agent')
    const key = `${settings.apiBaseUrl}\n${settings.userId}\n${settings.authToken}`
    if (cachedDesktopAgentPresence?.key === key
        && (cachedDesktopAgentPresence.pending || cachedDesktopAgentPresence.expiresAt > Date.now())) {
        return cachedDesktopAgentPresence.pending ?? cachedDesktopAgentPresence.agents
    }
    const cache: NonNullable<typeof cachedDesktopAgentPresence> = {
        key,
        expiresAt: Date.now() + desktopAgentPresenceCacheMs,
        agents: [],
    }
    cachedDesktopAgentPresence = cache
    cache.pending = (async () => {
        const response = await apiFetch(settings, joinUrl(settings.apiBaseUrl, 'desktop-agent/presence'), {
            headers: headers(settings),
        })
        if (!response.ok) {
            throw new Error(`Desktop agent discovery failed with HTTP ${response.status}.`)
        }
        const payload = await response.json().catch(() => null) as { agents?: DesktopAgentPresence[] } | null
        cache.agents = Array.isArray(payload?.agents) ? payload.agents : []
        return cache.agents
    })()
    try {
        return await cache.pending
    } finally {
        cache.pending = undefined
    }
}

function rightRotate(value: number, amount: number) {
    return (value >>> amount) | (value << (32 - amount))
}

function utf8Bytes(input: string) {
    const bytes: number[] = []
    for (let i = 0; i < input.length; i += 1) {
        const code = input.charCodeAt(i)
        if (code < 0x80) {
            bytes.push(code)
        } else if (code < 0x800) {
            bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
        } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
            const next = input.charCodeAt(i + 1)
            if (next >= 0xdc00 && next <= 0xdfff) {
                const point = 0x10000 + (((code & 0x3ff) << 10) | (next & 0x3ff))
                bytes.push(0xf0 | (point >> 18), 0x80 | ((point >> 12) & 0x3f), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f))
                i += 1
            }
        } else {
            bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
        }
    }

    return bytes
}

function sha256Hex(input: string) {
    return sha256Bytes(utf8Bytes(input))
}

function sha256Bytes(input: number[]) {
    const bytes = [...input]
    const bitLength = bytes.length * 8
    bytes.push(0x80)
    while ((bytes.length % 64) !== 56) bytes.push(0)
    const high = Math.floor(bitLength / 0x100000000)
    const low = bitLength >>> 0
    for (let shift = 24; shift >= 0; shift -= 8) bytes.push((high >>> shift) & 0xff)
    for (let shift = 24; shift >= 0; shift -= 8) bytes.push((low >>> shift) & 0xff)

    const constants = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ]
    const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
    const words = new Array<number>(64)

    for (let chunk = 0; chunk < bytes.length; chunk += 64) {
        for (let i = 0; i < 16; i += 1) {
            const offset = chunk + i * 4
            words[i] = ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
        }
        for (let i = 16; i < 64; i += 1) {
            const s0 = rightRotate(words[i - 15], 7) ^ rightRotate(words[i - 15], 18) ^ (words[i - 15] >>> 3)
            const s1 = rightRotate(words[i - 2], 17) ^ rightRotate(words[i - 2], 19) ^ (words[i - 2] >>> 10)
            words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0
        }

        let [a, b, c, d, e, f, g, h] = hash
        for (let i = 0; i < 64; i += 1) {
            const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)
            const ch = (e & f) ^ (~e & g)
            const temp1 = (h + s1 + ch + constants[i] + words[i]) >>> 0
            const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)
            const maj = (a & b) ^ (a & c) ^ (b & c)
            const temp2 = (s0 + maj) >>> 0
            h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0
        }

        hash[0] = (hash[0] + a) >>> 0
        hash[1] = (hash[1] + b) >>> 0
        hash[2] = (hash[2] + c) >>> 0
        hash[3] = (hash[3] + d) >>> 0
        hash[4] = (hash[4] + e) >>> 0
        hash[5] = (hash[5] + f) >>> 0
        hash[6] = (hash[6] + g) >>> 0
        hash[7] = (hash[7] + h) >>> 0
    }

    return hash.map(value => value.toString(16).padStart(8, '0')).join('')
}

function hmacSha256Hex(key: string, message: string) {
    const blockSize = 64
    const keyBytes = utf8Bytes(key)
    const normalizedKey = keyBytes.length > blockSize
        ? (sha256Hex(key).match(/../g) || []).map(byte => Number.parseInt(byte, 16))
        : keyBytes
    const paddedKey = [...normalizedKey, ...new Array(Math.max(0, blockSize - normalizedKey.length)).fill(0)]
    const innerBytes = [...paddedKey.map(byte => byte ^ 0x36), ...utf8Bytes(message)]
    const outerBytes = [...paddedKey.map(byte => byte ^ 0x5c)]
    const innerHashBytes = (sha256Bytes(innerBytes).match(/../g) || []).map(byte => Number.parseInt(byte, 16))
    return sha256Bytes([...outerBytes, ...innerHashBytes])
}

function desktopAgentSessionCertificate(settings: AppSettings) {
    const userId = settings.userId.trim()
    const authToken = settings.authToken.trim()
    if (!userId || !authToken) return ''
    return sha256Hex(`hanasand-desktop-agent-session-v1\n${userId}\n${authToken}`)
}

function utf8String(bytes: Uint8Array) {
    let value = ''
    for (let i = 0; i < bytes.length;) {
        const first = bytes[i]
        if (first < 0x80) {
            value += String.fromCharCode(first)
            i += 1
        } else if (first < 0xe0 && i + 1 < bytes.length) {
            value += String.fromCharCode(((first & 0x1f) << 6) | (bytes[i + 1] & 0x3f))
            i += 2
        } else if (first < 0xf0 && i + 2 < bytes.length) {
            value += String.fromCharCode(((first & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f))
            i += 3
        } else if (i + 3 < bytes.length) {
            const point = ((first & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f)
            value += String.fromCodePoint(point)
            i += 4
        } else {
            throw new Error('Desktop agent returned invalid UTF-8 data.')
        }
    }
    return value
}

async function desktopAgentEncryptionKey(certificate: string) {
    const keyHex = sha256Hex(`hanasand-desktop-agent-transport-v1\n${certificate}`)
    return Crypto.AESEncryptionKey.import(keyHex, 'hex')
}

async function sealDesktopAgentBody(plaintext: string, certificate: string) {
    const key = await desktopAgentEncryptionKey(certificate)
    const sealed = await Crypto.aesEncryptAsync(new Uint8Array(utf8Bytes(plaintext)), key)
    return JSON.stringify({ encrypted: true, payload: await sealed.combined('base64') })
}

async function openDesktopAgentResponse(response: Response, certificate: string) {
    if (response.status === 401) return response

    const payload = asRecord(await response.clone().json().catch(() => null))
    if (payload.encrypted !== true || typeof payload.payload !== 'string') {
        throw new Error('Desktop agent returned a response without the required encryption envelope.')
    }

    const key = await desktopAgentEncryptionKey(certificate)
    const sealed = Crypto.AESSealedData.fromCombined(payload.payload, { ivLength: 12, tagLength: 16 })
    const plaintext = await Crypto.aesDecryptAsync(sealed, key)
    if (!(plaintext instanceof Uint8Array)) {
        throw new Error('Desktop agent response could not be decrypted.')
    }

    const responseHeaders = new Headers(response.headers)
    responseHeaders.delete('Content-Length')
    return new Response(utf8String(plaintext), {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
    })
}

async function desktopAgentProofRequest(path: string, init: RequestInit | undefined, certificate: string) {
    if (!certificate) return init
    // A uniform POST frame works consistently across URLSession and Android's
    // HttpsURLConnection, which do not support request bodies on GET.
    const method = 'POST'
    const target = `/${pathPart(path)}`
    const timestamp = String(Math.floor(Date.now() / 1000))
    const nonce = Array.from(await Crypto.getRandomBytesAsync(16), byte => byte.toString(16).padStart(2, '0')).join('')
    const plaintext = typeof init?.body === 'string' ? init.body : '{}'
    const envelope = await sealDesktopAgentBody(plaintext, certificate)
    const envelopeBytes = utf8Bytes(envelope).length
    if (envelopeBytes > desktopAgentRequestBodyBytes) {
        throw new Error('Desktop command exceeds the fixed-size privacy frame.')
    }
    const body = envelope + ' '.repeat(desktopAgentRequestBodyBytes - envelopeBytes)
    const bodyHash = sha256Hex(body)
    const material = `${method}\n${target}\n${timestamp}\n${nonce}\n${bodyHash}`
    const proof = hmacSha256Hex(certificate, material)
    return {
        ...init,
        method,
        headers: {
            ...(init?.headers || {}),
            'Content-Type': 'application/json',
            'X-Hanasand-Session-Timestamp': timestamp,
            'X-Hanasand-Session-Nonce': nonce,
            'X-Hanasand-Session-Proof': proof,
        },
        body,
    }
}

async function performDesktopAgentPath(settings: AppSettings, path: string, init?: RequestInit) {
    const agents = await fetchDesktopAgentPresence(settings)
    const endpoints = trustedDesktopAgentEndpoints(agents, settings.desktopAgentBaseUrl)
    if (endpoints.length === 0) {
        throw new Error('No HTTPS desktop agent with a valid certificate pin is available. Update the Hanasand desktop app and check that it is online.')
    }
    const certificate = desktopAgentSessionCertificate(settings)

    let lastError: unknown
    for (const endpoint of endpoints) {
        let response: Response
        try {
            const signedInit = await desktopAgentProofRequest(path, init, certificate)
            response = await requestPinnedDesktopAgent(endpoint, path, signedInit)
        } catch (error) {
            lastError = error
            continue
        }
        if (response.status !== 401) return openDesktopAgentResponse(response, certificate)
        lastError = new Error('Desktop agent rejected this login session.')
    }

    throw lastError instanceof Error ? lastError : new Error('Desktop agent is unreachable.')
}

function stopDesktopAgentTrafficTimer() {
    if (desktopAgentTrafficTimer) clearTimeout(desktopAgentTrafficTimer)
    desktopAgentTrafficTimer = null
}

function scheduleDesktopAgentTrafficSlot() {
    if (desktopAgentTrafficTimer) return
    stopDesktopAgentTrafficTimer()
    if (!desktopAgentTrafficSettings) return
    const remainder = Date.now() % desktopAgentCoverTrafficIntervalMs
    const delay = remainder === 0 ? desktopAgentCoverTrafficIntervalMs : desktopAgentCoverTrafficIntervalMs - remainder
    desktopAgentTrafficTimer = setTimeout(() => { void runDesktopAgentTrafficSlot() }, delay)
}

function runDesktopAgentTrafficSlot() {
    desktopAgentTrafficTimer = null
    const settings = desktopAgentTrafficSettings
    if (!settings) return
    if (desktopAgentTrafficInFlight >= desktopAgentMaximumInFlightRequests) {
        scheduleDesktopAgentTrafficSlot()
        return
    }

    const queued = desktopAgentRealRequestInFlight ? undefined : desktopAgentTrafficQueue.shift()
    desktopAgentTrafficInFlight += 1
    if (queued) desktopAgentRealRequestInFlight = true
    scheduleDesktopAgentTrafficSlot()
    void performDesktopAgentPath(
        queued?.settings ?? settings,
        queued?.path ?? 'status',
        queued?.init ?? { method: 'POST', body: '{}' },
    ).then(async response => {
        if (queued) queued.resolve(response)
        else await response.body?.cancel()
    }).catch(error => {
        if (queued) queued.reject(error)
    }).finally(() => {
        desktopAgentTrafficInFlight -= 1
        if (queued) desktopAgentRealRequestInFlight = false
    })
}

export function startDesktopAgentCoverTraffic(settings: AppSettings) {
    desktopAgentTrafficSettings = settings
    scheduleDesktopAgentTrafficSlot()
}

export function stopDesktopAgentCoverTraffic() {
    desktopAgentTrafficSettings = null
    stopDesktopAgentTrafficTimer()
    const error = new Error('Desktop agent request was canceled because the app left the foreground.')
    while (desktopAgentTrafficQueue.length) desktopAgentTrafficQueue.shift()?.reject(error)
}

async function fetchDesktopAgentPath(settings: AppSettings, path: string, init?: RequestInit) {
    if (!desktopAgentTrafficSettings) return performDesktopAgentPath(settings, path, init)
    if (desktopAgentTrafficQueue.length >= desktopAgentMaximumQueuedRequests) {
        throw new Error('The desktop agent request queue is full. Wait for the current actions to finish.')
    }
    return new Promise<Response>((resolve, reject) => {
        desktopAgentTrafficQueue.push({ settings, path, init, resolve, reject })
        scheduleDesktopAgentTrafficSlot()
    })
}

function segment(value: string) {
    return encodeURIComponent(value)
}

function stringValue(value: unknown) {
    return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function booleanValue(value: unknown) {
    return typeof value === 'boolean' ? value : undefined
}

function asRecord(value: unknown) {
    return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function normalizeAuthSession(value: unknown): HanasandAuthSession {
    const entry = asRecord(value)
    const id = stringValue(entry.id)
    const token = stringValue(entry.token)
    if (!id || !token) {
        throw new Error(stringValue(entry.error) || 'Unable to sign in.')
    }
    const roles = Array.isArray(entry.roles)
        ? entry.roles.map(role => typeof role === 'string' ? role : stringValue(asRecord(role).id) || stringValue(asRecord(role).name)).filter(Boolean)
        : undefined
    return {
        id,
        name: stringValue(entry.name) || undefined,
        avatar: stringValue(entry.avatar) || null,
        roles: roles?.length ? roles : undefined,
        token,
        expiresAt: stringValue(entry.expires_at) || stringValue(entry.expiresAt) || undefined,
    }
}

async function readJsonResponse(response: Response) {
    const payload = await response.json().catch(() => null)
    const entry = asRecord(payload)
    if (response.status === 423 && entry.pending_deletion === true) {
        throw new PendingDeletionError(entry)
    }
    if (response.ok) return payload
    const message = stringValue(entry.error) || `Request failed with HTTP ${response.status}.`
    if (response.status === 401 || response.status === 403) {
        throw new AuthenticationError(message)
    }
    throw new Error(message)
}

export async function loginToHanasand(settings: AppSettings, username: string, password: string) {
    const id = username.trim()
    if (!id || !password) {
        throw new Error('Enter username and password.')
    }
    const response = await apiFetch(settings, identityUrl(settings, 'auth/mobile/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id, password }),
    })
    return normalizeAuthSession(await readJsonResponse(response))
}

export async function loginWithHanasandPasskey(settings: AppSettings, username: string) {
    const { get } = await import('react-native-passkeys')
    const optionsUrl = new URL(identityUrl(settings, 'auth/passkeys/authenticate/options'))
    if (username.trim()) optionsUrl.searchParams.set('username', username.trim())
    const optionsResponse = await apiFetch(undefined, optionsUrl, { headers: { Accept: 'application/json' } })
    const optionsPayload = asRecord(await readJsonResponse(optionsResponse))
    const request = asRecord(optionsPayload.publicKey)
    if (typeof optionsPayload.challengeId !== 'string' || typeof request.challenge !== 'string' || typeof request.rpId !== 'string') {
        throw new Error('Passkey sign-in is unavailable. Try again or use your password.')
    }

    const credential = await get(request as Parameters<typeof get>[0])
    if (!credential) throw new Error('Passkey sign-in was canceled.')
    const response = await apiFetch(undefined, identityUrl(settings, 'auth/mobile/passkeys/authenticate/verify'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ challengeId: optionsPayload.challengeId, credential }),
    })
    return normalizeAuthSession(await readJsonResponse(response))
}

export async function exchangeHanasandMobileSsoCode(settings: AppSettings, code: string, verifier: string) {
    const response = await apiFetch(undefined, identityUrl(settings, 'auth/mobile/sso/exchange'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ code, verifier }),
    })
    return normalizeAuthSession(await readJsonResponse(response))
}

export async function isHanasandGoogleSignInConfigured(settings: AppSettings) {
    const response = await apiFetch(undefined, identityUrl(settings, 'auth/social/providers'), {
        headers: { Accept: 'application/json' },
    })
    const payload = asRecord(await readJsonResponse(response))
    const providers = Array.isArray(payload.providers) ? payload.providers : []
    return providers.some(provider => {
        const record = asRecord(provider)
        return record.provider === 'google' && record.configured === true
    })
}

export async function createHanasandAccount(settings: AppSettings, username: string, name: string, password: string) {
    const id = username.trim()
    const displayName = name.trim()
    if (!id || !displayName || !password) {
        throw new Error('Enter username, name, and password.')
    }
    const response = await apiFetch(settings, joinUrl(settings.apiBaseUrl, 'user'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id, name: displayName, password }),
    })
    return normalizeAuthSession(await readJsonResponse(response))
}

export async function refreshHanasandSession(settings: AppSettings) {
    requireAppAuth(settings, 'refresh your login session')
    const response = await apiFetch(settings, joinUrl(settings.apiBaseUrl, `auth/token/${segment(settings.userId)}`), {
        headers: headers(settings),
    })
    return normalizeAuthSession(await readJsonResponse(response))
}

export async function requestPasswordResetCode(settings: AppSettings, username: string) {
    const id = username.trim()
    if (!id) throw new Error('Type your username first.')
    const response = await apiFetch(settings, joinUrl(settings.apiBaseUrl, 'auth/password-reset/request'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id }),
    })
    await readJsonResponse(response)
}

export async function verifyPasswordResetCode(settings: AppSettings, username: string, code: string) {
    const id = username.trim()
    const resetCode = code.trim()
    if (!id || !/^\d{6}$/.test(resetCode)) throw new Error('Enter the 6 digit code.')
    const response = await apiFetch(settings, joinUrl(settings.apiBaseUrl, 'auth/password-reset/verify'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id, code: resetCode }),
    })
    const payload = asRecord(await readJsonResponse(response))
    const resetToken = stringValue(payload.resetToken)
    if (!resetToken) throw new Error('The reset code could not be verified.')
    return resetToken
}

export async function completePasswordReset(settings: AppSettings, username: string, resetToken: string, password: string) {
    const id = username.trim()
    if (!id || !resetToken || !password) throw new Error('Reset session expired. Send a new code.')
    const response = await apiFetch(settings, joinUrl(settings.apiBaseUrl, 'auth/password-reset/complete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id, resetToken, password }),
    })
    await readJsonResponse(response)
}

export async function deleteHanasandAccount(settings: AppSettings) {
    requireAppAuth(settings, 'delete your account')
    const response = await apiFetch(settings, joinUrl(settings.apiBaseUrl, 'user/self'), {
        method: 'DELETE',
        headers: headers(settings),
    })
    await readJsonResponse(response)
}

export async function restoreHanasandAccount(settings: AppSettings, id: string, restoreToken: string) {
    const response = await apiFetch(settings, joinUrl(settings.apiBaseUrl, 'user/restore'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id, restoreToken }),
    })
    return normalizeAuthSession(await readJsonResponse(response))
}

function normalizeToolUses(value: unknown): AiToolUseSummary[] | undefined {
    if (!Array.isArray(value)) return undefined
    const tools = value.map(item => {
        const entry = asRecord(item)
        const name = stringValue(entry.name) || stringValue(entry.tool) || stringValue(entry.type)
        if (!name) return null
        return {
            name,
            summary: stringValue(entry.summary) || stringValue(entry.result) || stringValue(entry.input) || undefined,
            durationMs: numberValue(entry.durationMs) ?? numberValue(entry.duration_ms),
        }
    }).filter(Boolean) as AiToolUseSummary[]
    return tools.length ? tools : undefined
}

function normalizeFileSummaries(value: unknown): AiFileSummary[] | undefined {
    if (!Array.isArray(value)) return undefined
    const files = value.map(item => {
        const entry = asRecord(item)
        const path = stringValue(entry.path) || stringValue(entry.file) || stringValue(entry.name)
        if (!path) return null
        return {
            path,
            summary: stringValue(entry.summary) || stringValue(entry.description) || undefined,
            additions: numberValue(entry.additions),
            deletions: numberValue(entry.deletions),
        }
    }).filter(Boolean) as AiFileSummary[]
    return files.length ? files : undefined
}

function normalizeShare(value: unknown): ShareSummary | null {
    const entry = asRecord(value)
    const id = stringValue(entry.id)
    if (!id) return null
    return {
        id,
        alias: stringValue(entry.alias) || null,
        path: stringValue(entry.path) || null,
        name: stringValue(entry.name) || null,
        timestamp: stringValue(entry.timestamp) || undefined,
        content: stringValue(entry.content) || undefined,
        locked: typeof entry.locked === 'boolean' ? entry.locked : undefined,
        parent: stringValue(entry.parent) || null,
        type: stringValue(entry.type) || null,
    }
}

function normalizeShareTree(value: unknown): ShareTreeItem[] {
    if (!Array.isArray(value)) return []
    return value.map(item => {
        const entry = asRecord(item)
        const id = stringValue(entry.id)
        const name = stringValue(entry.name) || stringValue(entry.path) || id
        const rawType = stringValue(entry.type)
        if (!id || !name) return null
        return {
            id,
            name,
            alias: stringValue(entry.alias) || null,
            parent: stringValue(entry.parent) || null,
            type: rawType === 'folder' ? 'folder' : 'file',
            children: normalizeShareTree(entry.children),
        }
    }).filter(Boolean) as ShareTreeItem[]
}

function normalizeMailAddresses(value: unknown): MailAddress[] {
    if (!Array.isArray(value)) return []
    return value.map(item => {
        const entry = asRecord(item)
        const email = stringValue(entry.email)
        if (!email) return null
        return { email, name: stringValue(entry.name) || undefined }
    }).filter(Boolean) as MailAddress[]
}

function normalizeMailbox(value: unknown): MailboxItem | null {
    const entry = asRecord(value)
    const id = stringValue(entry.id)
    const name = stringValue(entry.name)
    if (!id || !name) return null
    return {
        id,
        name,
        role: stringValue(entry.role) || undefined,
        unreadEmails: numberValue(entry.unreadEmails) ?? numberValue(entry.unread_emails),
    }
}

function normalizeMailSummary(value: unknown): MailMessageSummary | null {
    const entry = asRecord(value)
    const id = stringValue(entry.id)
    if (!id) return null
    return {
        id,
        subject: stringValue(entry.subject) || '(no subject)',
        preview: stringValue(entry.preview),
        receivedAt: stringValue(entry.receivedAt) || stringValue(entry.received_at),
        from: normalizeMailAddresses(entry.from),
        to: normalizeMailAddresses(entry.to),
        hasAttachment: booleanValue(entry.hasAttachment) ?? booleanValue(entry.has_attachment) ?? false,
        isRead: booleanValue(entry.isRead) ?? booleanValue(entry.is_read) ?? false,
        isFlagged: booleanValue(entry.isFlagged) ?? booleanValue(entry.is_flagged) ?? false,
    }
}

function normalizeMailMessage(value: unknown): MailMessage | null {
    const summary = normalizeMailSummary(value)
    if (!summary) return null
    const entry = asRecord(value)
    return {
        ...summary,
        textBody: stringValue(entry.textBody) || stringValue(entry.text_body) || summary.preview,
        htmlBody: stringValue(entry.htmlBody) || stringValue(entry.html_body),
    }
}

function normalizeMailOverview(value: unknown): MailOverview {
    const entry = asRecord(value)
    const messages = Array.isArray(entry.messages)
        ? entry.messages.map(normalizeMailSummary).filter(Boolean) as MailMessageSummary[]
        : []
    return {
        mailboxUser: stringValue(entry.mailboxUser) || stringValue(entry.mailbox_user),
        mailboxAddress: stringValue(entry.mailboxAddress) || stringValue(entry.mailbox_address) || 'Not connected',
        accessibleAccounts: Array.isArray(entry.accessibleAccounts)
            ? entry.accessibleAccounts.map(item => {
                const account = asRecord(item)
                const id = stringValue(account.id)
                if (!id) return null
                return {
                    id,
                    name: stringValue(account.name) || id,
                    address: stringValue(account.address),
                }
            }).filter(Boolean) as Array<{ id: string; name: string; address: string }>
            : [],
        mailboxes: Array.isArray(entry.mailboxes) ? entry.mailboxes.map(normalizeMailbox).filter(Boolean) as MailboxItem[] : [],
        selectedMailboxId: stringValue(entry.selectedMailboxId) || stringValue(entry.selected_mailbox_id) || null,
        messages,
        selectedMessage: normalizeMailMessage(entry.selectedMessage || entry.selected_message),
    }
}

function normalizeMailSendResult(value: unknown): MailSendResult | null {
    const entry = asRecord(value)
    if (!Object.keys(entry).length) return null
    return {
        ok: booleanValue(entry.ok) ?? false,
        mailboxUser: stringValue(entry.mailboxUser) || stringValue(entry.mailbox_user),
        sentMailboxId: stringValue(entry.sentMailboxId) || stringValue(entry.sent_mailbox_id) || null,
        sentMessageId: stringValue(entry.sentMessageId) || stringValue(entry.sent_message_id) || null,
    }
}

function normalizeGptClient(value: unknown): GptClient | null {
    const entry = asRecord(value)
    const name = stringValue(entry.name)
    if (!name) return null
    const model = asRecord(entry.model)
    return {
        name,
        model: {
            tps: numberValue(model.tps),
            status: stringValue(model.status) || undefined,
        },
    }
}

function normalizeTrafficDomain(value: unknown): { name: string; tps?: number } | null {
    const entry = asRecord(value)
    const name = stringValue(entry.name) || stringValue(entry.domain)
    if (!name) return null
    return { name, tps: numberValue(entry.tps) }
}

function normalizeDesktopStatus(value: unknown): DesktopAgentStatus {
    const entry = asRecord(value)
    return {
        ok: booleanValue(entry.ok) ?? false,
        agent: stringValue(entry.agent) || undefined,
        hostname: stringValue(entry.hostname) || undefined,
        platform: stringValue(entry.platform) || undefined,
        user: stringValue(entry.user) || undefined,
        cwd: stringValue(entry.cwd) || undefined,
        uptimeSeconds: numberValue(entry.uptimeSeconds) ?? numberValue(entry.uptime_seconds),
        timestamp: stringValue(entry.timestamp) || undefined,
        message: stringValue(entry.message) || undefined,
        screenCaptureAllowed: booleanValue(entry.screenCaptureAllowed) ?? booleanValue(entry.screen_capture_allowed),
        accessibilityAllowed: booleanValue(entry.accessibilityAllowed) ?? booleanValue(entry.accessibility_allowed),
    }
}

function normalizeNote(value: unknown): Note | null {
    const entry = asRecord(value)
    const id = stringValue(entry.id)
    if (!id) return null
    return {
        id,
        title: stringValue(entry.title),
        content: stringValue(entry.content),
        source: stringValue(entry.source) || 'app',
        owner_id: stringValue(entry.owner_id) || stringValue(entry.ownerId),
        created_at: stringValue(entry.created_at) || stringValue(entry.createdAt),
        updated_at: stringValue(entry.updated_at) || stringValue(entry.updatedAt),
    }
}

function normalizeRole(value: unknown): DashboardRole | null {
    const entry = asRecord(value)
    const id = stringValue(entry.id) || stringValue(entry.role_id) || stringValue(entry.name)
    if (!id) return null
    return {
        id,
        name: stringValue(entry.name) || id,
        description: stringValue(entry.description) || undefined,
        priority: numberValue(entry.priority),
    }
}

function normalizeUserRoleAssignment(value: unknown): DashboardUserRoleAssignment | null {
    const entry = asRecord(value)
    const roleId = stringValue(entry.role_id) || stringValue(entry.roleId) || stringValue(entry.id) || stringValue(entry.name)
    if (!roleId) return null
    return {
        id: stringValue(entry.id) || roleId,
        roleId,
        name: stringValue(entry.name) || roleId,
        priority: numberValue(entry.priority),
    }
}

function normalizeDashboardUser(value: unknown): DashboardUser | null {
    const entry = asRecord(value)
    const id = stringValue(entry.id)
    if (!id) return null
    const roles = Array.isArray(entry.roles) ? entry.roles.map(normalizeRole).filter(Boolean) as DashboardRole[] : undefined
    return {
        id,
        name: stringValue(entry.name) || stringValue(entry.displayName) || stringValue(entry.display_name) || id,
        active: booleanValue(entry.active),
        role: stringValue(entry.role) || stringValue(entry.role_id) || roles?.[0]?.name,
        roles,
        highestRolePriority: numberValue(entry.highestRolePriority) ?? numberValue(entry.highest_role_priority),
    }
}

async function readJsonObject(response: Response, fallback: unknown) {
    return response.json().catch(() => fallback)
}

export async function fetchMailOverview(settings: AppSettings, mailboxId?: string | null, messageId?: string | null, mailboxUser?: string | null) {
    requireAppAuth(settings, 'load mail')

    const search = new URLSearchParams()
    if (mailboxUser) search.set('mailboxUser', mailboxUser)
    if (mailboxId) search.set('mailboxId', mailboxId)
    if (messageId) search.set('messageId', messageId)

    const response = await apiFetch(settings, `${mailUrl('mail/overview')}?${search.toString()}`, {
        headers: headers(settings),
    })

    if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || 'Unable to load mail overview.')
    }

    const body = await response.json().catch(() => null)
    if (!body || typeof body !== 'object') {
        throw new Error('Mail overview returned an unexpected response.')
    }

    return normalizeMailOverview(body)
}

export async function postMailAction(settings: AppSettings, messageId: string, action: string, targetMailboxId?: string, mailboxUser?: string) {
    requireAppAuth(settings, 'update mail')

    const response = await apiFetch(settings, mailUrl(`mail/message/${segment(messageId)}/action`), {
        method: 'POST',
        headers: headers(settings),
        body: JSON.stringify({ action, targetMailboxId, mailboxUser }),
    })

    if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || 'Unable to update message.')
    }
}

export async function createMailbox(settings: AppSettings, name: string, mailboxUser?: string) {
    requireAppAuth(settings, 'create mailbox folders')

    const response = await apiFetch(settings, mailUrl('mail/mailboxes'), {
        method: 'POST',
        headers: headers(settings),
        body: JSON.stringify({ name, mailboxUser }),
    })

    if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || 'Unable to create mailbox.')
    }
}

export async function sendMailMessage(settings: AppSettings, body: {
    mailboxUser?: string
    to: string
    cc?: string
    bcc?: string
    subject: string
    textBody: string
}) {
    requireAppAuth(settings, 'send mail')

    const response = await apiFetch(settings, mailUrl('mail/send'), {
        method: 'POST',
        headers: headers(settings),
        body: JSON.stringify(body),
    })

    const responseBody = await response.json().catch(() => null)
    if (!response.ok) {
        throw new Error(String((responseBody as { error?: string } | null)?.error || 'Unable to send mail.'))
    }

    return normalizeMailSendResult(responseBody)
}

export async function triggerServerAction(url: string, settings?: AppSettings) {
    assertSecureTransport(url)
    const response = await apiFetch(settings, url, {
        method: 'POST',
        headers: settings ? headers(settings) : undefined,
    })

    if (!response.ok) {
        throw new Error(`Action failed with status ${response.status}`)
    }

    return response.text().catch(() => 'Done')
}

export async function fetchServerText(url: string, settings?: AppSettings) {
    assertSecureTransport(url)
    const response = await apiFetch(settings, url, {
        headers: settings ? headers(settings) : undefined,
    })

    if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`)
    }

    return response.text().catch(() => '')
}

export async function askCodex(settings: AppSettings, prompt: string, context?: string): Promise<AiRunDetails> {
    requireAppAuth(settings, 'use Codex in-app')

    const response = await apiFetch(settings, joinUrl(settings.apiBaseUrl, settings.codexApiPath), {
        method: 'POST',
        headers: headers(settings),
        body: JSON.stringify({ prompt, context }),
    })

    const body = await response.json().catch(() => ({} as Record<string, unknown>))
    if (!response.ok) {
        throw new Error(String(body.error || 'Unable to reach the Codex tool endpoint.'))
    }

    return {
        message: String(body.message || body.suggestion || body.error || 'No response.'),
        durationMs: numberValue(body.durationMs) ?? numberValue(body.duration_ms) ?? numberValue(body.elapsedMs),
        thoughtSummary: stringValue(body.thoughtSummary) || stringValue(body.summary) || stringValue(body.thoughts) || undefined,
        toolUses: normalizeToolUses(body.toolUses || body.tools || body.tool_calls),
        fileSummaries: normalizeFileSummaries(body.fileSummaries || body.files || body.changedFiles),
    }
}

export async function isHanasandOrganizationMember(settings: AppSettings) {
    requireAppAuth(settings, 'check organization access')
    const response = await apiFetch(settings, joinUrl(settings.apiBaseUrl, 'organizations'), { headers: headers(settings) })
    if (!response.ok) return false
    const payload = asRecord(await response.json().catch(() => ({})))
    const organizations = Array.isArray(payload.organizations) ? payload.organizations : []
    return organizations.some(value => {
        const organization = asRecord(value)
        const active = stringValue(organization.lifecycleStatus || organization.lifecycle_status).toLowerCase()
        return stringValue(organization.slug).toLowerCase() === 'hanasand' && (!active || active === 'active')
    })
}

export async function askChatGptPortal(settings: AppSettings, prompt: string, context: string, conversationId: string): Promise<string> {
    requireAppAuth(settings, 'use ChatGPT')
    const threadId = `chatgpt-${conversationId}`
    const form = new FormData()
    form.append('prompt', prompt)
    form.append('conversationId', conversationId)
    form.append('threadId', threadId)
    form.append('priority', 'next')
    form.append('context', JSON.stringify(context ? [{ role: 'user', content: context }] : []))
    const requestHeaders = new Headers(headers(settings))
    requestHeaders.delete('Content-Type')
    const response = await apiFetch(settings, identityUrl(settings, 'prompt'), {
        method: 'POST',
        headers: requestHeaders,
        body: form,
    })
    const payload = asRecord(await response.json().catch(() => ({})))
    if (!response.ok) {
        const error = asRecord(payload.error)
        throw new Error(String(error.message || payload.error || 'Unable to send to ChatGPT.'))
    }

    const deadline = Date.now() + 180_000
    while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 2500))
        const query = new URLSearchParams({ conversationId, threadId })
        const resultResponse = await apiFetch(settings, `${identityUrl(settings, 'prompt')}?${query}`, { headers: headers(settings) })
        const state = asRecord(await resultResponse.json().catch(() => ({})))
        if (!resultResponse.ok) {
            const error = asRecord(state.error)
            throw new Error(String(error.message || state.error || 'Unable to load ChatGPT response.'))
        }
        const items = Array.isArray(state.items) ? state.items : []
        const latest = asRecord(items[items.length - 1])
        if (latest.status === 'done') return stringValue(latest.result) || 'ChatGPT completed without a text response.'
        if (latest.status === 'error') throw new Error(stringValue(latest.error) || 'ChatGPT could not complete the request.')
    }
    throw new Error('ChatGPT is still working. Open Hanasand in a browser to check the request queue.')
}

export async function fetchAiModels(settings: AppSettings) {
    if (!settings.apiBaseUrl.trim()) {
        return []
    }

    const response = await apiFetch(settings, joinUrl(settings.apiBaseUrl, 'ai/models'), {
        headers: headers(settings),
    })
    const body = await response.json().catch(() => ({} as Record<string, unknown>))
    if (!response.ok) {
        throw new Error(String(body.error || 'Unable to load model status.'))
    }

    const connected = Array.isArray(body.connected) ? body.connected.map(normalizeGptClient).filter(Boolean) as GptClient[] : []
    return connected
}

export async function fetchUserShares(settings: AppSettings) {
    requireCdnAuth(settings, 'load shares')

    const response = await apiFetch(settings, joinUrl(settings.cdnBaseUrl, `share/user/${segment(settings.userId)}`), {
        headers: headers(settings),
    })
    const body = await response.json().catch(() => ([]))
    if (!response.ok) {
        throw new Error('Unable to load shares.')
    }

    return Array.isArray(body) ? body.map(normalizeShare).filter(Boolean) as ShareSummary[] : []
}

export type CdnUserFile = { id: string; name: string; type: string; uploadedAt: string; sizeBytes?: number }

export async function fetchCdnUserFiles(settings: AppSettings): Promise<CdnUserFile[]> {
    requireCdnAuth(settings, 'load your image library')
    const url = `${joinUrl(settings.cdnBaseUrl, `files/user/${segment(settings.userId)}`)}?limit=100&offset=0`
    const response = await apiFetch(settings, url, { headers: headers(settings) })
    const body = await response.json().catch(() => [])
    if (!response.ok) throw new Error(String(asRecord(body).error || 'Unable to load your Hanasand library.'))
    if (!Array.isArray(body)) throw new Error('The Hanasand library returned an unexpected response.')
    return body.map(item => {
        const file = asRecord(item)
        return {
            id: stringValue(file.id),
            name: stringValue(file.name) || 'Image',
            type: stringValue(file.type),
            uploadedAt: stringValue(file.uploaded_at) || stringValue(file.uploadedAt),
            sizeBytes: numberValue(file.size_bytes) ?? numberValue(file.sizeBytes),
        }
    }).filter(file => file.id && file.type.startsWith('image/'))
}

export async function createShare(settings: AppSettings, payload: { id: string; content: string; name?: string; path?: string; type?: string }) {
    requireCdnAuth(settings, 'create shares')

    const response = await apiFetch(settings, joinUrl(settings.cdnBaseUrl, 'share'), {
        method: 'POST',
        headers: headers(settings),
        body: JSON.stringify(payload),
    })
    const body = await response.json().catch(() => ({} as Record<string, unknown>))
    if (!response.ok) {
        throw new Error(String(body.error || 'Unable to create share.'))
    }

    const share = normalizeShare(body)
    if (!share) {
        throw new Error('Create share returned an unexpected response.')
    }
    return share
}

export async function updateShare(settings: AppSettings, id: string, updates: { path?: string; content?: string; name?: string }) {
    requireCdnAuth(settings, 'update shares')

    const response = await apiFetch(settings, joinUrl(settings.cdnBaseUrl, `share/${segment(id)}`), {
        method: 'PUT',
        headers: headers(settings),
        body: JSON.stringify(updates),
    })
    const body = await response.json().catch(() => ({} as Record<string, unknown>))
    if (!response.ok) {
        throw new Error(String(body.error || 'Unable to update share.'))
    }

    const share = normalizeShare(body)
    if (!share) {
        throw new Error('Update share returned an unexpected response.')
    }
    return share
}

export async function deleteShare(settings: AppSettings, id: string) {
    requireCdnAuth(settings, 'delete shares')

    const response = await apiFetch(settings, joinUrl(settings.cdnBaseUrl, `share/${segment(id)}`), {
        method: 'DELETE',
        headers: headers(settings),
    })
    if (!response.ok) {
        const body = await response.json().catch(() => ({} as Record<string, unknown>))
        throw new Error(String(body.error || 'Unable to delete share.'))
    }
}

export async function setShareLock(settings: AppSettings, id: string, locked: boolean) {
    requireCdnAuth(settings, 'lock shares')

    const response = await apiFetch(settings, joinUrl(settings.cdnBaseUrl, `share/lock/${segment(id)}`), {
        method: 'PUT',
        headers: headers(settings),
        body: JSON.stringify({ locked }),
    })
    const body = await response.json().catch(() => ({} as Record<string, unknown>))
    if (!response.ok) {
        throw new Error(String(body.error || 'Unable to lock or unlock share.'))
    }

    const share = normalizeShare(body)
    if (!share) {
        throw new Error('Lock share returned an unexpected response.')
    }
    return share
}

export async function fetchShareTree(settings: AppSettings, id: string) {
    requireCdnAuth(settings, 'load share trees')

    const response = await apiFetch(settings, joinUrl(settings.cdnBaseUrl, `share/tree/${segment(id)}`), {
        headers: headers(settings),
    })
    const body = await response.json().catch(() => [])
    if (!response.ok) {
        throw new Error('Unable to load share tree.')
    }

    return normalizeShareTree(body)
}

export async function fetchTopDomains(settings: AppSettings) {
    if (!settings.cdnBaseUrl.trim()) {
        return []
    }

    const response = await apiFetch(settings, `${joinUrl(settings.cdnBaseUrl, 'traffic/tps')}?fresh=1`, {
        headers: headers(settings),
    })
    const body = await response.json().catch(() => ([]))
    if (!response.ok) {
        throw new Error('Unable to load domain activity.')
    }

    return Array.isArray(body) ? body.map(normalizeTrafficDomain).filter(Boolean).slice(0, 5) as Array<{ name: string; tps?: number }> : []
}

export async function fetchDesktopAgentStatus(settings: AppSettings) {
    const response = await fetchDesktopAgentPath(settings, 'status')
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
        throw new Error(String(asRecord(body).message || 'Desktop agent did not return a healthy status.'))
    }

    return normalizeDesktopStatus(body)
}

export async function runDesktopAgentCommand(settings: AppSettings, command: string) {
    const response = await fetchDesktopAgentPath(settings, 'command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
        throw new Error(String(asRecord(body).message || 'Desktop command failed.'))
    }

    return normalizeDesktopStatus(body)
}

export async function fetchDesktopScreenshot(settings: AppSettings) {
    const response = await fetchDesktopAgentPath(settings, 'screenshot')
    const body = asRecord(await response.json().catch(() => ({})))
    if (!response.ok || !booleanValue(body.ok)) {
        throw new Error(String(body.message || 'Unable to capture Mac screen.'))
    }

    const mimeType = stringValue(body.mimeType) || 'image/png'
    const imageBase64 = stringValue(body.imageBase64)
    if (!imageBase64) {
        throw new Error('Desktop screenshot response did not include an image.')
    }

    return {
        ok: true,
        message: stringValue(body.message) || undefined,
        mimeType,
        imageBase64,
    }
}

export async function fetchNotes(settings: AppSettings) {
    requireAppAuth(settings, 'load notes')

    const response = await apiFetch(settings, joinUrl(settings.apiBaseUrl, 'notes'), {
        headers: headers(settings),
    })
    const body = await response.json().catch(() => ([]))
    if (!response.ok) {
        throw new Error(String((body as { error?: string }).error || 'Unable to load notes.'))
    }

    return Array.isArray(body) ? body.map(normalizeNote).filter(Boolean) as Note[] : []
}

export type MobileProfileStats = {
    loginDays: Array<{ day: string; logins: number }>
    counts: { organizations: number; containers: number; vms: number; shares: number; articles: number }
}

export async function fetchProfileStats(settings: AppSettings): Promise<MobileProfileStats> {
    requireAppAuth(settings, 'load profile details')
    const response = await apiFetch(settings, joinUrl(settings.apiBaseUrl, `user/${segment(settings.userId)}/profile-stats`), { headers: headers(settings) })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(String((body as { error?: string }).error || 'Unable to load profile details.'))
    const value = asRecord(body)
    const counts = asRecord(value.counts)
    return {
        loginDays: Array.isArray(value.loginDays) ? value.loginDays.map(item => {
            const day = asRecord(item)
            return { day: stringValue(day.day), logins: numberValue(day.logins) ?? 0 }
        }).filter(item => item.day) : [],
        counts: {
            organizations: numberValue(counts.organizations) ?? 0,
            containers: numberValue(counts.containers) ?? 0,
            vms: numberValue(counts.vms) ?? 0,
            shares: numberValue(counts.shares) ?? 0,
            articles: numberValue(counts.articles) ?? 0,
        },
    }
}

export async function createNote(settings: AppSettings, payload: { title: string; content: string }) {
    requireAppAuth(settings, 'save notes')

    const response = await apiFetch(settings, joinUrl(settings.apiBaseUrl, 'notes'), {
        method: 'POST',
        headers: headers(settings),
        body: JSON.stringify({ ...payload, source: 'app' }),
    })
    const body = await response.json().catch(() => ({} as Record<string, unknown>))
    if (!response.ok) {
        throw new Error(String(body.error || 'Unable to create note.'))
    }

    const note = normalizeNote(body)
    if (!note) {
        throw new Error('Create note returned an unexpected response.')
    }
    return note
}

export async function updateNote(settings: AppSettings, id: string, payload: { title: string; content: string }) {
    requireAppAuth(settings, 'save notes')

    const response = await apiFetch(settings, joinUrl(settings.apiBaseUrl, `notes/${segment(id)}`), {
        method: 'PUT',
        headers: headers(settings),
        body: JSON.stringify({ ...payload, source: 'app' }),
    })
    const body = await response.json().catch(() => ({} as Record<string, unknown>))
    if (!response.ok) {
        throw new Error(String(body.error || 'Unable to update note.'))
    }

    const note = normalizeNote(body)
    if (!note) {
        throw new Error('Update note returned an unexpected response.')
    }
    return note
}

export async function deleteNote(settings: AppSettings, id: string) {
    requireAppAuth(settings, 'delete notes')

    const response = await apiFetch(settings, joinUrl(settings.apiBaseUrl, `notes/${segment(id)}`), {
        method: 'DELETE',
        headers: headers(settings),
    })
    const body = await response.json().catch(() => ({} as Record<string, unknown>))
    if (!response.ok) {
        throw new Error(String(body.error || 'Unable to delete note.'))
    }
}

export async function fetchDashboardUsers(settings: AppSettings) {
    requireAppAuth(settings, 'load users')

    const response = await apiFetch(settings, joinUrl(settings.apiBaseUrl, 'users'), {
        headers: headers(settings),
    })
    const body = await readJsonObject(response, [])
    if (!response.ok) {
        throw new Error(String(asRecord(body).error || 'Unable to load users.'))
    }

    return Array.isArray(body) ? body.map(normalizeDashboardUser).filter(Boolean) as DashboardUser[] : []
}

export async function fetchDashboardRoles(settings: AppSettings) {
    requireAppAuth(settings, 'load roles')

    const response = await apiFetch(settings, joinUrl(settings.apiBaseUrl, 'roles'), {
        headers: headers(settings),
    })
    const body = await readJsonObject(response, [])
    if (!response.ok) {
        throw new Error(String(asRecord(body).error || 'Unable to load roles.'))
    }

    return Array.isArray(body) ? body.map(normalizeRole).filter(Boolean) as DashboardRole[] : []
}

export async function fetchDashboardUserRoles(settings: AppSettings, userId: string) {
    requireAppAuth(settings, 'load user roles')

    const response = await apiFetch(settings, joinUrl(settings.apiBaseUrl, `roles/user/${segment(userId)}`), {
        headers: headers(settings),
    })
    const body = await readJsonObject(response, [])
    if (!response.ok) {
        throw new Error(String(asRecord(body).error || 'Unable to load user roles.'))
    }

    return Array.isArray(body) ? body.map(normalizeUserRoleAssignment).filter(Boolean) as DashboardUserRoleAssignment[] : []
}

export async function startMobileImpersonation(settings: AppSettings, userId: string) {
    requireAppAuth(settings, 'impersonate users')
    if (userId === settings.userId) {
        throw new Error('You are already viewing your own account.')
    }

    const response = await apiFetch(settings, joinUrl(settings.apiBaseUrl, 'impersonation/start'), {
        method: 'POST',
        headers: headers({ ...settings, impersonationToken: '', impersonatingUserId: '', impersonatingUserName: '' }),
        body: JSON.stringify({ target_id: userId }),
    })
    const body = await readJsonObject(response, {})
    if (!response.ok) {
        throw new Error(String(asRecord(body).error || 'Unable to start impersonation.'))
    }
    const record = asRecord(body)
    const session = asRecord(record.session)
    const target = asRecord(session.target)
    return {
        token: String(record.token || ''),
        targetId: String(target.id || userId),
        targetName: String(target.name || userId),
    }
}

export async function stopMobileImpersonation(settings: AppSettings) {
    if (!settings.impersonationToken || !settings.authToken || !settings.userId) return
    await apiFetch(settings, joinUrl(settings.apiBaseUrl, 'impersonation'), {
        method: 'DELETE',
        headers: headers(settings),
    }).catch(() => {})
}

export async function setDashboardUserActive(settings: AppSettings, userId: string, active: boolean) {
    requireAppAuth(settings, 'update users')

    const response = await apiFetch(settings, joinUrl(settings.apiBaseUrl, `user/${segment(userId)}/active`), {
        method: 'PUT',
        headers: headers(settings),
        body: JSON.stringify({ active }),
    })
    const body = await readJsonObject(response, {})
    if (!response.ok) {
        throw new Error(String(asRecord(body).error || 'Unable to update user.'))
    }
}

export async function assignDashboardUserRole(settings: AppSettings, userId: string, roleId: string) {
    return mutateDashboardUserRole(settings, userId, roleId, true)
}

export async function unassignDashboardUserRole(settings: AppSettings, userId: string, roleId: string) {
    return mutateDashboardUserRole(settings, userId, roleId, false)
}

async function mutateDashboardUserRole(settings: AppSettings, userId: string, roleId: string, assigned: boolean) {
    requireAppAuth(settings, assigned ? 'assign roles' : 'remove roles')

    const action = assigned ? 'assign' : 'unassign'
    const response = await apiFetch(settings, joinUrl(settings.apiBaseUrl, `role/${action}/${segment(userId)}`), {
        method: 'POST',
        headers: headers(settings),
        body: JSON.stringify({ role_id: roleId }),
    })
    const body = await readJsonObject(response, {})
    if (!response.ok) {
        throw new Error(String(asRecord(body).error || `Unable to ${action} role.`))
    }

    return body
}

export async function fetchAutomations(settings: AppSettings) {
    requireAppAuth(settings, 'load automations')

    const response = await apiFetch(settings, joinUrl(settings.apiBaseUrl, 'automations'), {
        headers: headers(settings),
    })
    const body = await readJsonObject(response, {})
    if (!response.ok) {
        throw new Error(String(asRecord(body).error || 'Unable to load automations.'))
    }

    const automations = asRecord(body).automations
    return Array.isArray(automations) ? automations.map(normalizeAutomation).filter(Boolean) as AgentAutomation[] : []
}

export async function fetchAutomationDetails(settings: AppSettings, id: string) {
    requireAppAuth(settings, 'load automation runs')

    const response = await apiFetch(settings, joinUrl(settings.apiBaseUrl, `automations/${segment(id)}`), {
        headers: headers(settings),
    })
    const body = await readJsonObject(response, {})
    if (!response.ok) {
        throw new Error(String(asRecord(body).error || 'Unable to load automation.'))
    }

    const entry = asRecord(body)
    const automation = normalizeAutomation(entry.automation)
    const runs = Array.isArray(entry.runs) ? entry.runs.map(normalizeAutomationRun).filter(Boolean) as AgentAutomationRun[] : []
    return { automation, runs }
}

export async function createAutomation(settings: AppSettings, payload: AgentAutomationPayload) {
    return mutateAutomation(settings, 'automations', 'POST', payload)
}

export async function updateAutomation(settings: AppSettings, id: string, payload: AgentAutomationPayload) {
    return mutateAutomation(settings, `automations/${segment(id)}`, 'PUT', payload)
}

export async function deleteAutomation(settings: AppSettings, id: string) {
    return mutateAutomation(settings, `automations/${segment(id)}`, 'DELETE')
}

export async function runAutomationNow(settings: AppSettings, id: string) {
    requireAppAuth(settings, 'run automations')

    const response = await apiFetch(settings, joinUrl(settings.apiBaseUrl, `automations/${segment(id)}/run`), {
        method: 'POST',
        headers: headers(settings),
    })
    const body = await readJsonObject(response, {})
    if (!response.ok) {
        throw new Error(String(asRecord(body).error || 'Unable to run automation.'))
    }
}

export async function fetchManagedCronJobs(settings: AppSettings) {
    requireAppAuth(settings, 'load system cron jobs')

    const response = await apiFetch(settings, joinUrl(settings.apiBaseUrl, 'system/cron'), {
        headers: headers(settings),
    })
    const body = await readJsonObject(response, {})
    if (!response.ok) {
        throw new Error(String(asRecord(body).error || 'Unable to load cron jobs.'))
    }

    const jobs = asRecord(body).jobs
    return Array.isArray(jobs) ? jobs.map(normalizeManagedCronJob).filter(Boolean) as ManagedCronJob[] : []
}

export async function updateManagedCronJob(settings: AppSettings, id: string, payload: { schedule?: string, enabled?: boolean }) {
    requireAppAuth(settings, 'update system cron jobs')

    const response = await apiFetch(settings, joinUrl(settings.apiBaseUrl, `system/cron/${segment(id)}`), {
        method: 'PUT',
        headers: headers(settings),
        body: JSON.stringify(payload),
    })
    const body = await readJsonObject(response, {})
    if (!response.ok) {
        throw new Error(String(asRecord(body).error || 'Unable to update cron job.'))
    }

    const jobs = asRecord(body).jobs
    return Array.isArray(jobs) ? jobs.map(normalizeManagedCronJob).filter(Boolean) as ManagedCronJob[] : []
}

async function mutateAutomation(settings: AppSettings, path: string, method: 'POST' | 'PUT' | 'DELETE', payload?: AgentAutomationPayload) {
    requireAppAuth(settings, 'save automations')

    const response = await apiFetch(settings, joinUrl(settings.apiBaseUrl, path), {
        method,
        headers: headers(settings),
        body: payload ? JSON.stringify(payload) : undefined,
    })
    const body = await readJsonObject(response, {})
    if (!response.ok) {
        throw new Error(String(asRecord(body).error || 'Unable to save automation.'))
    }

    return normalizeAutomation(asRecord(body).automation)
}

function normalizeAutomation(value: unknown): AgentAutomation | null {
    const entry = asRecord(value)
    const id = stringValue(entry.id)
    if (!id) return null

    return {
        id,
        name: stringValue(entry.name) || 'Automation',
        prompt: stringValue(entry.prompt),
        scheduleKind: stringValue(entry.scheduleKind) === 'once' ? 'once' : 'interval',
        intervalMinutes: typeof entry.intervalMinutes === 'number' ? entry.intervalMinutes : null,
        runAt: stringValue(entry.runAt) || null,
        status: stringValue(entry.status) === 'paused' ? 'paused' : stringValue(entry.status) === 'archived' ? 'archived' : 'active',
        actionType: stringValue(entry.actionType) === 'echo' ? 'echo' : 'agent_prompt',
        timezone: stringValue(entry.timezone) || 'UTC',
        modelName: stringValue(entry.modelName) || null,
        notifyOn: stringValue(entry.notifyOn) === 'always' ? 'always' : stringValue(entry.notifyOn) === 'never' ? 'never' : 'failure',
        nextRunAt: stringValue(entry.nextRunAt) || null,
        lastRunAt: stringValue(entry.lastRunAt) || null,
        lastCompletedAt: stringValue(entry.lastCompletedAt) || null,
        lastStatus: stringValue(entry.lastStatus) || null,
        lastResult: stringValue(entry.lastResult) || null,
        lastError: stringValue(entry.lastError) || null,
        consecutiveFailures: Number(entry.consecutiveFailures) || 0,
        pausedReason: stringValue(entry.pausedReason) || null,
        runCount: Number(entry.runCount) || 0,
        createdAt: stringValue(entry.createdAt),
        updatedAt: stringValue(entry.updatedAt),
    }
}

function normalizeAutomationRun(value: unknown): AgentAutomationRun | null {
    const entry = asRecord(value)
    const id = stringValue(entry.id)
    if (!id) return null

    return {
        id,
        automationId: stringValue(entry.automationId),
        status: stringValue(entry.status) === 'failed' ? 'failed' : stringValue(entry.status) === 'completed' ? 'completed' : 'running',
        result: stringValue(entry.result) || null,
        error: stringValue(entry.error) || null,
        provider: stringValue(entry.provider) || null,
        model: stringValue(entry.model) || null,
        startedAt: stringValue(entry.startedAt),
        completedAt: stringValue(entry.completedAt) || null,
        durationMs: typeof entry.durationMs === 'number' ? entry.durationMs : null,
    }
}

function normalizeManagedCronJob(value: unknown): ManagedCronJob | null {
    const entry = asRecord(value)
    const id = stringValue(entry.id)
    if (!id) return null

    return {
        id,
        name: stringValue(entry.name) || id,
        description: stringValue(entry.description),
        defaultSchedule: stringValue(entry.defaultSchedule),
        command: stringValue(entry.command),
        host: stringValue(entry.host),
        logPath: stringValue(entry.logPath) || undefined,
        schedule: stringValue(entry.schedule),
        enabled: booleanValue(entry.enabled) ?? false,
        installed: booleanValue(entry.installed) ?? false,
        lastLogLine: stringValue(entry.lastLogLine) || null,
        lastLogAt: stringValue(entry.lastLogAt) || null,
    }
}
