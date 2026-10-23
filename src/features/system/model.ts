// Core website/API contracts pinned at 6b2a22e6d4895198005824f3dc15615fbd9d9cea.
import type { AppSettings } from '../../types'
export type Container = { id: string; name: string; image: string; state: string; health: string; cpu: number | null; memory: number | null; memoryLimit: number | null; memoryPercent: number | null; uptime: number | null; restarts: number | null; createdAt: string; statsAt: string; reason: string; ports: { ip: string; privatePort: number; publicPort: number | null; type: string }[] }
export type Telemetry = { generatedAt: string; dockerAt: string; reason: string; dockerReason: string; source: string; containers: Container[]; load: (number | null)[]; memoryUsed: number | null; memoryTotal: number | null; memoryPercent: number | null; vmCount: number | null; runningVms: number | null; stoppedVms: number | null }
export type Storage = { cache: number; reclaimable: number | null; budget: number | null; checkedAt: string; lastSuccessAt: string; lastFreed: number | null; running: boolean; queued: boolean; stale: boolean; phase: string; freed: number | null; progressAt: string; schedule: string; timezone: string; error: string; images: { id: string; names: string[]; bytes: number | null; eligible: boolean; reason: string }[] }
export type Access = { scope: string; canRead: boolean; canWrite: boolean }
export type RuntimeLogs = { source: string; generatedAt: string; reason: string; runtime: boolean; native: boolean; logs: { id: string; service: string; level: string; message: string; createdAt: string; source: string }[] }
export class SystemError extends Error { constructor(message: string, readonly status = 0, readonly uncertain = false) { super(message) } }
export const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
export const text = (v: unknown, maximum = 1000) => typeof v === 'string' ? v.slice(0, maximum) : ''
export const numeric = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
export const timestamp = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : ''
export const ownAccount = (s: AppSettings) => !!s.userId && !!s.authToken && !s.impersonationToken && !s.impersonatingUserId
export const systemScope = (s: AppSettings) => JSON.stringify([s.apiBaseUrl, s.siteBaseUrl, s.userId, s.authToken, s.selectedOrganizationId, s.impersonationToken, s.impersonatingUserId])
export function endpoint(base: string, path: string) {
    const url = new URL(base)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new SystemError('Use a secure API address without credentials or query parameters.')
    return `${url.href.replace(/\/+$/, '')}/${path}`
}
export const intentScope = (s: AppSettings) => JSON.stringify([endpoint(s.apiBaseUrl, ''), s.userId, s.impersonationToken || s.impersonatingUserId ? 'impersonated' : 'own'])
export const validContainerId = (v: string) => /^[a-f0-9]{12,64}$/i.test(v)
function array(value: unknown, maximum: number): unknown[] {
    if (!Array.isArray(value) || value.length > maximum) throw new SystemError('The telemetry response is incomplete or exceeds its limit.')
    return value
}
const envelope = (v: unknown) => { const r = record(v); return Object.keys(record(r.data)).length ? record(r.data) : r }
export function parseContainers(value: unknown) {
    const body = envelope(value), raw = Array.isArray(value) ? value : Array.isArray(record(value).data) ? record(value).data : body.containers
    const seen = new Set<string>()
    const containers = array(raw, 2000).map(value => {
        const r = record(value), stats = record(r.stats), id = text(r.id), name = text(r.name)
        if (!validContainerId(id) || !name || name.length > 300 || seen.has(id)) throw new SystemError('Container inventory contains invalid or duplicate identities.')
        seen.add(id)
        const cpu = numeric(stats.cpu_percent) ?? numeric(r.cpu), memory = numeric(stats.memory_bytes) ?? numeric(r.memory)
        return { id, name, image: text(r.image), state: text(r.state) || text(r.status), health: text(r.health) || 'Not reported', cpu, memory,
            memoryLimit: numeric(stats.memory_limit_bytes), memoryPercent: numeric(stats.memory_percent), uptime: numeric(r.uptime_seconds), restarts: numeric(r.restart_count),
            createdAt: timestamp(r.created_at), statsAt: timestamp(r.stats_updated_at), reason: text(r.stats_unavailable_reason),
            ports: r.ports === undefined ? [] : array(r.ports, 200).map(value => { const p = record(value); const privatePort = numeric(p.private_port); if (privatePort === null || privatePort > 65535) throw new SystemError('Invalid container port.'); return { ip: text(p.ip, 100), privatePort, publicPort: numeric(p.public_port), type: text(p.type, 20) } }) }
    })
    return { containers, generatedAt: timestamp(body.generated_at), source: text(body.source), reason: text(body.unavailable_reason) }
}
export function parseTelemetry(value: unknown): Telemetry {
    const body = record(value), docker = parseContainers(body.dockerTelemetry), metrics = envelope(body.systemTelemetry), system = record(metrics.system), memory = record(system.memory)
    if (!body.systemTelemetry || !body.dockerTelemetry || !timestamp(body.generated_at)) throw new SystemError('System snapshot is incomplete.')
    const vms = Array.isArray(body.vms) ? array(body.vms, 10000).map(record) : null
    const percent = typeof memory.percent === 'string' && /^\d+(\.\d+)?$/.test(memory.percent) ? Number(memory.percent) : numeric(memory.percent)
    return { generatedAt: timestamp(body.generated_at), dockerAt: docker.generatedAt, reason: text(metrics.unavailable_reason) || text(metrics.hostUnavailableReason), dockerReason: docker.reason, source: docker.source,
        containers: docker.containers, load: Array.isArray(system.load) ? system.load.slice(0, 3).map(numeric) : [], memoryUsed: numeric(memory.used), memoryTotal: numeric(memory.total), memoryPercent: percent,
        vmCount: vms?.length ?? null, runningVms: vms ? vms.filter(v => String(v.status).toLowerCase() === 'running').length : null, stoppedVms: vms ? vms.filter(v => String(v.status).toLowerCase() === 'stopped').length : null }
}
export function applyLive(previous: Telemetry, value: unknown): Telemetry {
    const r = record(value)
    if (r.type === 'error') throw new SystemError(text(r.message) || 'Live telemetry is unavailable.')
    if (r.type !== 'snapshot') throw new SystemError('Unsupported system stream message.')
    // Live messages omit VM inventory and an outer timestamp; retain that independently sampled inventory.
    const result = parseTelemetry({ systemTelemetry: r.system, dockerTelemetry: r.docker, generated_at: record(r.docker).generated_at })
    return { ...result, vmCount: previous.vmCount, runningVms: previous.runningVms, stoppedVms: previous.stoppedVms }
}
export function parseStorage(value: unknown, now = Date.now()): Storage {
    const r = record(value), cache = numeric(r.cacheBytes), checkedAt = timestamp(r.checkedAt)
    if (cache === null || !checkedAt || typeof r.running !== 'boolean' || typeof r.queued !== 'boolean' || typeof r.stale !== 'boolean') throw new SystemError('Storage figures are unavailable.')
    const age = now - Date.parse(checkedAt)
    return { cache, reclaimable: numeric(r.reclaimableCacheBytes), budget: numeric(r.cacheBudgetBytes), checkedAt, lastSuccessAt: timestamp(r.lastSuccessAt), lastFreed: numeric(r.lastFreedBytes), running: r.running, queued: r.queued,
        stale: r.stale || age < -5000 || age > 900000, phase: text(r.phase), freed: numeric(r.freedBytes), progressAt: timestamp(r.progressAt), schedule: text(r.schedule), timezone: text(r.timezone), error: text(r.error),
        images: array(r.unusedImages, 3000).map(value => { const image = record(value); if (!text(image.id) || typeof image.eligible !== 'boolean') throw new SystemError('Invalid storage candidate.'); return { id: text(image.id), names: array(image.names, 100).map(v => text(v)), bytes: numeric(image.sizeBytes), eligible: image.eligible, reason: text(image.retainedReason) } }) }
}
export function parseRuntimeLogs(value: unknown): RuntimeLogs {
    const r = record(value)
    if (!timestamp(r.generated_at) || typeof r.runtime_available !== 'boolean' || typeof r.native_available !== 'boolean') throw new SystemError('Runtime logs returned an incomplete response.')
    return { source: text(r.source), generatedAt: timestamp(r.generated_at), reason: text(r.unavailable_reason), runtime: r.runtime_available, native: r.native_available,
        logs: array(r.logs, 120).map(value => { const log = record(value); if (!text(log.id) || typeof log.message !== 'string') throw new SystemError('Invalid runtime log entry.'); return { id: text(log.id), service: text(log.service), level: text(log.level), message: log.message.length > 16000 ? `${log.message.slice(0, 16000)}\n[Entry truncated after 16,000 characters]` : log.message, createdAt: timestamp(log.created_at), source: text(log.source) } }) }
}
export const bytes = (v: number | null) => v === null ? 'Unavailable' : v < 1024 ? `${v} B` : `${(v / 1024 ** 3).toFixed(2)} GiB`
export const measured = (v: number | null, suffix = '') => v === null ? 'Unavailable' : `${v.toLocaleString()}${suffix}`
export const staleTelemetry = (v: Telemetry, now = Date.now()) => { const age = now - Date.parse(v.generatedAt); return !Number.isFinite(age) || age > 30000 || age < -5000 }
