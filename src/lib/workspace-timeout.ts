import type { WorkspaceSection } from '../data/site-navigation'

export function workspaceRequestTimeoutMs(definition: Pick<WorkspaceSection, 'endpoint' | 'origin'>, method = 'GET') {
    const path = definition.endpoint.split('?')[0].replace(/^\//, '')
    return method === 'GET' && definition.origin === 'site' && path === 'api/backend/logs/errors' ? 45_000 : 20_000
}
