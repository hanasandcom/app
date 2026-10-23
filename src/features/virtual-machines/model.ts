// Source: Core 6b2a22e6d4895198005824f3dc15615fbd9d9cea handlers/vms and frontend/types/system-metrics.d.ts.
import type { AppSettings } from '../../types'
import { VmError, vmScope } from './transport'
export type Json = null | string | number | boolean | Json[] | { [key: string]: Json }
export const object = (v: unknown): Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new VmError('VM response is incomplete.')
    return v as Record<string, unknown>
}
export function string(v: unknown, max = 1000): string { if (typeof v !== 'string' || v.length > max) throw new VmError('VM response contains invalid text.'); return v }
export const optionalString = (v: unknown, max = 1000) => v === null || v === undefined ? null : string(v, max)
export const number = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(v) && Number.isFinite(Number(v))) return Number(v)
    return null
}
export const flag = (v: unknown) => typeof v === 'boolean' ? v : null
export function list(v: unknown, max = 10000): unknown[] { if (!Array.isArray(v) || v.length > max) throw new VmError('VM response is incomplete or exceeds its limit.'); return v }
export function name(value: unknown) { const v = string(value, 100); if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(v) || v === '.' || v === '..') throw new VmError('Choose a valid VM name.'); return v }
export function identifier(value: unknown) { const v = string(value, 200); if (!/^[A-Za-z0-9_.:@-]+$/.test(v) || v === '.' || v === '..') throw new VmError('Choose a valid identifier.'); return v }
export type Vm = {
    name: string; owner: string; created_by: string | null; organization_id: string | null; organization_name: string | null
    access_users: string[]; managed: boolean | null; can_assign_organization: boolean | null
    status: string | null; status_reason: string | null; status_checked_at: string | null
    deleted_at: string | null; delete_after: string | null; deletion_error: string | null; deletion_restore: { instanceMissing: boolean | null } | null
    primary_host: string | null; failover_host: string | null; failover_premium: boolean | null; failover_enabled: boolean | null
    always_running_premium: boolean | null; always_running_enabled: boolean | null
    type: string | null; architecture: string | null; created: string | null; last_used: string | null
    limits_cpu: string | null; limits_memory: string | null; config_image_description: string | null; config_image_os: string | null; config_image_version: string | null
    device_eth0_ipv4_address: string | null; last_checked: string | null
}
export function parseVm(value: unknown): Vm {
    const r = object(value)
    return {
        name: name(r.name), owner: string(r.owner, 200), created_by: optionalString(r.created_by, 200),
        organization_id: optionalString(r.organization_id, 200), organization_name: optionalString(r.organization_name),
        access_users: r.access_users === undefined || r.access_users === null ? [] : list(r.access_users, 10000).map(v => string(v, 200)),
        managed: flag(r.managed), can_assign_organization: flag(r.can_assign_organization), status: optionalString(r.status), status_reason: optionalString(r.status_reason), status_checked_at: optionalString(r.status_checked_at),
        deleted_at: optionalString(r.deleted_at), delete_after: optionalString(r.delete_after), deletion_error: optionalString(r.deletion_error),
        deletion_restore: r.deletion_restore ? { instanceMissing: flag(object(r.deletion_restore).instanceMissing) } : null,
        primary_host: optionalString(r.primary_host), failover_host: optionalString(r.failover_host), failover_premium: flag(r.failover_premium), failover_enabled: flag(r.failover_enabled),
        always_running_premium: flag(r.always_running_premium), always_running_enabled: flag(r.always_running_enabled),
        type: optionalString(r.type), architecture: optionalString(r.architecture), created: optionalString(r.created), last_used: optionalString(r.last_used),
        limits_cpu: optionalString(r.limits_cpu), limits_memory: optionalString(r.limits_memory), config_image_description: optionalString(r.config_image_description), config_image_os: optionalString(r.config_image_os), config_image_version: optionalString(r.config_image_version),
        device_eth0_ipv4_address: optionalString(r.device_eth0_ipv4_address), last_checked: optionalString(r.last_checked),
    }
}
export const detailFields = ['name', 'status', 'status_reason', 'status_checked_at', 'type', 'architecture', 'created', 'last_used', 'last_checked', 'config_architecture', 'config_image_architecture', 'config_image_description', 'config_image_label', 'config_image_os', 'config_image_release', 'config_image_serial', 'config_image_type', 'config_image_version', 'limits_cpu', 'limits_memory', 'volatile_base_image', 'volatile_cloud_init_instance_id', 'volatile_eth0_hwaddr', 'volatile_last_state_power', 'volatile_uuid', 'volatile_uuid_generation', 'volatile_vsock_id', 'device_eth0_ipv4_address', 'device_eth0_name', 'device_eth0_network', 'device_eth0_type', 'description', 'primary_host'] as const
export type VmDetails = Record<typeof detailFields[number], string | null> & { profiles: string[]; ephemeral: boolean | string | null; stateful: boolean | string | null }
export function parseDetails(value: unknown, target: string): VmDetails | null {
    if (Array.isArray(value)) { if (value.length === 0) return null; throw new VmError('Unexpected VM details list.') }
    const r = object(value)
    if (name(r.name).toLowerCase() !== target.toLowerCase()) throw new VmError('The VM details belong to a different machine.')
    const fields = Object.fromEntries(detailFields.map(key => [key, optionalString(r[key])])) as Record<typeof detailFields[number], string | null>
    return { ...fields, profiles: r.profiles === undefined ? [] : list(r.profiles, 100).map(v => string(v, 200)), ephemeral: typeof r.ephemeral === 'boolean' ? r.ephemeral : optionalString(r.ephemeral), stateful: typeof r.stateful === 'boolean' ? r.stateful : optionalString(r.stateful) }
}
export const metricFields = ['cpu_usage_percent', 'cpu_cores', 'cpu_temperature', 'ram_used_mb', 'ram_total_mb', 'gpu_usage_percent', 'gpu_memory_used_mb', 'gpu_memory_total_mb', 'gpu_temperature', 'system_temperature', 'disk_used_mb', 'disk_total_mb', 'disk_read_iops', 'disk_write_iops', 'net_in_kbps', 'net_out_kbps', 'power_consumption_watts', 'uptime_seconds', 'uptime_total_seconds', 'load_average_1', 'load_average_5', 'load_average_15'] as const
export type VmMetric = Record<typeof metricFields[number], number | null> & { id: number | null; name: string; created_at: string | null; power_state: string | null; powered_on_at: string | null; powered_off_at: string | null }
export function parseMetric(value: unknown, target?: string): VmMetric {
    const r = object(value), vmName = name(r.name)
    if (target && vmName.toLowerCase() !== target.toLowerCase()) throw new VmError('The VM metrics belong to a different machine.')
    return { ...Object.fromEntries(metricFields.map(key => [key, number(r[key])])) as Record<typeof metricFields[number], number | null>, id: number(r.id), name: vmName, created_at: optionalString(r.created_at), power_state: optionalString(r.power_state), powered_on_at: optionalString(r.powered_on_at), powered_off_at: optionalString(r.powered_off_at) }
}
export type Scoped<T> = { scope: string; value: T; checkedAt: number }
export const scoped = <T>(s: AppSettings, value: T): Scoped<T> => ({ scope: vmScope(s), value, checkedAt: Date.now() })
export function requireCurrent<T>(s: AppSettings, result: Scoped<T>): T {
    const age = Date.now() - result.checkedAt
    if (result.scope !== vmScope(s) || age < -5000 || age > 30000) throw new VmError('Refresh current VM access before this action.', 403)
    return result.value
}
export type PublicService = { id: string; name: string; type: 'http' | 'tls' | 'minecraft-java'; port: number; hostname: string; createdAt: string | null }
export function parseService(value: unknown): PublicService {
    const r = object(value), type = r.type, port = number(r.port)
    if (!['http', 'tls', 'minecraft-java'].includes(String(type)) || port === null || !Number.isInteger(port) || port < 1 || port > 65535) throw new VmError('Invalid public service response.')
    return { id: identifier(r.id), name: string(r.name, 100), type: type as PublicService['type'], port, hostname: string(r.hostname, 253), createdAt: optionalString(r.createdAt) }
}
export type VmManagement = { name: string; canManage: boolean; services: PublicService[] }
export function requireManage(s: AppSettings, result: Scoped<VmManagement>, target: string) {
    const permission = requireCurrent(s, result)
    if (permission.name !== name(target) || !permission.canManage) throw new VmError('Current permission to manage this VM is required.', 403)
}
