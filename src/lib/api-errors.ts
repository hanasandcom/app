function stringValue(value: unknown) {
    return typeof value === 'string' ? value : ''
}

export class PendingDeletionError extends Error {
    id: string
    deletionScheduledAt: string
    restoreToken: string

    constructor(payload: Record<string, unknown>) {
        super(stringValue(payload.error) || 'Account pending deletion.')
        this.name = 'PendingDeletionError'
        this.id = stringValue(payload.id)
        this.deletionScheduledAt = stringValue(payload.deletion_scheduled_at)
        this.restoreToken = stringValue(payload.restore_token)
    }
}

export class AuthenticationError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'AuthenticationError'
    }
}
