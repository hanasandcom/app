// Opt-in native integration entry. The normal app entry never imports this file.
import { registerRootComponent } from 'expo'
import { Text } from 'react-native'
import { File, Paths } from 'expo-file-system'
import { loadSettings } from '../src/lib/storage'
import { fetchAiWorkspace } from '../src/lib/ai-workspace'
import { fetchNotes, fetchAutomationOverview, fetchProfileStats } from '../src/lib/api'
import { fetchOrganizations, fetchAccountIdentity, fetchAccountSessions, fetchAccountPasskeys, fetchAccountSshKeys, fetchAccountSupportTickets } from '../src/lib/profile-api'
import { loadMail } from '../src/lib/mail-api'
import { loadGalleryPage, loadGalleryAlbums, loadWorkspaceCronJobs } from '../src/lib/workspace-data'
import { loadAccountSubscription, loadHostAccess, loadHostUpdates } from '../src/lib/account-system-tools'

registerRootComponent(() => <Text>Checking mobile services…</Text>)
void (async () => {
    const report: { source: string; complete: boolean; session?: string; checks: Array<Record<string, unknown>> } = { source: process.env.EXPO_PUBLIC_PROBE_REVISION || 'working-tree', complete: false, checks: [] }
    const output = new File(Paths.cache, 'mobile-runtime-probe.json')
    const save = () => output.write(JSON.stringify(report))
    save()
    try {
        const settings = await loadSettings()
        report.session = settings.authToken && settings.userId ? 'present' : 'missing'
        save()
        if (report.session === 'present') {
            const signal = () => { const controller = new AbortController(); setTimeout(() => controller.abort(), 15000); return controller.signal }
            const jobs: Array<[string, () => Promise<unknown>]> = [
                ['organizations', () => fetchOrganizations(settings).then(rows => ({ count: rows.length }))],
                ['ai-workspace', () => fetchAiWorkspace(settings).then(rows => ({ count: rows.length }))],
                ['profile', () => fetchAccountIdentity(settings).then(() => ({}))],
                ['sessions', () => fetchAccountSessions(settings).then(rows => ({ count: rows.length }))],
                ['passkeys', () => fetchAccountPasskeys(settings).then(rows => ({ count: rows.length }))],
                ['ssh-keys', () => fetchAccountSshKeys(settings).then(rows => ({ count: rows.length }))],
                ['support-tickets', () => fetchAccountSupportTickets(settings).then(rows => ({ count: rows.length }))],
                ['mail', () => loadMail(settings, {}).then(row => ({ accounts: row.accessibleAccounts.length, mailboxes: row.mailboxes.length }))],
                ['notes', () => fetchNotes(settings).then(rows => ({ count: rows.length }))],
                ['images', () => loadGalleryPage(settings, { search: '', favorites: false, albumId: '' }, 0).then(row => ({ count: row.files.length }))],
                ['albums', () => loadGalleryAlbums(settings).then(rows => ({ count: rows.length }))],
                ['cron', () => loadWorkspaceCronJobs(settings).then(row => ({ count: row.jobs.length, ready: row.ready }))],
                ['health-checks', () => fetchAutomationOverview(settings).then(row => ({ count: row.automations.length }))],
                ['profile-stats', () => fetchProfileStats(settings).then(() => ({}))],
                ['subscription', () => loadAccountSubscription(settings, signal()).then(() => ({}))],
                ['hosts', () => loadHostAccess(settings, signal()).then(row => ({ count: row.hosts.length }))],
                ['updates-inspur', () => loadHostUpdates(settings, 'inspur', signal()).then(() => ({}))],
                ['updates-ovh', () => loadHostUpdates(settings, 'ovhcloud', signal()).then(() => ({}))],
                ['status', async () => { const response = await fetch('https://status.hanasand.com/api/status?dashboard=true', { signal: signal(), credentials: 'omit' }); const row = await response.json(); if (!response.ok) throw new Error(`HTTP ${response.status}`); return { count: row.checks?.length, monitoring: row.monitoring } }],
            ]
            for (const [name, run] of jobs) {
                const start = Date.now()
                try { report.checks.push({ name, ok: true, result: await run(), ms: Date.now() - start }) }
                catch (error) { report.checks.push({ name, ok: false, error: error instanceof Error ? (/unauthorized/i.test(error.message) ? 'Unauthorized' : /(?:HTTP|Request failed)\s*\(?[45]\d\d/i.exec(error.message)?.[0] || (/timed? ?out|abort/i.test(error.message) ? 'Timeout' : 'Service or response validation failed')) : 'Request failed', ms: Date.now() - start }) }
                save()
            }
        }
    } catch { report.session = 'secure-storage-unavailable' }
    report.complete = true
    save()
})()
