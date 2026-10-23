import { beforeEach, expect, mock, test } from 'bun:test'
import type { AppSettings } from '../types'
import type { BackupDashboard, BackupAction, BackupOperation } from './database-operations'
const calls: Array<{ settings: AppSettings; url: URL; init: RequestInit }> = []
let handle: (url: URL, init: RequestInit) => Response | Promise<Response>
mock.module('./api', () => ({ apiFetch: async (settings: AppSettings, input: string, init: RequestInit) => { const url = new URL(input); calls.push({ settings, url, init }); return handle(url, init) } }))
const api = await import('./database-operations')
const settings = { apiBaseUrl: 'https://api.hanasand.com/api', userId: 'synthetic', authToken: 'synthetic-token', selectedOrganizationId: 'cashflow', impersonationToken: '', impersonatingUserId: '' } as AppSettings
const access = () => ({ scope: api.databaseScope(settings), canRead: true, canWrite: true })
const dashboard = { backups: [{ id: 'core', name: 'Core', database: 'core', status: 'Available', operations: [] }], files: [{ service: 'core', file: 'core.dump', verified: true }], errors: [] } satisfies BackupDashboard
const draft = (action: BackupAction) => ({ action, file: 'core.dump', targetDatabase: 'restore_drill_synthetic', confirmation: '' })
beforeEach(() => { calls.length = 0; handle = url => Response.json(url.pathname.endsWith('/db') ? { status: 'healthy', generatedAt: 'synthetic', queries: [], health: { message: 'Synthetic' } } : { allowed: true, canEdit: true }) })

test('global editing authority comes from Identity lifecycle-aware internal pages proof, not selected workspace', async () => {
    expect((await api.loadDatabaseAccess(settings)).canWrite).toBe(true)
    expect(calls[0].url.toString()).toBe('https://identity.hanasand.com/api/management/organizations?internalPages=1')
    for (const payload of [{ allowed: true, canEdit: false }, { allowed: false, canEdit: true }, {}, { canEdit: 'true', allowed: true }]) {
        handle = () => Response.json(payload)
        expect((await api.loadDatabaseAccess(settings)).canWrite).toBe(false)
    }
})
test('both impersonation states and stale session/workspace proof prohibit writes before transport', async () => {
    for (const changed of [{ impersonationToken: 'synthetic' }, { impersonatingUserId: 'synthetic' }, { selectedOrganizationId: 'different' }, { authToken: 'different' }]) {
        await expect(api.executeDatabaseSql({ ...settings, ...changed }, access(), 'select 1')).rejects.toThrow('read-only')
    }
    expect(calls).toHaveLength(0)
})
test('database summary, full queries and health use exact existing endpoints without writes', async () => {
    await api.loadDatabaseOverview(settings); await api.loadDatabaseOverview(settings, undefined, true); await api.loadDatabaseHealth(settings)
    expect(calls.map(call => call.url.pathname + call.url.search)).toEqual(['/api/db?summary=1', '/api/db', '/api/db/health'])
    expect(calls.every(call => call.init.method === 'GET' && call.init.body === undefined && call.init.cache === 'no-store')).toBe(true)
})
test('inventory cursor/table selection is encoded and never changes SQL target', async () => {
    await api.browseDatabase(settings, { instance: 'pg/one', database: 'other db', mode: 'rows', schema: 'public', table: 'data&x', cursor: 'opaque+/?' })
    expect(calls[0].url.searchParams.get('cursor')).toBe('opaque+/?')
    expect(calls[0].url.searchParams.get('table')).toBe('data&x')
    handle = () => Response.json({ rows: [], fields: [], rowCount: 0 })
    await api.executeDatabaseSql(settings, access(), ' DELETE FROM synthetic; ')
    expect(calls[1].url.pathname).toBe('/api/db/query')
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ sql: 'DELETE FROM synthetic;' })
    expect(calls).toHaveLength(2)
})
test('all backup operations use canonical payloads and exact restore confirmations', async () => {
    handle = () => Response.json({ message: 'Synthetic only', operation: { id: 'synthetic', status: 'succeeded' } })
    for (const action of ['backup', 'verify', 'delete', 'restore', 'restore-live'] as const) {
        const input = { ...draft(action), confirmation: action === 'restore' ? 'RESTORE restore_drill_synthetic' : action === 'restore-live' ? 'RESTORE core' : '' }
        await api.performBackupAction(settings, access(), dashboard, input)
    }
    expect(calls.map(call => call.url.pathname)).toEqual(['/api/backup', '/api/backup/verify', '/api/backup/delete', '/api/backup/restore', '/api/backup/restore-live'])
    expect(JSON.parse(String(calls[0].init.body))).toEqual({})
    expect(JSON.parse(String(calls[3].init.body))).toEqual({ file: 'core.dump', targetDatabase: 'restore_drill_synthetic', confirmation: 'RESTORE restore_drill_synthetic' })
})
test('unknown archive, wrong confirmation, live drill target and running operations never submit', async () => {
    for (const input of [{ ...draft('delete'), file: '../not-listed' }, draft('restore'), { ...draft('restore'), targetDatabase: 'core', confirmation: 'RESTORE core' }, draft('restore-live')]) {
        await expect(api.performBackupAction(settings, access(), dashboard, input)).rejects.toThrow()
    }
    expect(() => api.validateBackupDraft(draft('backup'), { ...dashboard, backups: [{ ...dashboard.backups[0], currentOperation: { id: 'running' } as BackupOperation }] })).toThrow('running')
    expect(calls).toHaveLength(0)
})
test('transport errors and malformed success are uncertain; no automatic write retry', async () => {
    handle = async () => { throw new Error('Synthetic network failure') }
    try { await api.executeDatabaseSql(settings, access(), 'select 1') } catch (cause) { expect(cause).toBeInstanceOf(api.DatabaseError); expect((cause as InstanceType<typeof api.DatabaseError>).uncertain).toBe(true) }
    expect(calls).toHaveLength(1)
    handle = () => Response.json({})
    await expect(api.performBackupAction(settings, access(), dashboard, draft('backup'))).rejects.toThrow('not be confirmed')
    expect(calls).toHaveLength(2)
})
test('error bodies cannot echo raw SQL, credentials or service internals', async () => {
    handle = () => Response.json({ message: 'postgres://user:secret@synthetic.invalid DELETE synthetic' }, { status: 503 })
    try { await api.executeDatabaseSql(settings, access(), 'select 1') } catch (cause) { expect(String(cause)).not.toContain('secret'); expect((cause as InstanceType<typeof api.DatabaseError>).uncertain).toBe(true) }
})
test('pre-aborted and insecure requests do not reach transport; no RN AbortSignal static helpers', async () => {
    const cancel = new AbortController(); cancel.abort()
    await expect(api.loadBackupDashboard(settings, cancel.signal)).rejects.toThrow('cancelled')
    await expect(api.loadBackupDashboard({ ...settings, apiBaseUrl: 'http://synthetic.invalid/api' })).rejects.toThrow('secure')
    expect(calls).toHaveLength(0)
})
test('archive filters preserve server entries and combine service/date/search', () => {
    const files = [{ ...dashboard.files[0], mtime: '2026-10-23T00:00:00Z' }, { service: 'other', file: 'other.dump', verified: false }]
    expect(api.filterBackupFiles(files, 'core', '2026-10-23', 'CORE')).toEqual([files[0]])
    expect(api.filterBackupFiles(files, 'core', '', 'missing')).toEqual([])
})

