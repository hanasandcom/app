const hanasandDomain = 'hanasand.com'

export function isSandboxFirstPartyNavigation(value: string) {
    try {
        const url = new URL(value)
        const host = url.hostname.toLowerCase()
        return url.protocol === 'https:' && (host === hanasandDomain || host.endsWith(`.${hanasandDomain}`))
    } catch {
        return false
    }
}
