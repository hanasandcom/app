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
import { loadActorProfiles, loadDeliveryHealth } from '../src/lib/intelligence'
import { loadGalleryAlbumImage } from '../src/lib/gallery-albums'
import { siteNavigation, workspacePageDefinition, type SiteNavigationItem } from '../src/data/site-navigation'
import { fetchWorkspaceSection, workspaceRequestUrl, workspaceRows } from '../src/screens/WorkspacePageScreen'


// Record only known operational categories, never arbitrary response messages.
function logFailureCategory(name: string, error: unknown) {
    if (process.env.EXPO_PUBLIC_PROBE_LOG_FAILURES !== '1' || !/^menu:\/logs(?::|\/)/.test(name) || !(error instanceof Error)) return undefined
    const categories: Record<string, string> = {
        'Search took too long. Narrow the time range or add a service filter.': 'database-query-timeout',
        'Log searches are busy. Please retry shortly.': 'database-search-capacity',
        'The backend service did not respond in time. Try again shortly; the dashboard is still available.': 'website-upstream-timeout',
        'The backend service is unavailable right now. Try again shortly.': 'website-upstream-transport',
        'Log snapshot is unavailable. Please retry shortly.': 'database-snapshot-unavailable',
    }
    return categories[error.message] || 'unclassified-log-failure'
}

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
            const nativeFetch = globalThis.fetch
            let requests: Array<{ method: string; endpoint: string; status: number | null }> = []
            globalThis.fetch = Object.assign(async (...args: Parameters<typeof nativeFetch>) => {
                const [input, init] = args
                const bucket = requests
                const target = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
                const url = new URL(target)
                const ids = new Set([settings.userId, settings.impersonatingUserId, settings.selectedOrganizationId].filter(id => id && id !== 'personal'))
                const segments = url.pathname.split('/')
                const path = segments.map((segment, index) => ids.has(decodeURIComponent(segment)) ? ':account' : segments[index - 1] === 'files' && segment !== 'user' ? ':file' : segment).join('/')
                const entry = { method: (init?.method || (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase(), endpoint: `${url.origin}${path}`, status: null as number | null }
                bucket.push(entry)
                const response = await nativeFetch(...args)
                entry.status = response.status
                return response
            }, nativeFetch)
            try {
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
                    ['image-bytes', async () => {
                        const page = await loadGalleryPage(settings, { search: '', favorites: false, albumId: '' }, 0)
                        const sample = page.files.slice(0, 3)
                        await Promise.all(sample.map(file => loadGalleryAlbumImage(settings, file.id, true, signal())))
                        return { count: sample.length }
                    }],
                    ['albums', () => loadGalleryAlbums(settings).then(rows => ({ count: rows.length }))],
                    ['cron', () => loadWorkspaceCronJobs(settings).then(row => ({ count: row.jobs.length, ready: row.ready }))],
                    ['health-checks', () => fetchAutomationOverview(settings).then(row => ({ count: row.automations.length }))],
                    ['profile-stats', () => fetchProfileStats(settings).then(() => ({}))],
                    ['subscription', () => loadAccountSubscription(settings, signal()).then(() => ({}))],
                    ['hosts', () => loadHostAccess(settings, signal()).then(row => ({ count: row.hosts.length }))],
                    ['updates-inspur', () => loadHostUpdates(settings, 'inspur', signal()).then(() => ({}))],
                    ['updates-ovh', () => loadHostUpdates(settings, 'ovhcloud', signal()).then(() => ({}))],
                    ['actor-profiles', () => loadActorProfiles(settings, { query: '', page: 1 }, signal()).then(row => ({ count: row.items.length, total: row.total }))],
                    ['delivery-health', () => loadDeliveryHealth(settings, { scope: 'global', tenantId: '', status: '', query: '' }, null, signal()).then(row => ({ count: row.items.length, total: row.total }))],
                    ['status', async () => { const response = await fetch('https://status.hanasand.com/api/status?dashboard=true', { signal: signal(), credentials: 'omit' }); const row = await response.json(); if (!response.ok) throw new Error(`HTTP ${response.status}`); return { count: row.checks?.length, monitoring: row.monitoring } }],
                ]
                if (process.env.EXPO_PUBLIC_PROBE_MENU === '1') {
                    const leaves = (items: SiteNavigationItem[]): SiteNavigationItem[] => items.flatMap(item => item.items ? leaves(item.items) : [item])
                    const visited = new Set<string>()
                    for (const item of leaves(siteNavigation(settings.userId))) {
                        if (item.tab || !item.path) continue
                        const page = workspacePageDefinition(item.path)
                        if (!page) continue
                        if (page.requiresOrganization && (!settings.selectedOrganizationId || settings.selectedOrganizationId === 'personal')) {
                            report.checks.push({ name: `menu:${item.path}`, ok: false, error: 'Organization workspace required; not run' })
                            continue
                        }
                        for (const section of page.sections) {
                            const url = workspaceRequestUrl(settings, section)
                            if (visited.has(url)) continue
                            visited.add(url)
                            jobs.push([`menu:${item.path}:${section.label}`, async () => {
                                const payload = await fetchWorkspaceSection(settings, section, signal())
                                return { count: workspaceRows(payload, section).length }
                            }])
                        }
                    }
                }
                for (const [name, run] of jobs) {
                    const start = Date.now()
                    requests = []
                    try { report.checks.push({ name, ok: true, result: await run(), requests, ms: Date.now() - start }) }
                    catch (error) { report.checks.push({ name, ok: false, error: error instanceof Error ? (/unauthorized/i.test(error.message) ? 'Unauthorized' : /(?:HTTP|Request failed)\s*\(?[45]\d\d/i.exec(error.message)?.[0] || (/timed? ?out|abort/i.test(error.message) ? 'Timeout' : 'Service or response validation failed')) : 'Request failed', requests, failureCategory: logFailureCategory(name, error), ms: Date.now() - start }) }
                    save()
                }
            } finally { globalThis.fetch = nativeFetch }
        }
    } catch { report.session = 'secure-storage-unavailable' }
    report.complete = true
    save()
})()
