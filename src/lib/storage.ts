import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import type { AiChatMessage, AppSettings, AuthenticatorEntry, SavedMailboxConnection } from '../types'

const SETTINGS_KEY = 'hanasand-mobile/settings'
const MAILBOX_CONNECTIONS_KEY = 'hanasand-mobile/mailbox-connections'
const AUTHENTICATOR_KEY = 'hanasand-mobile/authenticator'
const AI_CHAT_KEY = 'hanasand-mobile/ai-chat'
const AUTH_TOKEN_KEY = 'hanasand-mobile.auth-token'
const IMPERSONATION_TOKEN_KEY = 'hanasand-mobile.impersonation-token'
const AUTHENTICATOR_SECRET_PREFIX = 'hanasand-mobile.totp.'

export const defaultSettings: AppSettings = {
    themeMode: 'obsidian',
    workspaceMode: 'coding',
    siteBaseUrl: 'https://hanasand.com',
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.hanasand.com/api',
    cdnBaseUrl: 'https://cdn.hanasand.com/api',
    authToken: '',
    userId: '',
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

function parseJSON(raw: string) {
    try {
        return JSON.parse(raw) as unknown
    } catch {
        return null
    }
}

function parseArray<T>(raw: string | null): T[] {
    if (!raw) return []
    const value = parseJSON(raw)
    return Array.isArray(value) ? value as T[] : []
}

function asRecord(value: unknown) {
    return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown) {
    return typeof value === 'string' ? value : ''
}

function isPrivateNetworkHost(hostname: string) {
    const host = hostname.toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local')) return true
    if (host.startsWith('10.') || host.startsWith('192.168.')) return true
    const match = host.match(/^172\.(\d{1,2})\./)
    return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31)
}

function secureUrlOrDefault(value: string, fallback: string) {
    const trimmed = value.trim()
    if (!trimmed) return fallback
    try {
        const url = new URL(trimmed)
        if (url.protocol === 'https:' || (url.protocol === 'http:' && isPrivateNetworkHost(url.hostname))) {
            return trimmed
        }
    } catch {
        return fallback
    }
    return fallback
}

function numberValue(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

async function getStoredValue(key: string) {
    return await AsyncStorage.getItem(key)
}

async function setStoredValue(key: string, value: string) {
    await AsyncStorage.setItem(key, value)
}

function normalizeSettings(value: unknown): AppSettings {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return defaultSettings
    }

    const partial = value as Partial<AppSettings>
    const themeMode = partial.themeMode === 'graphite' || partial.themeMode === 'forest' || partial.themeMode === 'obsidian'
        ? partial.themeMode
        : defaultSettings.themeMode
    const workspaceMode = partial.workspaceMode === 'daily' || partial.workspaceMode === 'coding'
        ? partial.workspaceMode
        : defaultSettings.workspaceMode

    const merged = {
        ...defaultSettings,
        ...partial,
        themeMode,
        workspaceMode,
    }

    // Older app builds pointed general API calls at the website origin. Keep
    // custom API hosts intact while migrating that known default to the
    // canonical API host used by the website.
    if (merged.apiBaseUrl.replace(/\/+$/, '') === 'https://hanasand.com/api') {
        merged.apiBaseUrl = defaultSettings.apiBaseUrl
    }

    merged.siteBaseUrl = secureUrlOrDefault(merged.siteBaseUrl, defaultSettings.siteBaseUrl)
    merged.apiBaseUrl = secureUrlOrDefault(merged.apiBaseUrl, defaultSettings.apiBaseUrl)
    merged.cdnBaseUrl = secureUrlOrDefault(merged.cdnBaseUrl, defaultSettings.cdnBaseUrl)
    merged.codexUrl = secureUrlOrDefault(merged.codexUrl, defaultSettings.codexUrl)
    merged.desktopAgentBaseUrl = secureHttpsUrlOrDefault(merged.desktopAgentBaseUrl, defaultSettings.desktopAgentBaseUrl)
    merged.serverBaseUrl = secureUrlOrDefault(merged.serverBaseUrl, defaultSettings.serverBaseUrl)

    return Object.fromEntries(
        Object.entries(merged).map(([key, entry]) => [key, typeof entry === 'string' ? entry : String(defaultSettings[key as keyof AppSettings] || '')]),
    ) as AppSettings
}