test('even rejected SQL responses require review, and invalid read contracts fail closed', async () => {
    handle = () => Response.json({ message: 'Synthetic statement error' }, { status: 400 })
    try { await api.executeDatabaseSql(settings, access(), 'select 1; invalid') } catch (cause) { expect((cause as InstanceType<typeof api.DatabaseError>).uncertain).toBe(true) }
    handle = () => Response.json({})
    await expect(api.loadDatabaseOverview(settings)).rejects.toThrow('invalid')
    await expect(api.loadBackupDashboard(settings)).rejects.toThrow('invalid')
    expect(() => api.validateBackupDraft(draft('backup'), { ...dashboard, errors: ['Partial status'] })).toThrow('resolve')
})
test('cancel propagates into pending transport without a second attempt', async () => {
    handle = (_url, init) => new Promise((_resolve, reject) => { init.signal?.addEventListener('abort', () => reject(new Error('Synthetic cancellation')), { once: true }) })
    const cancel = new AbortController(), request = api.executeDatabaseSql(settings, access(), 'select 1', cancel.signal)
    cancel.abort()
    try { await request } catch (cause) { expect((cause as InstanceType<typeof api.DatabaseError>).uncertain).toBe(true) }
    expect(calls).toHaveLength(1)
    expect(calls[0].init.signal?.aborted).toBe(true)
})
test('screen guards bind reviewed actions to live focus, account and foreground epochs', async () => {
    // Source wiring checks complement the helper tests; native interaction is verified separately.
    for (const name of ['DatabaseScreen', 'BackupsScreen']) {
        const source = await Bun.file(new URL(`../screens/${name}.tsx`, import.meta.url)).text()
        expect(source).toContain('key={databaseScope(settings)}')
        expect(source).toContain('state !== \'active\'')
        expect(source).toContain('reviewed !== epoch.current')
        expect(source).toContain('controller.current?.abort()')
        expect(source).toContain('if (writing.current) return')
        expect(source).toContain('setAccess(null)')
    }
    for (const name of ['DatabaseQuery', 'BackupActions']) {
        const source = await Bun.file(new URL(`../components/${name}.tsx`, import.meta.url)).text()
        expect(source).toContain('latest.current.reviewEpoch !== snapshot.reviewEpoch')
        expect(source).toContain('Alert.alert(')
    }
})

test('legacy Core table row job keeps fixed target and identifier/limit contract', async () => {
    await api.loadCoreDatabaseRows(settings, 'public', 'synthetic', 50)
    expect(calls[0].url.pathname).toBe('/api/db/rows')
    expect(calls[0].url.searchParams.get('limit')).toBe('50')
    expect(calls[0].init.method).toBe('GET')
    for (const [schema, table, limit] of [['public', 'x;drop', 50], ['bad-schema', 'x', 50], ['public', 'x', 501], ['public', 'x', 0]] as const) expect(() => api.loadCoreDatabaseRows(settings, schema, table, limit)).toThrow()
    expect(calls).toHaveLength(1)
})
