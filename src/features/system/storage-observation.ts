import type { Storage } from './model'
// Retain figures for reading while making failed or changed observations unusable for cleanup.
export class StorageObservation {
    revision = 0
    private available = false
    private value: Storage | null = null
    observe(value: Storage) { this.revision++; this.available = true; this.value = value }
    unavailable() { this.revision++; this.available = false }
    current(revision: number, now = Date.now()) {
        const value = this.value
        if (!this.available || revision !== this.revision || !value) return null
        const age = now - Date.parse(value.checkedAt)
        return value.stale || value.running || value.queued || !!value.error || !Number.isFinite(age) || age < -5000 || age > 900000 ? null : value
    }
}
