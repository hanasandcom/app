import { beforeEach, describe, expect, it, mock } from 'bun:test'

const asyncValues = new Map<string, string>()
const secureValues = new Map<string, string>()
const operations: string[] = []
let failSecureWrite = false
let failAsyncRead = false

mock.module('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: async (key: string) => {
            if (failAsyncRead) throw new Error('Async storage unavailable')
            return asyncValues.get(key) ?? null
        },
        setItem: async (key: string, value: string) => {
            operations.push(`async:${key}`)
            asyncValues.set(key, value)
        },
    },
}))

mock.module('expo-secure-store', () => ({
    getItemAsync: async (key: string) => secureValues.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
        operations.push(`secure:${key}`)
        if (failSecureWrite) throw new Error('Secure storage unavailable')
        secureValues.set(key, value)
    },
    deleteItemAsync: async (key: string) => {
        operations.push(`delete:${key}`)
        secureValues.delete(key)
    },
}))

const {
    defaultSettings,
    loadAuthenticatorEntries,
    loadSettings,
    saveAuthenticatorEntries,
    saveSettings,
} = await import('./storage')

function totpKey(id: string) {
    return `hanasand-mobile.totp.${Array.from(id, character => character.codePointAt(0)!.toString(16).padStart(6, '0')).join('')}`
}

beforeEach(() => {
    asyncValues.clear()
    secureValues.clear()
    operations.length = 0
    failSecureWrite = false
    failAsyncRead = false
})

describe('secure local storage', () => {
    it('moves legacy session tokens to secure storage before scrubbing AsyncStorage', async () => {
        const legacy = { ...defaultSettings, authToken: 'legacy-auth', impersonationToken: 'legacy-impersonation' }
        asyncValues.set('hanasand-mobile/settings', JSON.stringify(legacy))

        const settings = await loadSettings()
        const persisted = asyncValues.get('hanasand-mobile/settings')!

        expect(settings.authToken).toBe('legacy-auth')
        expect(settings.impersonationToken).toBe('legacy-impersonation')
        expect(secureValues.get('hanasand-mobile.auth-token')).toBe('legacy-auth')
        expect(secureValues.get('hanasand-mobile.impersonation-token')).toBe('legacy-impersonation')
        expect(persisted).not.toContain('legacy-auth')
        expect(persisted).not.toContain('legacy-impersonation')
        expect(operations.indexOf('secure:hanasand-mobile.auth-token')).toBeLessThan(operations.indexOf('async:hanasand-mobile/settings'))
    })

    it('leaves legacy session data intact when secure migration fails', async () => {
        const legacy = { ...defaultSettings, authToken: 'keep-on-failure' }
        const raw = JSON.stringify(legacy)
        asyncValues.set('hanasand-mobile/settings', raw)
        failSecureWrite = true

        await expect(loadSettings()).rejects.toThrow('Secure storage unavailable')
        expect(asyncValues.get('hanasand-mobile/settings')).toBe(raw)
    })

    it('does not treat an unreadable legacy store as empty during startup', async () => {
        asyncValues.set('hanasand-mobile/settings', JSON.stringify({ ...defaultSettings, authToken: 'legacy-auth' }))
        failAsyncRead = true

        await expect(loadSettings()).rejects.toThrow('Async storage unavailable')
        expect(secureValues.size).toBe(0)
    })

    it('never writes session tokens back to AsyncStorage during later saves', async () => {
        const settings = { ...defaultSettings, authToken: 'new-auth', impersonationToken: 'new-impersonation' }

        await saveSettings(settings)

        expect(secureValues.get('hanasand-mobile.auth-token')).toBe('new-auth')
        expect(secureValues.get('hanasand-mobile.impersonation-token')).toBe('new-impersonation')
        expect(asyncValues.get('hanasand-mobile/settings')).not.toContain('new-auth')
        expect(asyncValues.get('hanasand-mobile/settings')).not.toContain('new-impersonation')
    })

    it('moves legacy TOTP seeds to SecureStore before replacing their AsyncStorage record', async () => {
        asyncValues.set('hanasand-mobile/authenticator', JSON.stringify([
            { id: 'entry-1', label: 'Work', secret: 'legacy-totp-seed', digits: 6, period: 30 },
        ]))

        const entries = await loadAuthenticatorEntries()
        const persisted = asyncValues.get('hanasand-mobile/authenticator')!

        expect(entries[0]?.secret).toBe('legacy-totp-seed')
        expect([...secureValues.entries()].some(([key, value]) => key.startsWith('hanasand-mobile.totp.') && value === 'legacy-totp-seed')).toBe(true)
        expect(persisted).not.toContain('legacy-totp-seed')
        expect(persisted).not.toContain('secret')
        expect(operations.at(-1)).toBe('async:hanasand-mobile/authenticator')
    })

    it('keeps legacy TOTP data intact when secure migration fails', async () => {
        const raw = JSON.stringify([{ id: 'entry-1', secret: 'keep-totp-on-failure' }])
        asyncValues.set('hanasand-mobile/authenticator', raw)
        failSecureWrite = true

        await expect(loadAuthenticatorEntries()).rejects.toThrow('Secure storage unavailable')
        expect(asyncValues.get('hanasand-mobile/authenticator')).toBe(raw)
    })

    it('stores new TOTP seeds only in SecureStore and removes deleted seeds', async () => {
        secureValues.set(totpKey('old-entry'), 'old-totp-seed')
        asyncValues.set('hanasand-mobile/authenticator', JSON.stringify([{ id: 'old-entry' }]))

        await saveAuthenticatorEntries([
            { id: 'new-entry', label: 'New', secret: 'new-totp-seed', digits: 6, period: 30 },
        ])

        expect([...secureValues.entries()].some(([key, value]) => key.startsWith('hanasand-mobile.totp.') && value === 'new-totp-seed')).toBe(true)
        expect(asyncValues.get('hanasand-mobile/authenticator')).not.toContain('new-totp-seed')
        expect(asyncValues.get('hanasand-mobile/authenticator')).not.toContain('secret')
        expect(secureValues.has(totpKey('old-entry'))).toBe(false)
        expect(operations).toContain(`delete:${totpKey('old-entry')}`)
    })
})
