// Opt-in synthetic entry. Normal startup never imports this file.
import { useState } from 'react'
import { Alert, Text, View } from 'react-native'
import { registerRootComponent } from 'expo'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { AppThemeProvider } from '../src/theme/context'
import { PillButton } from '../src/components/ui'
import { UserManagementScreen } from '../src/screens/UserManagementScreen'
import { LoadTestsScreen } from '../src/screens/LoadTestsScreen'
import { OrganizationPrivacyScreen } from '../src/screens/OrganizationPrivacyScreen'
import ArticlesScreen from '../src/screens/ArticlesScreen'
import ThoughtsScreen from '../src/screens/ThoughtsScreen'
import { SystemScreen } from '../src/screens/SystemScreen'
import { CasesScreen } from '../src/screens/CasesScreen'
import { caseServices } from '../src/features/cases/api'
import { VirtualMachinesScreen } from '../src/screens/VirtualMachinesScreen'
import { vmServices, type VmServices } from '../src/features/virtual-machines/services'
import { openVmConsole, type ConsoleSocket } from '../src/features/virtual-machines/console'
import { systemServices, type SystemServices } from '../src/features/system/services'
import { createPublishingApi } from '../src/features/publishing/api'
import * as Crypto from 'expo-crypto'
import type { PrivacyTransport } from '../src/features/privacy/api'
import ThesisScreen from '../src/screens/ThesisScreen'
import { ThesisError, type SourceNode } from '../src/features/thesis/api'
import type { ThesisServices } from '../src/features/thesis/useThesis'
import type { RecoveredDraft } from '../src/features/thesis/recovery'
import { writeSheets } from '../src/features/thesis/workspace'
import type { LoadSocket, LoadSocketTransport } from '../src/lib/load-test-live'
import type { AppSettings } from '../src/types'

const settings = { themeMode: 'obsidian', apiBaseUrl: 'https://api.synthetic.invalid/api', siteBaseUrl: 'https://synthetic.invalid',
    userId: 'synthetic-operator', authToken: 'synthetic-token', selectedOrganizationId: 'fixture-org', impersonationToken: '', impersonatingUserId: '' } as AppSettings
const org = { id: 'fixture-org', name: 'Synthetic team', slug: 'synthetic-team', status: 'active' }
const at = '2026-10-23T07:00:00Z'
const users = Array.from({ length: 36 }, (_, index) => ({ id: index === 0 ? settings.userId : `fixture-user-${index}`, name: index ? `Fixture person ${String(index).padStart(2, '0')}` : 'Fixture operator',
    username: index ? `fixture-person-${index}` : 'fixture-operator', email: `person-${index}@synthetic.invalid`, active: true, avatar: '', created_at: at, last_login_at: at,
    deactivated_at: null as string | null, deactivated_by: null as string | null, organization_memberships: [org], deletion_scheduled_at: null as string | null }))
const tests = [{ id: 'fixture-scan', url: 'https://target.synthetic.invalid/check', status: 'done', timeout: 30,
    stages: [{ duration: '30s', target: 1 }], logs: ['Synthetic run completed.'], errors: [] as string[], created_at: at, started_at: at, finished_at: at,
    exit_code: 0, queue_position: 0, latest_run_number: 2, visits: 3, duration: { seconds: 30 },
    summary: { requests: 32, checks: 32, failures: 0, failureRate: 0, duration: { avg: 23, med: 20, p95: 30, max: 35 },
        rps: [{ time: at, value: 1 }, { time: '2026-10-23T07:00:30Z', value: 1.1 }] },
    previous_run_summary: { requests: 30, duration: { p95: 35 } }, p95_delta_ms: 5 }]
