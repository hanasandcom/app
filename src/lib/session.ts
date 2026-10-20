import { AuthenticationError, PendingDeletionError } from './api-errors'

export type RefreshFailureDisposition = 'retain-session' | 'clear-session' | 'pending-deletion'

export function classifyRefreshFailure(error: unknown): RefreshFailureDisposition {
    if (error instanceof PendingDeletionError) return 'pending-deletion'
    if (error instanceof AuthenticationError) return 'clear-session'
    return 'retain-session'
}
