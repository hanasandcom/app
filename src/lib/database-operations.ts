import type { AppSettings } from '../types'
import { apiFetch } from './api'
import { organizationListBase } from './organization-endpoint'

export type DatabaseAccess = { scope: string; canRead: boolean; canWrite: boolean }
export type DatabaseItem = { schema: string; name: string; sizeBytes?: number | null; estimatedRows?: number | null; columns?: string[]; type?: string; lastWriteObservedAt?: string | null }
export type DatabaseChoice = { name: string; sizeBytes: number | null; connections?: number | null; tableCount?: number | null; tables?: DatabaseItem[] }
export type DatabaseInstance = { id: string; engine: string; status: string; databases: DatabaseChoice[] }
export type QueryActivity = { database: string | null; user: string | null; state: string | null; durationSeconds: number | null; query: string | null; isLongRunning: boolean }
export type DatabaseOverview = { status: string; generatedAt: string; activeQueries: number | null; totalSizeBytes: number | null; health: { message: string }; queries: QueryActivity[]; querySummary?: { count: number; longRunningCount: number; longestDurationSeconds: number | null }; storage?: { sampledAt: string; stale?: boolean; host: string; disk: { totalBytes: number; availableBytes: number; dailyGrowthBytes: number | null; daysUntilFull: number | null }; instances: DatabaseInstance[] } | null }
export type DatabasePage = { items?: DatabaseItem[]; rows?: Record<string, unknown>[]; fields?: string[]; nextCursor: string | null; totalRows?: number | null; elapsedMs?: number }
export type SqlResult = { rows: Record<string, unknown>[]; fields: string[]; rowCount: number }
export type BackupRetention = { policyDays: number; examined: number; deleted: number; deletedBytes: number; cutoffAt: string }
export type BackupOperation = { id: string; kind: string; trigger: string; actorId: string; status: string; stage: string; startedAt: string; finishedAt: string | null; durationMs: number | null; file: string | null; targetDatabase: string | null; checksumSha256: string | null; sizeBytes: number | null; archiveEntries: number | null; sourceIntegrity: { schemas: number; tables: number; estimatedRows: number } | null; restoredIntegrity: { schemas: number; tables: number; estimatedRows: number } | null; targetRemoved: boolean | null; retention?: BackupRetention | null; error: string | null; releaseCommit: string | null }
export type BackupFile = { service: string; file: string; mtime?: string | null; size?: string; sizeBytes?: number; verified: boolean; checksumSha256?: string | null; verifiedAt?: string | null; releaseCommit?: string | null }
export type BackupService = { id: string; name: string; database?: string; status: string; error?: string | null; lastAttempt?: string | null; lastSuccess?: string | null; lastFailure?: string | null; lastError?: string | null; nextBackup?: string | null; schedule?: string; scheduleTimezone?: string; scheduleEnabled?: boolean; retention?: string | null; storageTarget?: string | null; latestFile?: string | null; latestSize?: string | null; latestDuration?: string | null; retentionOutcome?: BackupRetention | null; latestChecksum?: string | null; latestVerifiedAt?: string | null; releaseCommit?: string | null; currentOperation?: BackupOperation | null; operations: BackupOperation[] }
export type BackupDashboard = { backups: BackupService[]; files: BackupFile[]; errors: string[] }
export type BackupAction = 'backup' | 'verify' | 'delete' | 'restore' | 'restore-live'
export type BackupDraft = { action: BackupAction; file: string; targetDatabase: string; confirmation: string }
export class DatabaseError extends Error {
    constructor(message: string, readonly uncertain = false, readonly status = 0) { super(message) }
}
// Memory-only identity key. Never persist this key or database results.
export function databaseScope(settings: AppSettings) { return JSON.stringify([settings.apiBaseUrl, settings.userId, settings.authToken, settings.selectedOrganizationId, settings.impersonationToken, settings.impersonatingUserId]) }
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
function url(base: string, path: string) {
    const parsed = new URL(base)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new DatabaseError('Use a secure API address.')
    return `${base.replace(/\/+$/, '')}/${path}`
}
async function request<T>(settings: AppSettings, path: string, signal?: AbortSignal, body?: unknown, base = settings.apiBaseUrl): Promise<T> {
    if (!settings.userId || !settings.authToken) throw new DatabaseError('Sign in to use database operations.')
    const endpoint = url(base, path), writing = body !== undefined
    const controller = new AbortController(), cancel = () => controller.abort()
    const timer = setTimeout(cancel, writing ? 30 * 60 * 1000 : 20000)
    if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true })
    try {
        if (controller.signal.aborted) throw new DatabaseError('Request cancelled.')
        const response = await apiFetch(settings, endpoint, { method: writing ? 'POST' : 'GET', body: writing ? JSON.stringify(body) : undefined, signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json', 'Content-Type': 'application/json' } })
        const payload: unknown = await response.json().catch(() => null)
        if (!response.ok) throw new DatabaseError(response.status === 403 ? 'Active Hanasand membership is required; changes require owner, administrator or editor access.' : response.status === 401 ? 'Your session could not be verified. Sign in again.' : `Database service request failed (${response.status}). Refresh and review its status.`, writing, response.status)
        if (payload === null) throw new DatabaseError('The result was not confirmed. Refresh and review before trying again.', writing)
        return payload as T
    } catch (cause) {
        if (cause instanceof DatabaseError) throw cause
        throw new DatabaseError(writing ? 'The operation outcome is unknown. Refresh and review the operation history before trying again.' : 'Database information is unavailable. Refresh to try again.', writing)
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel) }
}
export async function loadDatabaseAccess(settings: AppSettings, signal?: AbortSignal): Promise<DatabaseAccess> {
    const result = object(await request(settings, 'management/organizations?internalPages=1', signal, undefined, organizationListBase(settings)))
    return { scope: databaseScope(settings), canRead: result.allowed === true, canWrite: result.allowed === true && result.canEdit === true && !settings.impersonationToken && !settings.impersonatingUserId }
}
export function requireDatabaseWriter(settings: AppSettings, access: DatabaseAccess) {
    if (access.scope !== databaseScope(settings) || !access.canRead || !access.canWrite || settings.impersonationToken || settings.impersonatingUserId) throw new DatabaseError('This session is read-only. Refresh and verify Hanasand editing access.')
}
export async function loadDatabaseOverview(settings: AppSettings, signal?: AbortSignal, full = false) {
    const result = await request<DatabaseOverview>(settings, full ? 'db' : 'db?summary=1', signal)
    if (!result || !Array.isArray(result.queries) || !result.health || typeof result.health.message !== 'string' || result.storage && (!Array.isArray(result.storage.instances) || !result.storage.disk || result.storage.instances.some(instance => !Array.isArray(instance.databases)))) throw new DatabaseError('Database overview is invalid. Refresh to try again.')
    return result
}
export const loadDatabaseHealth = (settings: AppSettings, signal?: AbortSignal) => request<{ ok: boolean; database?: string; checked_at?: string }>(settings, 'db/health', signal)
export function browseDatabase(settings: AppSettings, selection: { instance: string; database: string; mode: 'contents' | 'rows' | 'count'; schema?: string; table?: string; cursor?: string }, signal?: AbortSignal) {
    if (!selection.instance || !selection.database || !['contents', 'rows', 'count'].includes(selection.mode)) throw new DatabaseError('Choose a database from the current inventory.')
    return request<DatabasePage>(settings, `db/browse?${new URLSearchParams(selection)}`, signal)
}
export function loadCoreDatabaseRows(settings: AppSettings, schema: string, table: string, limit: number, signal?: AbortSignal) {
    if (![schema, table].every(value => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) || !Number.isInteger(limit) || limit < 1 || limit > 500) throw new DatabaseError('Enter valid Core schema and table identifiers and a row limit from 1 to 500.')
    return request<SqlResult>(settings, `db/rows?${new URLSearchParams({ schema, table, limit: String(limit) })}`, signal)
}
export async function executeDatabaseSql(settings: AppSettings, access: DatabaseAccess, sql: string, signal?: AbortSignal) {
    requireDatabaseWriter(settings, access)
    if (!sql.trim()) throw new DatabaseError('Enter a SQL statement.')
    const result = await request<SqlResult>(settings, 'db/query', signal, { sql: sql.trim() })
    if (!Array.isArray(result.rows) || !Array.isArray(result.fields) || !Number.isInteger(result.rowCount)) throw new DatabaseError('SQL outcome could not be confirmed. Refresh before executing another statement.', true)
    return result
}
export async function loadBackupDashboard(settings: AppSettings, signal?: AbortSignal) {
    const result = await request<BackupDashboard>(settings, 'backup/dashboard', signal)
    if (!result || !Array.isArray(result.backups) || !Array.isArray(result.files) || !Array.isArray(result.errors) || result.backups.some(service => !Array.isArray(service.operations)) || result.files.some(file => typeof file.file !== 'string' || typeof file.verified !== 'boolean')) throw new DatabaseError('Backup information is invalid. Refresh before submitting an operation.')
    return result
}
export function filterBackupFiles(files: BackupFile[], service: string, date: string, search: string) { return files.filter(file => (!service || file.service === service) && (!date || file.mtime?.startsWith(date) || file.file.includes(date)) && file.file.toLowerCase().includes(search.toLowerCase())) }
export function validateBackupDraft(draft: BackupDraft, dashboard: BackupDashboard) {
    if (!['backup', 'verify', 'delete', 'restore', 'restore-live'].includes(draft.action)) throw new DatabaseError('Choose a supported backup action.')
    if (dashboard.errors.length || !dashboard.backups.length) throw new DatabaseError('Refresh and resolve backup status errors before submitting an operation.')
    if (dashboard.backups.some(service => service.currentOperation)) throw new DatabaseError('Another backup operation is running. Refresh its status.')
    if (draft.action !== 'backup' && !dashboard.files.some(file => file.file === draft.file)) throw new DatabaseError('Select an available archive from the refreshed list.')
    if (draft.action === 'restore') {
        const target = draft.targetDatabase.trim().toLowerCase()
        if (!/^restore_drill_[a-z0-9_]{1,48}$/.test(target) || dashboard.backups.some(service => service.database === target) || draft.confirmation !== `RESTORE ${target}`) throw new DatabaseError('Use an isolated restore_drill_ target and type its exact RESTORE confirmation.')
    }
    if (draft.action === 'restore-live') {
        const database = dashboard.backups[0]?.database
        if (!database || draft.confirmation !== `RESTORE ${database}`) throw new DatabaseError('Type the exact RESTORE confirmation for the live database.')
    }
}
export async function performBackupAction(settings: AppSettings, access: DatabaseAccess, dashboard: BackupDashboard, draft: BackupDraft, signal?: AbortSignal) {
    requireDatabaseWriter(settings, access); validateBackupDraft(draft, dashboard)
    const body = draft.action === 'backup' ? {} : draft.action === 'restore' ? { file: draft.file, targetDatabase: draft.targetDatabase.trim().toLowerCase(), confirmation: draft.confirmation } : draft.action === 'restore-live' ? { file: draft.file, confirmation: draft.confirmation } : { file: draft.file }
    const result = await request<{ message: string; operation: BackupOperation }>(settings, draft.action === 'backup' ? 'backup' : `backup/${draft.action}`, signal, body)
    if (!result.operation?.id || !['succeeded', 'failed', 'interrupted', 'running'].includes(result.operation.status)) throw new DatabaseError('Backup outcome could not be confirmed. Refresh the operation history before trying again.', true)
    return result
}
export function databaseCell(value: unknown) { return value == null ? 'null' : typeof value === 'object' ? JSON.stringify(value) : String(value) }
export function databaseBytes(value?: number | null) { return value == null ? 'Unavailable' : value < 1024 ? `${value} B` : value < 1048576 ? `${(value / 1024).toFixed(1)} KB` : value < 1073741824 ? `${(value / 1048576).toFixed(1)} MB` : `${(value / 1073741824).toFixed(1)} GB` }
