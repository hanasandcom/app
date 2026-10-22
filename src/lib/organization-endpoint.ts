import type { AppSettings } from '../types'

/** Identity owns membership discovery; sign its public URL directly, without a proxy hop. */
export function organizationListBase(settings: AppSettings): string {
    const base = settings.apiBaseUrl.replace(/\/+$/, '')
    return base === 'https://api.hanasand.com/api'
        ? 'https://identity.hanasand.com/api'
        : base
}
