import { describe, expect, it } from 'bun:test'
import { AuthenticationError, PendingDeletionError } from './api'
import { classifyRefreshFailure } from './session'

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
