import type { DesktopAgentPresence } from '../types'

const SHA256_HEX = /^[0-9a-f]{64}$/

export type PinnedDesktopAgentEndpoint = {
    url: string
    pin: string
}

export function normalizePinnedDesktopAgentEndpoint(endpoint: string, pin: string): PinnedDesktopAgentEndpoint | null {
    if (!SHA256_HEX.test(pin)) return null
    try {
        const url = new URL(endpoint.trim())
        if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash) return null
        url.pathname = url.pathname.replace(/\/+$/, '') || '/'
        return { url: url.toString().replace(/\/$/, url.pathname === '/' ? '' : '/'), pin }
    } catch {
        return null
    }
}

export function trustedDesktopAgentEndpoints(agents: DesktopAgentPresence[], preferredBaseUrl: string) {
    const preferred = (() => {
        try {
            const url = new URL(preferredBaseUrl.trim())
            return url.protocol === 'https:' && !url.username && !url.password ? url.origin : ''
        } catch {
            return ''
        }
    })()
    const endpoints: PinnedDesktopAgentEndpoint[] = []
    for (const agent of agents) {
        const pin = agent.tlsCertificateSha256 || ''
        for (const endpoint of agent.endpoints || []) {
            const trusted = normalizePinnedDesktopAgentEndpoint(endpoint, pin)
            if (trusted && !endpoints.some(item => item.url === trusted.url && item.pin === trusted.pin)) endpoints.push(trusted)
        }
    }
    return endpoints.sort((left, right) => {
        if (!preferred) return 0
        return Number(new URL(right.url).origin === preferred) - Number(new URL(left.url).origin === preferred)
    })
}
