export type WebsiteCaseRef = { caseId: string; alertId: string; organizationId?: string; route?: 'alert_queue' | 'delivery_history' }

const tiAdministrationPaths: Record<string, string> = {
    '/ti/activity': '/dashboard/ti/activity',
    '/ti/sources': '/dashboard/ti/sources',
    '/ti/runs': '/dashboard/ti/runs',
    '/ti/profiles': '/dashboard/ti/enrichment',
    '/ti/enrichment': '/dashboard/ti/enrichment',
    '/ti/timeliness': '/dashboard/ti/timeliness',
}

function secureWebsite(value: string) {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Configure a secure website address.')
    return url
}

/** Core redirects legacy TI paths, but TI administration lives under /dashboard/ti. */
export function websitePageUrl(siteBaseUrl: string, path: string, tiSiteUrl = process.env.EXPO_PUBLIC_TI_SITE_URL) {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || Array.from(path).some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)) throw new Error('The linked page address is invalid.')
    const website = secureWebsite(siteBaseUrl)
    const relative = new URL(path, website.origin)
    const administrationPath = tiAdministrationPaths[relative.pathname]
    const tiBase = tiSiteUrl || (website.origin === 'https://hanasand.com' && website.pathname === '/' ? 'https://ti.hanasand.com' : undefined)
    if (administrationPath && tiBase) {
        const target = new URL(secureWebsite(tiBase).toString().replace(/\/+$/, '') + administrationPath)
        target.search = relative.search; target.hash = relative.hash
        if (relative.pathname === '/ti/sources') {
            target.searchParams.set('scope', 'global')
            if (target.searchParams.get('available') === 'true' && !target.searchParams.has('lifecycle')) target.searchParams.set('lifecycle', 'candidate')
            target.searchParams.delete('available')
        }
        return target.toString()
    }
    const target = new URL(website.toString().replace(/\/+$/, '') + path)
    if (target.origin !== website.origin) throw new Error('The linked page address is invalid.')
    return target.toString()
}

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
