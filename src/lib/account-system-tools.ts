import type { AppSettings } from '../types'
import { accountRequest } from './profile-api'

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown) => typeof value === 'string' ? value : ''
const rows = (value: unknown) => Array.isArray(value) ? value.map(object) : []
const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
export function accountToolKey(settings: AppSettings) { return JSON.stringify([settings.apiBaseUrl, settings.userId, settings.impersonationToken, settings.selectedOrganizationId]) }
export function safeBillingPortalUrl(value: unknown) {
    try {
        const url = new URL(text(value))
        if (url.protocol === 'https:' && url.hostname === 'billing.stripe.com' && !url.username && !url.password && !url.port) return url.toString()
    } catch { /* Invalid service output must not launch another destination. */ }
    throw new Error('The billing service returned an invalid management link.')
}
export async function loadAccountSubscription(settings: AppSettings, signal: AbortSignal) {
    const payload = object(await accountRequest<unknown>(settings, 'billing/subscription', { signal }))
    if (payload.subscription !== null && (!payload.subscription || typeof payload.subscription !== 'object' || Array.isArray(payload.subscription))) throw new Error('Subscription information is unavailable. Try again.')
    const subscription = object(payload.subscription)
    return {
        subscription: payload.subscription === null ? null : { planId: text(subscription.planId), status: text(subscription.status), currentPeriodStart: text(subscription.currentPeriodStart), currentPeriodEnd: text(subscription.currentPeriodEnd), cancelAtPeriodEnd: subscription.cancelAtPeriodEnd === true },
        entitlements: rows(payload.entitlements).map(row => ({ planId: text(row.planId), features: strings(row.features) })),
        quotas: rows(payload.quotas).map(row => ({ key: text(row.key), limit: count(row.limit), used: count(row.used), remaining: count(row.remaining), resetsAt: text(row.resetsAt) })),
    }
}
export async function createAccountBillingPortal(settings: AppSettings, signal: AbortSignal) {
    if (settings.impersonationToken) throw new Error('Return to your own account to manage billing.')
    const payload = object(await accountRequest<unknown>(settings, 'billing/portal', { method: 'POST', signal }))
    return safeBillingPortalUrl(payload.url)
}
export type UpdateHost = 'inspur' | 'ovhcloud'
export type HostUpdates = Awaited<ReturnType<typeof loadHostUpdates>>
export async function loadHostUpdates(settings: AppSettings, host: UpdateHost, signal: AbortSignal) {
    if (host !== 'inspur' && host !== 'ovhcloud') throw new Error('Choose Inspur or OVH.')
    const payload = object(await accountRequest<unknown>(settings, `system/updates?host=${host}`, { signal }))
    if (payload.host !== host || !payload.status || typeof payload.status !== 'object' || Array.isArray(payload.status) || !Array.isArray(payload.history)) throw new Error('Host update information is unavailable. Try again.')
    const status = object(payload.status)
    const policy = object(status.policy)
    return {
        host, status: text(status.status) || 'unknown', checkedAt: text(status.checked_at), error: text(status.last_error), lastUpdateAt: text(status.last_update_at), lastUpdatedPackages: strings(status.last_updated_packages),
        policy: { delayHours: count(policy.non_security_delay_hours), securityInstall: text(policy.security_install), verification: text(policy.repository_verification) },
        pending: rows(status.pending_updates).map(row => ({ name: text(row.package), version: text(row.version), repository: text(row.repo), origin: text(row.origin), security: row.security === true, firstSeen: count(row.installed_at) || count(row.first_seen) })),
        installed: rows(status.installed_packages).map(row => ({ name: text(row.package), version: text(row.version) })),
        history: rows(payload.history).map(row => ({ id: text(row.run_id), status: text(row.status), occurredAt: text(row.occurred_at), today: row.is_today === true, packages: strings(row.packages), error: text(row.error) })),
    }
}
export function pendingUpdateTiming(item: HostUpdates['pending'][number], delayHours: number | null, now = Date.now()) {
    if (item.security) return 'Security update · immediate policy'
    if (item.firstSeen === null || delayHours === null || item.firstSeen * 1000 > now) return 'Waiting for reported timing'
    const ageHours = Math.max(0, Math.floor((now - item.firstSeen * 1000) / 3600000))
    return ageHours >= delayHours ? 'Ready under the reported policy' : `${ageHours} of ${delayHours} hours elapsed`
}
export async function loadHostAccess(settings: AppSettings, signal: AbortSignal) {
    if (settings.impersonationToken) throw new Error('Return to your own account to review host access.')
    const payload = object(await accountRequest<unknown>(settings, 'host-overview', { signal }))
    if (!Array.isArray(payload.hosts) || !Array.isArray(payload.users)) throw new Error('Host access information is unavailable. Try again.')
    return {
        hosts: rows(payload.hosts).map(row => ({ id: text(row.id), name: text(row.name), address: text(row.address), username: text(row.username), status: row.status === 'online' ? 'online' : row.status === 'offline' ? 'offline' : 'unknown', hostname: text(row.hostname), operatingSystem: text(row.operatingSystem) })),
        users: rows(payload.users).map(row => ({ id: text(row.id), name: text(row.name), username: text(row.username), keyCount: count(row.keyCount) })),
    }
}
