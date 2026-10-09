import AsyncStorage from '@react-native-async-storage/async-storage'
import type { AiChatMessage, AppSettings, AuthenticatorEntry, SavedMailboxConnection } from '../types'

const SETTINGS_KEY = 'hanasand-mobile/settings'
const MAILBOX_CONNECTIONS_KEY = 'hanasand-mobile/mailbox-connections'
const AUTHENTICATOR_KEY = 'hanasand-mobile/authenticator'
const AI_CHAT_KEY = 'hanasand-mobile/ai-chat'

export const defaultSettings: AppSettings = {
    themeMode: 'obsidian',
    workspaceMode: 'coding',
    siteBaseUrl: 'https://hanasand.com',
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || 'https://hanasand.com/api',
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
    try {
        return await AsyncStorage.getItem(key)
    } catch {
        return null
    }
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

    merged.siteBaseUrl = secureUrlOrDefault(merged.siteBaseUrl, defaultSettings.siteBaseUrl)
    merged.apiBaseUrl = secureUrlOrDefault(merged.apiBaseUrl, defaultSettings.apiBaseUrl)
    merged.cdnBaseUrl = secureUrlOrDefault(merged.cdnBaseUrl, defaultSettings.cdnBaseUrl)
    merged.codexUrl = secureUrlOrDefault(merged.codexUrl, defaultSettings.codexUrl)
    merged.desktopAgentBaseUrl = secureUrlOrDefault(merged.desktopAgentBaseUrl, defaultSettings.desktopAgentBaseUrl)
    merged.serverBaseUrl = secureUrlOrDefault(merged.serverBaseUrl, defaultSettings.serverBaseUrl)

    return Object.fromEntries(
        Object.entries(merged).map(([key, entry]) => [key, typeof entry === 'string' ? entry : String(defaultSettings[key as keyof AppSettings] || '')]),
    ) as AppSettings
}

export async function loadSettings() {
    const raw = await getStoredValue(SETTINGS_KEY)
    if (!raw) return defaultSettings
    return normalizeSettings(parseJSON(raw))
}

export async function saveSettings(settings: AppSettings) {
    await setStoredValue(SETTINGS_KEY, JSON.stringify(settings))
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
    return parseArray<unknown>(await getStoredValue(AUTHENTICATOR_KEY)).map(item => {
        const entry = asRecord(item)
        const id = stringValue(entry.id)
        const secret = stringValue(entry.secret)
        if (!id || !secret) return null
        return {
            id,
            label: stringValue(entry.label) || 'Authenticator code',
            issuer: stringValue(entry.issuer) || undefined,
            account: stringValue(entry.account) || undefined,
            secret,
            digits: typeof entry.digits === 'number' ? entry.digits : 6,
            period: typeof entry.period === 'number' ? entry.period : 30,
        }
    }).filter(Boolean) as AuthenticatorEntry[]
}

export async function saveAuthenticatorEntries(entries: AuthenticatorEntry[]) {
    await setStoredValue(AUTHENTICATOR_KEY, JSON.stringify(entries))
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
