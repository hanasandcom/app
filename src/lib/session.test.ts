import { describe, expect, it } from 'bun:test'
import { AuthenticationError, PendingDeletionError } from './api-errors'
import { classifyRefreshFailure, sameSettingsSession, SessionTransition } from './session'
import type { AppSettings } from '../types'

describe('session refresh failures', () => {
    it('clears a cached session only for explicit authentication rejection', () => {
        expect(classifyRefreshFailure(new AuthenticationError('Unauthorized'))).toBe('clear-session')
    })

    it('keeps the pending-deletion recovery path distinct', () => {
        expect(classifyRefreshFailure(new PendingDeletionError({ id: 'user-1', restore_token: 'restore' }))).toBe('pending-deletion')
    })

    it('retains a cached session for network, server, and malformed-response errors', () => {
        expect(classifyRefreshFailure(new TypeError('Network request failed'))).toBe('retain-session')
        expect(classifyRefreshFailure(new Error('Request failed with HTTP 503.'))).toBe('retain-session')
        expect(classifyRefreshFailure(new Error('Unable to sign in.'))).toBe('retain-session')
    })
})

const account = { apiBaseUrl: 'https://api.synthetic.invalid/api', siteBaseUrl: 'https://synthetic.invalid', userId: 'synthetic-user', authToken: 'synthetic-token', impersonationToken: '', impersonatingUserId: '' } as AppSettings

describe('session transition authority', () => {
    it('blocks old and newly rendered settings callbacks while logout persistence is pending', async () => {
        const guard = new SessionTransition(), originalRender = guard.version
        let current = account, durable = account, preferenceWrites = 0
        const intent = guard.begin(originalRender, account, current)!
        let finishPersistence: () => void = () => {}
        const held = new Promise<void>(resolve => { finishPersistence = resolve })
        const logout = (async () => {
            await held
            durable = { ...account, authToken: '', userId: '' }; current = durable
            guard.finish(intent)
        })()
        const savePreference = (renderVersion: number) => {
            if (!guard.current(renderVersion, account, current)) return false
            preferenceWrites++; durable = { ...account, selectedOrganizationId: 'stale-org' }; return true
        }
        expect(savePreference(originalRender)).toBe(false)
        expect(savePreference(guard.version)).toBe(false)
        expect(guard.begin(guard.version, account, current)).toBeNull()
        finishPersistence(); await logout
        expect(savePreference(originalRender)).toBe(false)
        expect(savePreference(guard.version)).toBe(false)
        expect(preferenceWrites).toBe(0)
        expect(durable.authToken).toBe('')
        expect(guard.current(guard.version, current, current)).toBe(true)
    })

    it('rejects a previously started preference completion after a session transition starts', () => {
        const guard = new SessionTransition(), renderVersion = guard.version
        expect(guard.current(renderVersion, account, account)).toBe(true)
        const intent = guard.begin(renderVersion, account, account)!
        expect(guard.current(renderVersion, account, account)).toBe(false)
        expect(guard.finish(intent + 1)).toBe(false)
        expect(guard.current(guard.version, account, account)).toBe(false)
        expect(guard.finish(intent)).toBe(true)
        expect(guard.finish(intent)).toBe(false)
        expect(guard.current(renderVersion, account, account)).toBe(false)
        expect(guard.current(guard.version, account, account)).toBe(true)
    })

    it('keeps a failed transition retryable from a new render without reviving its old callbacks', () => {
        const guard = new SessionTransition(), oldRender = guard.version
        const intent = guard.begin(oldRender, account, account)!
        // The same finish path is used when persistence rejects; credentials remain unchanged.
        expect(guard.finish(intent)).toBe(true)
        expect(guard.begin(oldRender, account, account)).toBeNull()
        expect(guard.begin(guard.version, account, account)).not.toBeNull()
    })

    it('binds callbacks to the exact service and account, independently of workspace preferences', () => {
        expect(sameSettingsSession(null, account)).toBe(false)
        expect(sameSettingsSession(account, null)).toBe(false)
        expect(sameSettingsSession(account, { ...account, selectedOrganizationId: 'different-org' })).toBe(true)
        for (const changed of [{ apiBaseUrl: 'https://other.synthetic.invalid/api' }, { siteBaseUrl: 'https://other.synthetic.invalid' }, { userId: 'other' }, { authToken: 'rotated' }, { impersonationToken: 'delegated' }, { impersonatingUserId: 'other' }]) {
            expect(sameSettingsSession(account, { ...account, ...changed })).toBe(false)
        }
    })

    it('keeps the latest workspace/preferences when a same-session transition is confirmed later', () => {
        const guard = new SessionTransition(), renderVersion = guard.version
        const latest = { ...account, selectedOrganizationId: 'current-org', themeMode: 'light' as const }
        expect(guard.begin(renderVersion, account, latest)).not.toBeNull()
        const logout = { ...latest, authToken: '', userId: '' }
        expect(logout.selectedOrganizationId).toBe('current-org')
        expect(logout.themeMode).toBe('light')
        expect(guard.current(renderVersion, account, latest)).toBe(false)
    })

    it('binds actual App settings, organization discovery, login, logout and Return callbacks', async () => {
        const app = await Bun.file(new URL('../App.tsx', import.meta.url)).text()
        expect(app).toContain('const sessionTransition = useRef(new SessionTransition()).current')
        expect(app.match(/sessionTransition.begin\(sessionIntentVersion, settings, currentSettings.current\)/g)).toHaveLength(2)
        expect(app.match(/sessionTransition.finish\(intent\)/g)).toHaveLength(2)
        expect(app).toContain('await saveSettings(safe, saveRevision)')
        expect(app).toContain('authToken: current.authToken, userId: current.userId')
        expect(app).toContain('selectedOrganizationId: workspaceId ?? current.selectedOrganizationId')
        expect(app).toContain('await handleSaveSettings(settings, id || \'personal\')')
        expect(app).toContain('key={JSON.stringify([sessionIntentVersion, settings.apiBaseUrl')
        expect(app).toContain('if (settingsWriteRevision() !== saveRevision) return')
        expect(app).toContain('if (!sessionTransition.current(sessionIntentVersion, settings, before)')
        expect(app).toContain('onPendingDeletion={handlePendingDeletion}')
        expect(app).toContain('onBack={handlePendingDeletion}')
        expect(app).toContain('try { await clearSession(deletion) }')
        expect(app).toContain('onRestored={handleAuthenticated}')
        expect(app).toContain('const applied = { ...currentSettings.current!, themeMode }')
        expect(app.match(/\.\.\.currentSettings.current!/g)).toHaveLength(4)
        expect(app).toContain('await saveSettings(next)\n            setPendingDeletion(deletion)')
    })
})
