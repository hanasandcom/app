import PinnedHttps from '../../modules/hanasand-pinned-https'
import type { PinnedDesktopAgentEndpoint } from './desktop-agent-endpoints'

export async function requestPinnedDesktopAgent(endpoint: PinnedDesktopAgentEndpoint, path: string, init?: RequestInit) {
    const target = new URL(path.replace(/^\/+/, ''), `${endpoint.url.replace(/\/+$/, '')}/`).toString()
    const headers = Object.fromEntries(new Headers(init?.headers).entries())
    const response = await PinnedHttps.request(
        target,
        endpoint.pin,
        (init?.method || 'GET').toUpperCase(),
        headers,
        typeof init?.body === 'string' ? init.body : null,
    )
    const responseHeaders = new Headers(response.headers)
    for (const name of ['content-length', 'content-encoding', 'transfer-encoding', 'connection']) responseHeaders.delete(name)
    const body = [204, 205, 304].includes(response.status) ? null : response.body
    return new Response(body, { status: response.status, headers: responseHeaders })
}