function secureHttpsUrlOrDefault(value: string, fallback: string) {
    const trimmed = value.trim()
    if (!trimmed) return fallback
    try {
        const url = new URL(trimmed)
        return url.protocol === 'https:' ? trimmed : fallback
    } catch {
        return fallback
    }
}

export async function loadSettings() {
    const raw = await getStoredValue(SETTINGS_KEY)
    const legacySettings = raw ? normalizeSettings(parseJSON(raw)) : defaultSettings
    const [authToken, impersonationToken] = await Promise.all([
        SecureStore.getItemAsync(AUTH_TOKEN_KEY),
        SecureStore.getItemAsync(IMPERSONATION_TOKEN_KEY),
    ])

    const nextSettings = {
        ...legacySettings,
        authToken: authToken ?? legacySettings.authToken,
        impersonationToken: impersonationToken ?? legacySettings.impersonationToken,
    }

    if (authToken === null && legacySettings.authToken) {
        await SecureStore.setItemAsync(AUTH_TOKEN_KEY, legacySettings.authToken)
    }
    if (impersonationToken === null && legacySettings.impersonationToken) {
        await SecureStore.setItemAsync(IMPERSONATION_TOKEN_KEY, legacySettings.impersonationToken)
    }

    if (nextSettings.authToken !== legacySettings.authToken || nextSettings.impersonationToken !== legacySettings.impersonationToken) {
        // Keep the legacy copy until both secrets are safely stored. If this write
        // fails, a later load can retry from the still-intact legacy record.
        await setStoredValue(SETTINGS_KEY, JSON.stringify(settingsWithoutSecrets(nextSettings)))
    } else if (legacySettings.authToken || legacySettings.impersonationToken) {
        // Also scrub a legacy record after a partially completed earlier migration.
        await setStoredValue(SETTINGS_KEY, JSON.stringify(settingsWithoutSecrets(nextSettings)))
    }

    return nextSettings
}

export async function saveSettings(settings: AppSettings) {
    await Promise.all([
        SecureStore.setItemAsync(AUTH_TOKEN_KEY, settings.authToken),
        SecureStore.setItemAsync(IMPERSONATION_TOKEN_KEY, settings.impersonationToken),
    ])
    await setStoredValue(SETTINGS_KEY, JSON.stringify(settingsWithoutSecrets(settings)))
}

function settingsWithoutSecrets(settings: AppSettings) {
    return { ...settings, authToken: '', impersonationToken: '' }
}

function authenticatorSecretKey(id: string) {
    const encodedId = Array.from(id, character => character.codePointAt(0)!.toString(16).padStart(6, '0')).join('')
    return `${AUTHENTICATOR_SECRET_PREFIX}${encodedId}`
}

export async function loadMailboxConnections() {
    return parseArray<unknown>(await getStoredValue(MAILBOX_CONNECTIONS_KEY)).map(item => {
        const entry = asRecord(item)
        const id = stringValue(entry.id)
        const email = stringValue(entry.email)
        if (!id || !email) return null
        return {
            id,
            label: stringValue(entry.label) || email,
            email,
            imapHost: stringValue(entry.imapHost) || 'imap.gmail.com',
            smtpHost: stringValue(entry.smtpHost) || 'smtp.gmail.com',
        }
    }).filter(Boolean) as SavedMailboxConnection[]
}

export async function saveMailboxConnections(connections: SavedMailboxConnection[]) {
    await setStoredValue(MAILBOX_CONNECTIONS_KEY, JSON.stringify(connections))
}

