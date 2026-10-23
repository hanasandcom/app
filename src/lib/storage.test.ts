import { beforeEach, describe, expect, it, mock } from 'bun:test'

const asyncValues = new Map<string, string>()
const secureValues = new Map<string, string>()
const operations: string[] = []
let failSecureWrite = false
let failAsyncRead = false
let beforeSecureWrite: ((key: string, value: string) => Promise<void>) | undefined
let beforeAsyncWrite: ((key: string, value: string) => Promise<void>) | undefined

function deferred() {
    let resolve!: () => void
    const promise = new Promise<void>(done => { resolve = done })
    return { promise, resolve }
}

mock.module('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: async (key: string) => {
            if (failAsyncRead) throw new Error('Async storage unavailable')
            return asyncValues.get(key) ?? null
        },
        setItem: async (key: string, value: string) => {
            operations.push(`async:${key}`)
            await beforeAsyncWrite?.(key, value)
            asyncValues.set(key, value)
        },
    },
}))

mock.module('expo-secure-store', () => ({
    getItemAsync: async (key: string) => secureValues.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
        operations.push(`secure:${key}`)
        await beforeSecureWrite?.(key, value)
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
    beforeSecureWrite = undefined
    beforeAsyncWrite = undefined
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

    it('clears a legacy plaintext desktop-agent URL during settings migration', async () => {
        asyncValues.set('hanasand-mobile/settings', JSON.stringify({
            ...defaultSettings,
            desktopAgentBaseUrl: 'http://192.168.1.20:45731',
        }))

        const settings = await loadSettings()

        expect(settings.desktopAgentBaseUrl).toBe('')
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

    it('serializes a held return-to-account save before a newer account and snapshots queued input', async () => {
        const entered = deferred(), release = deferred()
        beforeSecureWrite = async (key, value) => {
            if (key === 'hanasand-mobile.auth-token' && value === 'return-auth') {
                entered.resolve()
                await release.promise
            }
        }
        const returning = saveSettings({ ...defaultSettings, userId: 'actor', authToken: 'return-auth' })
        await entered.promise
        const switchedSettings = { ...defaultSettings, userId: 'other', authToken: 'other-auth', impersonationToken: 'other-delegation' }
        const switched = saveSettings(switchedSettings)
        switchedSettings.userId = 'mutated-after-call'
        switchedSettings.authToken = 'mutated-secret'
        await Promise.resolve()
        expect(operations.filter(value => value.startsWith('secure:'))).toHaveLength(2)
        expect(asyncValues.has('hanasand-mobile/settings')).toBe(false)
        release.resolve()
        await Promise.all([returning, switched])
        expect(secureValues.get('hanasand-mobile.auth-token')).toBe('other-auth')
        expect(secureValues.get('hanasand-mobile.impersonation-token')).toBe('other-delegation')
        expect(JSON.parse(asyncValues.get('hanasand-mobile/settings')!)).toMatchObject({ userId: 'other', authToken: '', impersonationToken: '' })
        expect(operations).toEqual([
            'secure:hanasand-mobile.auth-token', 'secure:hanasand-mobile.impersonation-token', 'async:hanasand-mobile/settings',
            'secure:hanasand-mobile.auth-token', 'secure:hanasand-mobile.impersonation-token', 'async:hanasand-mobile/settings',
        ])
    })

    it('keeps the FIFO boundary through the public record write before a queued logout', async () => {
        const entered = deferred(), release = deferred()
        beforeAsyncWrite = async (_key, value) => {
            if (JSON.parse(value).userId === 'actor') { entered.resolve(); await release.promise }
        }
        const returning = saveSettings({ ...defaultSettings, userId: 'actor', authToken: 'actor-auth' })
        await entered.promise
        const logout = saveSettings({ ...defaultSettings })
        await Promise.resolve()
        expect(operations).toHaveLength(3)
        release.resolve()
        await Promise.all([returning, logout])
        expect(await loadSettings()).toMatchObject({ userId: '', authToken: '', impersonationToken: '' })
    })

    it('rejects a failed save without releasing a pending sibling secret or poisoning the next save', async () => {
        const entered = deferred(), release = deferred()
        beforeSecureWrite = async (key, value) => {
            if (value === 'failed-auth') throw new Error('Synthetic secure failure')
            if (key === 'hanasand-mobile.impersonation-token' && value === 'old-delegation') {
                entered.resolve(); await release.promise
            }
        }
        const failed = saveSettings({ ...defaultSettings, userId: 'old', authToken: 'failed-auth', impersonationToken: 'old-delegation' })
        const rejected = failed.then(() => null, error => error as Error)
        await entered.promise
        const newer = saveSettings({ ...defaultSettings, userId: 'new', authToken: 'new-auth' })
        await Promise.resolve()
        expect(operations).toHaveLength(2)
        release.resolve()
        expect((await rejected)?.message).toBe('Synthetic secure failure')
        await newer
        expect(operations.filter(value => value.startsWith('async:'))).toHaveLength(1)
        expect(await loadSettings()).toMatchObject({ userId: 'new', authToken: 'new-auth', impersonationToken: '' })
    })

    it('rejects a failed public write and still persists a later save', async () => {
        beforeAsyncWrite = async (_key, value) => {
            if (JSON.parse(value).userId === 'failed') throw new Error('Synthetic public failure')
        }
        const failed = saveSettings({ ...defaultSettings, userId: 'failed', authToken: 'old-auth' })
        const rejected = failed.then(() => null, error => error as Error)
        const newer = saveSettings({ ...defaultSettings, userId: 'new', authToken: 'new-auth' })
        expect((await rejected)?.message).toBe('Synthetic public failure')
        await newer
        expect(await loadSettings()).toMatchObject({ userId: 'new', authToken: 'new-auth' })
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
