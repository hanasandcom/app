import PinnedHttps from '../../modules/hanasand-pinned-https'
import type { PinnedDesktopAgentEndpoint } from './desktop-agent-endpoints'
import { deleteHeader, headerRecord, responseLike } from './headers'

export async function requestPinnedDesktopAgent(endpoint: PinnedDesktopAgentEndpoint, path: string, init?: RequestInit) {
    const target = new URL(path.replace(/^\/+/, ''), `${endpoint.url.replace(/\/+$/, '')}/`).toString()
    const headers = headerRecord(init?.headers)
    const response = await PinnedHttps.request(
        target,
        endpoint.pin,
        (init?.method || 'GET').toUpperCase(),
        headers,
        typeof init?.body === 'string' ? init.body : null,
    )
    const responseHeaders = headerRecord(response.headers)
    for (const name of ['content-length', 'content-encoding', 'transfer-encoding', 'connection']) deleteHeader(responseHeaders, name)
    const body = [204, 205, 304].includes(response.status) ? null : response.body
    return responseLike(body, response.status, '', responseHeaders)
}
