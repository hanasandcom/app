export type WebsiteCaseRef = { caseId: string; alertId: string; organizationId?: string; route?: 'alert_queue' | 'delivery_history' }
function identity(value: string) {
    if (!value || value === '.' || value === '..' || value.length > 200 || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new Error('The linked record identity is invalid.')
    return value
}
export function caseWebsitePath(ref: WebsiteCaseRef) {
    const params = new URLSearchParams()
    if (ref.organizationId !== undefined) params.set('organizationId', identity(ref.organizationId))
    params.set('alertId', identity(ref.alertId))
    params.set('route', ref.route || 'delivery_history')
    return `/cases/${encodeURIComponent(identity(ref.caseId))}?${params}`
}
export function monitoredActorsWebsitePath(organizationId: string) {
    return `/findings/actors?${new URLSearchParams({ organizationId: identity(organizationId) })}`
}
