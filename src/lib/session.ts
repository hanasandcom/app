import { AuthenticationError, PendingDeletionError } from './api-errors'
import type { AppSettings } from '../types'

export type RefreshFailureDisposition = 'retain-session' | 'clear-session' | 'pending-deletion'

export function classifyRefreshFailure(error: unknown): RefreshFailureDisposition {
    if (error instanceof PendingDeletionError) return 'pending-deletion'
    if (error instanceof AuthenticationError) return 'clear-session'
    return 'retain-session'
}

export function sameSettingsSession(expected: AppSettings | null, current: AppSettings | null): boolean {
    return !!expected && !!current && expected.apiBaseUrl === current.apiBaseUrl && expected.siteBaseUrl === current.siteBaseUrl
        && expected.userId === current.userId && expected.authToken === current.authToken
        && expected.impersonationToken === current.impersonationToken && expected.impersonatingUserId === current.impersonatingUserId
}

// A render during a pending logout still contains the previous token. Its callbacks
// must not enqueue that token after the logout, even if their render version is new.
export class SessionTransition {
    version = 0
    private pending = false
    current(version: number, expected: AppSettings | null, latest: AppSettings | null): boolean {
        return !this.pending && version === this.version && sameSettingsSession(expected, latest)
    }
    begin(version: number, expected: AppSettings | null, latest: AppSettings | null): number | null {
        if (!this.current(version, expected, latest)) return null
        this.pending = true
        return ++this.version
    }
    finish(version: number): boolean {
        if (!this.pending || version !== this.version) return false
        this.pending = false
        this.version++
        return true
    }
}