export async function loadAuthenticatorEntries() {
    const rawEntries = parseArray<unknown>(await getStoredValue(AUTHENTICATOR_KEY))
    if (rawEntries.some(item => stringValue(asRecord(item).secret) && !stringValue(asRecord(item).id))) {
        throw new Error('An authenticator secret has no entry ID, so it cannot be migrated safely.')
    }
    const entries = rawEntries.map(item => {
        const entry = asRecord(item)
        const id = stringValue(entry.id)
        const legacySecret = stringValue(entry.secret)
        if (!id) return null
        return {
            id,
            label: stringValue(entry.label) || 'Authenticator code',
            issuer: stringValue(entry.issuer) || undefined,
            account: stringValue(entry.account) || undefined,
            legacySecret,
            digits: typeof entry.digits === 'number' ? entry.digits : 6,
            period: typeof entry.period === 'number' ? entry.period : 30,
        }
    }).filter((entry): entry is NonNullable<typeof entry> => entry !== null)

    const migrated: AuthenticatorEntry[] = []
    for (const entry of entries) {
        const secureSecret = await SecureStore.getItemAsync(authenticatorSecretKey(entry.id))
        const secret = secureSecret || entry.legacySecret
        if (!secureSecret && entry.legacySecret) {
            await SecureStore.setItemAsync(authenticatorSecretKey(entry.id), entry.legacySecret)
        }
        if (secret) migrated.push({ ...entry, secret })
    }

    if (entries.some(entry => entry.legacySecret)) {
        // Write every legacy secret to SecureStore before replacing the old JSON.
        await setStoredValue(AUTHENTICATOR_KEY, JSON.stringify(migrated.map(({ id, label, issuer, account, digits, period }) => ({ id, label, issuer, account, digits, period }))))
    }
    return migrated
}

export async function saveAuthenticatorEntries(entries: AuthenticatorEntry[]) {
    const previousIds = parseArray<unknown>(await getStoredValue(AUTHENTICATOR_KEY))
        .map(item => stringValue(asRecord(item).id))
        .filter(Boolean)
    await Promise.all(entries.map(entry => SecureStore.setItemAsync(authenticatorSecretKey(entry.id), entry.secret)))
    await setStoredValue(AUTHENTICATOR_KEY, JSON.stringify(entries.map(({ id, label, issuer, account, digits, period }) => ({ id, label, issuer, account, digits, period }))))
    const retainedIds = new Set(entries.map(entry => entry.id))
    await Promise.all(previousIds.filter(id => !retainedIds.has(id)).map(id => SecureStore.deleteItemAsync(authenticatorSecretKey(id))))
}

export async function loadAiChat() {
    return parseArray<unknown>(await getStoredValue(AI_CHAT_KEY)).map(item => {
        const entry = asRecord(item)
        const id = stringValue(entry.id)
        const role = entry.role === 'user' || entry.role === 'assistant' ? entry.role : null
        if (!id || !role) return null
        const toolUses = Array.isArray(entry.toolUses)
            ? entry.toolUses.map(tool => {
                const toolEntry = asRecord(tool)
                const name = stringValue(toolEntry.name)
                if (!name) return null
                return {
                    name,
                    summary: stringValue(toolEntry.summary) || undefined,
                    durationMs: numberValue(toolEntry.durationMs),
                }
            }).filter(Boolean)
            : undefined
        const fileSummaries = Array.isArray(entry.fileSummaries)
            ? entry.fileSummaries.map(file => {
                const fileEntry = asRecord(file)
                const path = stringValue(fileEntry.path)
                if (!path) return null
                return {
                    path,
                    summary: stringValue(fileEntry.summary) || undefined,
                    additions: numberValue(fileEntry.additions),
                    deletions: numberValue(fileEntry.deletions),
                }
            }).filter(Boolean)
            : undefined
        return {
            id,
            role,
            content: stringValue(entry.content),
            createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : Date.now(),
            error: typeof entry.error === 'boolean' ? entry.error : undefined,
            pending: typeof entry.pending === 'boolean' ? entry.pending : undefined,
            durationMs: numberValue(entry.durationMs),
            thoughtSummary: stringValue(entry.thoughtSummary) || undefined,
            toolUses: toolUses?.length ? toolUses : undefined,
            fileSummaries: fileSummaries?.length ? fileSummaries : undefined,
        }
    }).filter(Boolean) as AiChatMessage[]
}

export async function saveAiChat(messages: AiChatMessage[]) {
    await setStoredValue(AI_CHAT_KEY, JSON.stringify(messages.slice(-120)))
}