const articles = Array.from({ length: 24 }, (_, index) => ({ id: `fixture-article-${index}.md`, organization_id: org.id, title: `Synthetic article ${index}`, content: `# Synthetic article ${index}\n\n**Public synthetic text**, [a link](https://synthetic.invalid) and a table.\n\n| Topic | State |\n| --- | --- |\n| Native editor | Ready |`, created: at, modified: at, metadata: { wordCount: 20, estimatedMinutes: 1 } }))
const thoughts = Array.from({ length: 24 }, (_, index) => ({ id: index + 1, organization_id: org.id, title: `Synthetic thought ${index}`, created_by: settings.userId, created_at: at }))
const containers = Array.from({ length: 32 }, (_, index) => ({ id: (index + 1).toString(16).padStart(64, '0'), name: `synthetic-container-${index}`, image: 'synthetic/image:fixture', state: 'running', health: 'healthy', restart_count: 0, uptime_seconds: 60, ports: [{ ip: '127.0.0.1', private_port: 8080, public_port: 18080 + index, type: 'tcp' }], stats: { cpu_percent: index, memory_bytes: 1024 * 1024, memory_limit_bytes: 1024 * 1024 * 1024, memory_percent: 0.1 } }))
const caseRepoId = '12345678-abcd-1234-abcd-123456789abc'
const caseRepositories = [{ id: caseRepoId, provider: 'forgejo', repository_url: 'https://git.synthetic.invalid/team/app', organization_id: org.id, can_manage: true }]
const monitoringCases = Array.from({ length: 54 }, (_, index) => ({ id: `HA-${index + 1}`, source: 'monitoring', title: `Synthetic outage ${index + 1}`, summary: 'Synthetic health-check evidence', status: 'open', severity: 'high', canManage: true, organizationId: org.id, automationId: 'fixture-health', notificationsEnabled: true, occurrences: 2, assignedOwner: settings.userId, createdAt: at, updatedAt: at, lastSeenAt: at, comments: [] as Record<string, unknown>[], history: [] as Record<string, unknown>[], resolution: null as Record<string, unknown> | null, notifications: [], relatedChecks: [], currentCheck: { endpoint: 'https://target.synthetic.invalid/health', checkType: 'http' } }))
const virtualMachines: Record<string, unknown>[] = [{ name: 'fixture-vm', owner: settings.userId, organization_id: org.id, organization_name: org.name, status: 'running', primary_host: 'synthetic-host', failover_host: 'synthetic-standby', failover_premium: true, failover_enabled: true, can_assign_organization: false, limits_cpu: '2', limits_memory: '4GiB', device_eth0_ipv4_address: '192.0.2.10', config_image_os: 'ubuntu', config_image_version: '24.04' }]
virtualMachines.push({ name: 'fixture-resume', owner: settings.userId, organization_id: org.id, organization_name: org.name, status: 'error', failover_premium: false, failover_enabled: false, limits_cpu: '4', limits_memory: '8GiB', syntheticMissingDetails: true, deletion_restore: { instanceMissing: true } })
const vmPublicServices = [{ id: 'synthetic-route', name: 'web', type: 'http', port: 3000, hostname: 'web.synthetic.invalid', createdAt: at }]
let cleanupQueued = false
const sampleTime = () => new Date().toISOString()
function systemSnapshot() {
    const sampled = sampleTime()
    return { generated_at: sampled, systemTelemetry: { system: { load: [0, 1, 2], memory: { used: 0, total: 1024 ** 3, percent: 0 } } }, dockerTelemetry: { containers, source: 'synthetic Docker', generated_at: sampled }, vms: [] }
}
function systemStorage() {
    return { cacheBytes: 1024 ** 3, reclaimableCacheBytes: 512 * 1024 ** 2, cacheBudgetBytes: 2 * 1024 ** 3, checkedAt: sampleTime(), lastSuccessAt: at, lastFreedBytes: 0, running: false, queued: cleanupQueued, stale: false, error: '', schedule: '03:00', timezone: 'Europe/Oslo', phase: cleanupQueued ? 'queued' : '', unusedImages: [{ id: 'synthetic-image', names: ['synthetic/image:old'], sizeBytes: 1024 ** 2, eligible: true, retainedReason: '' }] }
}
let hold = false, fail = false, release: (() => void) | undefined
let reportSyntheticRequest: (value: string) => void = () => {}
const sockets = new Set<LoadSocket>()
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
const privacyRuns: Record<string, unknown>[] = [], privacyRequests: Record<string, unknown>[] = []
let privacyDeleted = false
const privacyItems = Array.from({ length: 65 }, (_, index) => ({ id: `fixture-record-${index}`, organization_id: org.id, run_id: 'fixture-run', source_service: 'synthetic', record_type: 'synthetic_record', record_id: `record-${index}`, action: 'retain', status: 'protected', reason: 'Synthetic legal hold', attempt_count: 1, processed_at: at }))
function privacyState(offset = 0, limit = 50) {
    return { schemaVersion: 'organization.privacy_state.v1', organization: { id: org.id, name: org.name, status: privacyDeleted ? 'deleted' : 'active', retention_days: 365 },
        permissions: { canExport: true, canRunRetention: true, canRequestDeletion: true }, runs: privacyRuns.slice(0, 20), requests: privacyRequests.slice(0, 20),
        items: privacyItems.slice(offset, offset + limit), itemPage: { offset, limit, nextOffset: offset + limit < privacyItems.length ? offset + limit : null },
        protection: { protected_events: 65, access_recovery_holds: 1, immutable_system_events: 2, immutable_webhook_audit_events: 3, immutable_log_events: 4, explanation: 'Synthetic protected evidence remains.' } }
}
async function finishWrite(value: unknown, status = 200) {
    if (hold) await new Promise<void>(resolve => { release = resolve })
    return fail ? json({ error: 'Synthetic response lost after the change was saved.' }, 500) : json(value, status)
}
globalThis.fetch = Object.assign(async (...[input, init]: Parameters<typeof fetch>) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (!['https://api.synthetic.invalid', 'https://synthetic.invalid'].includes(url.origin) || url.username || url.password || url.hash) throw new Error('External requests are disabled in this synthetic fixture.')
    const headers = new Headers(init?.headers)
    if (headers.get('authorization') !== 'Bearer synthetic-token' || headers.get('id') !== settings.userId) return json({ error: 'Synthetic actor headers missing.' }, 401)
    const method = init?.method || 'GET', body = init?.body ? JSON.parse(String(init.body)) : {}
    reportSyntheticRequest(`${method.toUpperCase()} ${url.pathname}`)
    if (/^\/api\/vms\/(?:access\/)?synthetic-operator$/.test(url.pathname) && method === 'GET') return json(virtualMachines)
    if (url.pathname === '/api/vms/stop' && method === 'POST') return finishWrite({ success: true, message: 'Synthetic stop requests queued.', vms: virtualMachines.map(item => item.name) })
    if (url.pathname === '/api/billing/container-products' && method === 'GET') return json({ plans: [{ id: 'failover', name: 'Synthetic failover', priceNok: 99, currency: 'NOK', interval: 'month' }], containers: virtualMachines.map(item => ({ name: item.name, failover_premium: item.failover_premium, primary_host: item.primary_host })) })
    if (url.pathname === '/api/billing/container-checkout' && method === 'POST') return finishWrite({ url: 'https://checkout.stripe.com/c/pay/synthetic-only' })
    if (url.pathname === '/api/vm/setup-plan' && method === 'POST') return finishWrite({ summary: 'Synthetic Node setup', services: ['nodejs'], packages: ['git'], website: null, minecraftServerType: null, ...(String(body.prompt).includes('project') ? { projectFiles: [{ path: 'package.json', content: JSON.stringify({ dependencies: { next: 'synthetic', react: 'synthetic', 'react-dom': 'synthetic' }, scripts: { build: 'next build', start: 'next start --hostname 0.0.0.0 --port 3000' } }) }, { path: 'app/page.tsx', content: 'export default function Page() { return <h1>Synthetic project</h1> }' }] } : {}) })
    if (url.pathname === '/api/vm' && method === 'POST') {
        const item = { name: body.name, owner: settings.userId, organization_id: body.organization_id || null, status: 'Stopped', failover_premium: false, can_assign_organization: !body.organization_id }
        const existing = virtualMachines.find(item => item.name === body.name)
        if (existing) {
            if (existing.syntheticMissingDetails !== true || existing.deleted_at) return json({ error: 'Synthetic VM already exists.' }, 409)
            Object.assign(existing, item, { syntheticMissingDetails: false }); return finishWrite(existing, 201)
        }
        virtualMachines.push(item); return finishWrite(item, 201)
    }
    const vmPath = /^\/api\/vm\/(?:details\/|metrics\/)?([^/]+)(?:\/(.+))?$/.exec(url.pathname)
    if (vmPath) {
        const item = virtualMachines.find(item => item.name === decodeURIComponent(vmPath[1]))
        if (!item) return json({ error: 'Synthetic VM unavailable.' }, 404)
        const action = vmPath[2] || ''
        if (url.pathname.startsWith('/api/vm/details/') && method === 'GET') return item.syntheticMissingDetails === true ? json([]) : json({ ...item, profiles: ['default'], ephemeral: false, stateful: false, last_checked: sampleTime() })
        if (url.pathname.startsWith('/api/vm/metrics/') && method === 'GET') return json(Array.from({ length: 120 }, (_, index) => ({ name: item.name, id: index, created_at: at, cpu_usage_percent: index % 10, cpu_cores: 2, ram_used_mb: 0, ram_total_mb: 4096, net_in_kbps: 0, net_out_kbps: 1, power_state: 'running' })))
        if (action === 'public-services') {
            if (method === 'GET') return json({ canManage: true, services: vmPublicServices })
            if (method === 'POST') { const service = { id: `route-${vmPublicServices.length}`, ...body, hostname: `${body.name}.synthetic.invalid`, createdAt: at }; vmPublicServices.push(service); return finishWrite(service, 201) }
        }
        if (action.startsWith('public-services/') && method === 'DELETE') { const index = vmPublicServices.findIndex(service => service.id === action.split('/')[1]); if (index >= 0) vmPublicServices.splice(index, 1); return finishWrite({ ok: true }) }
        if (['start', 'stop', 'restart'].includes(action) && method === 'POST') { item.status = action === 'stop' ? 'stopped' : 'running'; return finishWrite({ accepted: true }) }
        if (action === 'host-features' && method === 'PUT') { item.failover_enabled = body.failover_enabled; return finishWrite(item) }
        if (action === 'failover' && method === 'POST') return finishWrite({ message: 'Synthetic failover queued.', vm: item }, 202)
        if (action === 'organization' && method === 'PUT') { item.organization_id = body.organizationId; return finishWrite({ status: 200, organization: { id: body.organizationId, name: org.name } }) }
        if (action === 'connection' && method === 'GET') return finishWrite({ vmName: item.name, vmIp: '192.0.2.10', username: item.name, sshCommand: `ssh ${item.name}@192.0.2.10`, certificateCount: 0, certificates: [] })
        if (action === 'sudo-password' && method === 'POST') return body.currentPassword === 'synthetic-password' ? finishWrite({ password: 'synthetic-sudo-only' }) : json({ error: 'Synthetic reauthentication rejected.' }, 403)
        if (action === 'restore' && method === 'POST') { item.deleted_at = null; item.deletion_restore = { instanceMissing: true }; return finishWrite({ message: 'Synthetic record restored; guest remains missing.', vm: item }) }
        if (!action && method === 'GET') return json([item])
        if (!action && method === 'DELETE') { if (body.confirmation !== item.name) return json({ error: 'Synthetic name confirmation rejected.' }, 400); item.deleted_at = at; item.delete_after = '2026-10-30T07:00:00Z'; return finishWrite({ message: 'Synthetic VM retained for deletion.', vm: item }) }
    }
    if (url.pathname.startsWith('/api/cases/')) {
        if (url.searchParams.get('organizationId') !== org.id) return json({ error: 'Synthetic case scope missing.' }, 403)
        if (method === 'GET' && url.pathname === '/api/cases/monitoring') return json({ items: monitoringCases })
        const match = /^\/api\/cases\/monitoring\/(HA-[1-9]\d*)$/.exec(url.pathname)
        if (match) {
            const item = monitoringCases.find(item => item.id === match[1])
            if (!item) return json({ error: 'Synthetic case unavailable.' }, 404)
            if (method === 'GET') {
                const eventPage = Number(url.searchParams.get('eventsPage') || 0)
                return json({ case: { ...item, eventPage, eventTotal: 51, eventSnapshot: url.searchParams.get('eventsAt') || at, events: Array.from({ length: eventPage === 0 ? 50 : 1 }, (_, index) => ({ id: `event-${eventPage * 50 + index}`, message: 'Synthetic failed result', outcome: 'failure', startedAt: at })) } })
            }
            if (method === 'PATCH') {
                for (const field of ['status', 'severity', 'notificationsEnabled'] as const) if (body[field] !== undefined) Object.assign(item, { [field]: body[field] })
                if (body.comment) item.comments.push({ id: `comment-${item.comments.length}`, body: body.comment, createdAt: at })
                if (body.confirmResolutionId && item.resolution) item.resolution.confirmedAt = at
                return finishWrite({ ok: true })
            }
        }
        if (method === 'POST' && url.pathname === '/api/cases/monitoring/merge') {
            for (const id of body.sourceIds || []) { const index = monitoringCases.findIndex(item => item.id === id); if (index >= 0) monitoringCases.splice(index, 1) }
            return finishWrite({ ok: true, targetId: body.targetId, mergedIds: body.sourceIds })
        }
        if (method === 'GET' && url.pathname === '/api/cases/development') return json({ items: [{ id: 'synthetic-change', title: 'Synthetic linked commit', created_at: at }], hasMore: false })
        if (url.pathname === '/api/cases/development/commits') {
            if (method === 'GET') return json({ items: [{ external_id: 'a'.repeat(40), title: 'Synthetic fix', author: 'Fixture operator', created_at: at }], nextCursor: null })
            if (method === 'POST') return finishWrite({ ok: true })
        }
        if (url.pathname === '/api/cases/repositories') {
            if (method === 'GET') return json({ items: caseRepositories })
            if (method === 'POST') return finishWrite({ id: caseRepoId, secret: 'a'.repeat(64), webhookPath: `/api/cases/repository-events/${caseRepoId}` }, 201)
        }
        if (method === 'DELETE' && url.pathname === `/api/cases/repositories/${caseRepoId}`) { caseRepositories.splice(0); return finishWrite({ ok: true }) }
    }
    if (method === 'GET' && url.pathname === '/api/organizations/fixture-org') return json({ organization: { id: org.id, lifecycleStatus: 'active', role: 'owner' } })
    if (method === 'GET' && url.pathname === '/api/system/snapshot') return json(systemSnapshot())
    if (method === 'GET' && url.pathname === '/api/system/storage') return json(systemStorage())
    if (method === 'POST' && url.pathname === '/api/system/storage/clear') { cleanupQueued = true; return finishWrite({ queued: true }, 202) }
    if (method === 'GET' && url.pathname.startsWith('/api/restart/')) {
        const item = containers.find(item => item.id === url.pathname.split('/').pop())
        if (!item) return json({ error: 'Synthetic container missing.' }, 404)
        item.restart_count += 1
        return finishWrite({ ok: true, detail: { message: 'Synthetic restart accepted.' } })
    }
    if (method === 'GET' && url.pathname === '/api/logs/realtime') return json({ generated_at: sampleTime(), source: 'synthetic Docker runtime', runtime_available: true, native_available: false, logs: Array.from({ length: 30 }, (_, index) => ({ id: `synthetic-runtime-${index}`, service: url.searchParams.get('service'), level: 'info', message: `Synthetic runtime line ${index}`, created_at: at, source: 'synthetic Docker' })) })
    if (method === 'GET' && url.pathname === '/api/organizations') return json({ organizations: [{ ...org, role: 'owner', lifecycleStatus: 'active' }] })
    if (/^\/api\/(?:articles|article\/|thoughts|thought\/)/.test(url.pathname)) {
        if (headers.get('x-organization-id') !== org.id) return json({ error: 'Synthetic content scope missing.' }, 403)
        if (method === 'GET' && url.pathname === '/api/articles') return json(articles.map(item => ({ id: item.id, organization_id: item.organization_id, title: item.title, created: item.created, modified: item.modified, metadata: item.metadata })))
        if (method === 'GET' && url.pathname === '/api/thoughts') return json(thoughts)
        if (method === 'POST' && url.pathname === '/api/thought/title') {
            const matches = thoughts.filter(item => item.title === body.title)
            return matches.length ? json(matches) : json({ error: 'Synthetic thought missing.' }, 404)
        }
        if (method === 'POST' && url.pathname === '/api/thoughts') {
            if (thoughts.some(item => item.title === body.title)) return json({ error: 'Synthetic title collision.' }, 409)
            const item = { id: Math.max(...thoughts.map(item => item.id), 0) + 1, organization_id: org.id, title: String(body.title), created_by: settings.userId, created_at: at }
            thoughts.unshift(item)
            const saved = { ...item }
            if (hold) await new Promise<void>(resolve => { release = resolve })
            return fail ? json({ error: 'Synthetic saved thought receipt lost.' }, 500) : json(saved, 201)
        }
        const article = /^\/api\/article\/([^/]+)$/.exec(url.pathname)
        if (article) {
            const id = decodeURIComponent(article[1]), index = articles.findIndex(item => item.id === id)
            if (method === 'GET') return index < 0 ? json({ error: 'Synthetic article missing.' }, 404) : json(articles[index])
            if (method === 'POST') {
                if (index >= 0) return json({ error: 'Synthetic filename collision.' }, 409)
                articles.unshift({ id, organization_id: org.id, title: String(body.content).split('\n')[0].replace(/^#+\s*/, ''), content: String(body.content), created: at, modified: at, metadata: { wordCount: 20, estimatedMinutes: 1 } })
                if (hold) await new Promise<void>(resolve => { release = resolve })
                return fail ? json({ error: 'Synthetic saved article receipt lost.' }, 500) : json({ created: true, name: id }, 201)
            }
            if (index < 0) return json({ error: 'Synthetic article missing.' }, 404)
            if (method === 'PUT') { articles[index].content = String(body.content); articles[index].title = String(body.content).split('\n')[0].replace(/^#+\s*/, ''); return finishWrite({ updated: true, id }) }
            if (method === 'DELETE') { articles.splice(index, 1); return finishWrite({ deleted: true, id }) }
        }
        const thought = /^\/api\/thought\/([1-9]\d*)$/.exec(url.pathname)
        if (thought) {
            const id = Number(thought[1]), index = thoughts.findIndex(item => item.id === id)
            if (index < 0) return json({ error: 'Synthetic thought missing.' }, 404)
            if (method === 'GET') return json(thoughts[index])
            if (method === 'PUT') {
                if (thoughts.some(item => item.id !== id && item.title === body.title)) return json({ error: 'Synthetic title collision.' }, 409)
                thoughts[index].title = String(body.title)
                const saved = { ...thoughts[index] }
                if (hold) await new Promise<void>(resolve => { release = resolve })
                return fail ? json({ error: 'Synthetic saved thought receipt lost.' }, 500) : json({ result: { rows: [saved] }, message: 'Synthetic thought updated.' }, 201)
            }
            if (method === 'DELETE') { thoughts.splice(index, 1); return finishWrite({ deleted: true, id: String(id) }) }
        }
    }
    if (url.pathname === '/api/organizations/fixture-org/privacy') {
        if (method === 'GET') return privacyDeleted ? json({ error: 'Synthetic membership removed.' }, 404) : json(privacyState(Number(url.searchParams.get('itemOffset') || 0), Number(url.searchParams.get('itemLimit') || 50)))
        if (method === 'POST' && ['export', 'run_retention', 'delete'].includes(body.action)) {
            const request = { id: `privacy-${body.requestId}`, organization_id: org.id, request_id: body.requestId, request_type: body.action === 'delete' ? 'deletion' : 'export', status: 'completed', requested_at: at }
            if (body.action === 'export') {
                const data = { public: { organization: { id: org.id, name: org.name }, members: [] }, threatIntelligence: { schemaVersion: 'organization.privacy_export.ti.v1', organizationId: org.id, tenantId: org.id, records: [] } }
                const checksum = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify(data))
                privacyRequests.unshift(request)
                return finishWrite({ export: { schemaVersion: 'organization.privacy_export.v1', organizationId: org.id, tenantId: org.id, exportedAt: at, data, checksum }, request: { id: request.id, status: 'completed' } })
            }
            if (body.action === 'delete') {
                if (body.confirmation !== org.name || body.currentPassword !== 'synthetic-password') return json({ error: 'Synthetic confirmation rejected.' }, 403)
                privacyRequests.unshift(request); privacyDeleted = true
            }
            const run = { id: `run-${body.requestId}`, organization_id: org.id, request_id: body.requestId, trigger_type: body.action === 'delete' ? 'privacy_deletion' : 'manual', privacy_request_id: body.action === 'delete' ? request.id : null, status: 'completed', created_at: at, completed_at: at, deleted_count: 0, redacted_count: 0, protected_count: 65, failed_count: 0, retried_count: 0 }
            privacyRuns.unshift(run)
            return finishWrite({ ...privacyState(0, 100), worker: { claimed: true, runId: run.id, hasMore: false } })
        }
    }
    if (method === 'GET') {
        if (url.pathname === '/api/management/organizations') return json({ allowed: true, canEdit: true, organizations: [org] })
        if (url.pathname === '/api/users') return json(users.filter(user => !user.deletion_scheduled_at))
        if (url.pathname.startsWith('/api/user/')) {
            const user = users.find(user => user.id === decodeURIComponent(url.pathname.slice('/api/user/'.length)))
            return user ? json(user) : json({ error: 'Synthetic profile not visible.' }, 404)
        }
        if (url.pathname === '/api/tests/mine' || url.pathname === '/api/tests/recent') return json(tests)
        if (url.pathname === '/api/tests/quota') return json({ identity: settings.userId, plan: 'free', limit: 5, used: 1, remaining: 4, resetsAt: null })
        if (url.pathname.startsWith('/api/test/')) return json(tests.find(test => test.id === decodeURIComponent(url.pathname.slice('/api/test/'.length))) ?? null)
    }
    const account = /^\/api\/user\/([^/]+)(\/active)?$/.exec(url.pathname)
    if (account && (method === 'DELETE' && !account[2] || method === 'PUT' && account[2])) {
        const user = users.find(user => user.id === decodeURIComponent(account[1]))
        if (!user) return json({ error: 'Synthetic user missing.' }, 404)
        if (method === 'PUT' && typeof body.active === 'boolean') {
            user.active = body.active; user.deactivated_at = body.active ? null : at
            return finishWrite({ id: user.id, name: user.name, active: user.active })
        }
        if (method === 'DELETE') {
            user.deletion_scheduled_at = '2026-11-22T07:00:00Z'; user.active = false
            return finishWrite({ pending_deletion: true, user })
        }
    }
    if (method === 'POST' && url.pathname === '/api/test') {
        const test = { ...tests[0], id: `fixture-scan-${tests.length + 1}`, url: body.url, timeout: body.timeout, stages: body.stages, status: 'queued' }
        tests.unshift(test)
        return finishWrite({ ...test, quota: { plan: 'free', limit: 5, used: 2, remaining: 3, resetsAt: null } })
    }
    if (method === 'POST' && /^\/api\/test\/[^/]+\/rerun$/.test(url.pathname)) {
        const test = tests.find(test => test.id === decodeURIComponent(url.pathname.split('/')[3]))
        if (!test) return json({}, 404)
        if (['queued', 'running'].includes(test.status)) return json({}, 409)
        test.status = 'queued'
        return finishWrite({ ok: true, status: 'queued' })
    }
    throw new Error(`Unsupported synthetic write blocked or read unavailable: ${method} ${url.pathname}`)
}) as typeof fetch
const liveTransport: LoadSocketTransport = address => {
    const url = new URL(address)
    if (url.origin !== 'wss://api.synthetic.invalid' || !/^\/api\/ws\/test\/fixture-scan(?:-\d+)?$/.test(url.pathname)) throw new Error('External sockets are disabled.')
    const socket: LoadSocket = { onopen: null, onmessage: null, onerror: null, onclose: null, close: () => { sockets.delete(socket) } }
    sockets.add(socket)
    setTimeout(() => { if (sockets.has(socket)) { socket.onopen?.(); socket.onmessage?.({ data: JSON.stringify({ type: 'join', participants: 1 }) }) } }, 0)
    return socket
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
let shared = { title: 'Synthetic thesis', revision: 1, body: writeSheets([
    { id: 'Overview', name: 'Overview', title: '# Overview', body: 'Synthetic shared document. **Formatted text** and [a safe link](https://synthetic.invalid).\n\n| Topic | Evidence |\n| --- | --- |\n| Native flow | **Strong** |' },
    { id: 'Plan', name: 'Plan', title: '# Plan', body: '| Goal | Status | Estimate | Progress |\n| --- | --- | --- | --- |\n| Check shared editing | In progress | 4 | 25% |' },
    { id: 'Timetable', name: 'Timetable', title: '# Timetable', body: 'Synthetic activity log.' },
]) }
const versions = [clone(shared)]
let recovered: RecoveredDraft | null = null
const thesisListeners = new Set<(value: typeof shared) => void>()
const node: SourceNode = { id: 'synthetic-source', kind: 'source', title: 'Synthetic source', file: 'fixture/example.ts', sha256: 'a'.repeat(64), reviewHash: 'b'.repeat(64), dependencies: [], dependencyCount: 0, unresolved: [], content: 'export const synthetic = true' }
const thesisServices: ThesisServices = {
    api: {
        access: async () => ({ member: true, canEdit: true }),
        load: async () => clone(shared),
        save: async value => {
            if (value.revision !== shared.revision) throw new ThesisError('Synthetic conflict', 409, clone(shared))
            shared = { ...value, revision: shared.revision + 1 }; versions.unshift(clone(shared))
            const receipt = clone(shared)
            for (const receive of thesisListeners) receive(clone(shared))
            if (hold) await new Promise<void>(resolve => { release = resolve })
            if (fail) throw new ThesisError('Synthetic saved-but-error response')
            return receipt
        },
        history: async (_signal, before) => versions.filter(value => before === undefined || value.revision < before).slice(0, 50).map(value => ({ revision: value.revision, title: value.title, saved_at: at, immediate: true })),
        version: async revision => { const value = versions.find(value => value.revision === revision); if (!value) throw new ThesisError('Synthetic version missing', 404); return clone(value) },
        inventory: async () => ({ version: 1, hash: 'synthetic-inventory', release: 'synthetic', nodes: [node] }),
        source: async id => { if (id !== node.id) throw new ThesisError('Synthetic source missing', 404); return { item: node, history: node.review ? [node.review] : [] } },
        review: async (item, approved, eventId) => {
            const receipt = { event_id: eventId, item_id: item.id, content_hash: item.sha256, review_hash: item.reviewHash, approved, reviewer: 'Synthetic operator', reviewed_at: at }
            node.review = receipt; return receipt
        },
    },
    live: async (_settings, signal, receive, state) => {
        thesisListeners.add(receive); state('Synthetic live')
        const stop = () => { thesisListeners.delete(receive); signal.removeEventListener('abort', stop) }
        signal.addEventListener('abort', stop, { once: true }); return stop
    },
    // Memory-only recovery: this fixture does not exercise device encryption.
    recovery: async () => ({ load: async () => recovered, save: async (draft, uncertain = false) => { recovered = { version: 1, scope: 'synthetic', sequence: (recovered?.sequence ?? 0) + 1, savedAt: Date.now(), draft, uncertain } } }),
}
const Stack = createNativeStackNavigator()
const privacyTransport: PrivacyTransport = (_settings, url, init) => globalThis.fetch(url, init)
// No device files or share sheet are used by this synthetic callback.
const privacyShare: typeof import('../src/features/privacy/export').sharePrivacyExport = async (_exported, isCurrent) => {
    if (isCurrent()) Alert.alert('Synthetic export', 'The verified archive reached the synthetic share callback.')
}
const publishingTransport: import('../src/features/publishing/api').PublishingFetch = (_settings, url, init) => globalThis.fetch(url, init)
const publishingDigest = (value: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value)
const articleServices = { api: createPublishingApi(settings, 'articles', publishingTransport), digest: publishingDigest }
const thoughtServices = { api: createPublishingApi(settings, 'thoughts', publishingTransport), digest: publishingDigest }
const systemFixtureServices: SystemServices = {
    ...systemServices(settings),
    live: async (signal, observer) => {
        const emit = () => { const snapshot = systemSnapshot(); observer.data({ type: 'snapshot', system: snapshot.systemTelemetry, docker: snapshot.dockerTelemetry }); observer.status('Synthetic live telemetry') }
        const timer = setInterval(() => { if (!signal.aborted) emit() }, 1000)
        const stop = () => { clearInterval(timer); signal.removeEventListener('abort', stop) }
        signal.addEventListener('abort', stop, { once: true }); if (signal.aborted) stop()
        return stop
    },
}
const caseFixtureServices = caseServices(settings, { transport: (_settings, url, init) => globalThis.fetch(url, init) })
const syntheticVmSocket = (address: string): ConsoleSocket => {
    const url = new URL(address)
    if (url.origin !== 'wss://api.synthetic.invalid' || !/^\/api\/ws\/vm\/[a-z0-9-]+\/console$/.test(url.pathname)) throw new Error('External VM sockets are disabled.')
    let closed = false
    const socket: ConsoleSocket = { readyState: 0, bufferedAmount: 0, onopen: null, onmessage: null, onclose: null, onerror: null,
        send(data) {
            if (closed) return
            const frame = JSON.parse(data)
            if (frame.type === 'auth') {
                if (frame.token !== 'synthetic-token' || frame.dpop !== 'synthetic-proof') throw new Error('Synthetic console proof missing.')
                setTimeout(() => { if (!closed) {
                    socket.onmessage?.({ data: JSON.stringify({ type: 'ready', username: url.pathname.split('/')[4] }) })
                    socket.onmessage?.({ data: JSON.stringify({ type: 'output', data: '\u001b[32mSynthetic terminal\u001b[0m\r\n$ ' }) })
                    socket.onmessage?.({ data: JSON.stringify({ type: 'boot-output', data: 'Synthetic boot log only.\n' }) })
                } }, 0)
            } else if (frame.type === 'input') setTimeout(() => { if (!closed) socket.onmessage?.({ data: JSON.stringify({ type: 'output', data: frame.data }) }) }, 0)
        },
        close() { closed = true; socket.readyState = 3 },
    }
    setTimeout(() => { if (!closed) { socket.readyState = 1; socket.onopen?.() } }, 0)
    return socket
}
const vmFixtureServices: VmServices = { ...vmServices, openConsole: (s, ops, operation, nonce, options) => openVmConsole(s, ops, operation, nonce, { ...options, dependencies: { proof: async () => ({ proof: 'synthetic-proof' }), socket: syntheticVmSocket } }) }
function Fixture() {
    const [mode, setMode] = useState('Users'), [event, setEvent] = useState('No synthetic operations yet')
    const [request, setRequest] = useState('No requests yet')
    reportSyntheticRequest = setRequest
    return <View style={{ flex: 1 }}>
        <View style={{ paddingTop: 52, paddingHorizontal: 16, gap: 6, backgroundColor: '#101418' }}>
            <Text style={{ color: '#b2b9c2' }}>Synthetic only · no external requests</Text>
            <Text style={{ color: '#b2b9c2' }}>{event}</Text>
            <Text style={{ color: '#b2b9c2' }}>Last request: {request}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {['Users', 'Load testing', 'Thesis', 'Privacy', 'Articles', 'Thoughts', 'System', 'Containers', 'Cases', 'VMs'].map(name => <PillButton key={name} small label={`Fixture ${name}`} onPress={() => setMode(name)} />)}
                <PillButton small label='Finish synthetic cleanup' onPress={() => { cleanupQueued = false; setEvent('Synthetic cleanup idle') }} />
                <PillButton small label='Toggle held response' onPress={() => { hold = !hold; setEvent(`Hold: ${hold}`) }} />
                <PillButton small label='Release response' onPress={() => { release?.(); release = undefined; setEvent('Released synthetic response') }} />
                <PillButton small label='Toggle saved-but-error' onPress={() => { fail = !fail; setEvent(`Saved then error: ${fail}`) }} />
                <PillButton small label='Emit synthetic live log' onPress={() => { for (const socket of sockets) socket.onmessage?.({ data: JSON.stringify({ type: 'update', data: { type: 'log', message: 'Synthetic live evidence' } }) }) }} />
                <PillButton small label='Emit shared document change' onPress={() => { shared = { ...shared, revision: shared.revision + 1, body: shared.body + '\n\nSynthetic other-editor change.' }; versions.unshift(clone(shared)); for (const receive of thesisListeners) receive(clone(shared)) }} />
            </View>
        </View>
        {mode === 'VMs' ? <VirtualMachinesScreen settings={settings} services={vmFixtureServices} onOpenCheckout={() => setEvent('Synthetic checkout handoff; no browser opened')} /> : mode === 'Cases' ? <CasesScreen settings={settings} services={caseFixtureServices} onOpenHealth={id => setEvent(`Synthetic health check: ${id}`)} onOpenIntelligence={() => setEvent('Synthetic intelligence handoff')} /> : mode === 'Users' ? <UserManagementScreen settings={settings} onSelectOrganization={id => setEvent(`Open organization: ${id}`)} /> : mode === 'System' || mode === 'Containers' ? <SystemScreen settings={settings} mode={mode === 'System' ? 'overview' : 'containers'} services={systemFixtureServices} onOpenLogs={name => setEvent(`Synthetic Logs: ${name || 'all'}`)} onOpenVms={() => setEvent('Synthetic VM inventory handoff')} /> : mode === 'Articles' ? <ArticlesScreen settings={settings} services={articleServices} /> : mode === 'Thoughts' ? <ThoughtsScreen settings={settings} services={thoughtServices} /> : mode === 'Privacy' ? <OrganizationPrivacyScreen settings={settings} transport={privacyTransport} exportFile={privacyShare} /> : mode === 'Thesis' ? <ThesisScreen settings={settings} services={thesisServices} /> : <LoadTestsScreen settings={settings} liveTransport={liveTransport} />}
    </View>
}
registerRootComponent(() => <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider><AppThemeProvider mode='obsidian'><NavigationContainer><Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name='SyntheticRemainingMenu' component={Fixture} /></Stack.Navigator></NavigationContainer></AppThemeProvider></SafeAreaProvider></GestureHandlerRootView>)
