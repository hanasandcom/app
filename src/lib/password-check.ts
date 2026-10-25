import type { AppSettings } from '../types'
import { parseCompactRange } from './pwned-prefix'
import { getHeader } from './headers'

export function normalizePasswordHash(value: string) {
    const hash = value.replace(/\s+/g, '').toUpperCase()
    if (!/^[A-F0-9]{40}$/.test(hash)) throw new Error('Enter a complete 40-character SHA-1 hash.')
    return hash
}
export async function checkPasswordHash(settings: AppSettings, value: string, signal: AbortSignal) {
    const hash = normalizePasswordHash(value)
    const url = new URL('/api/pwned', settings.siteBaseUrl)
    if (url.protocol !== 'https:') throw new Error('Password checks require HTTPS.')
    // This public prefix endpoint receives neither the full hash nor account credentials.
    const response = await fetch(url.toString(), { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefix: hash.slice(0, 5) }), signal })
    if (!response.ok || getHeader(response.headers, 'content-type')?.split(';')[0] !== 'application/vnd.hanasand.pwned-prefix') throw new Error('Unable to check leaked-password records right now. Try again.')
    const length = Number(getHeader(response.headers, 'content-length'))
    if (Number.isFinite(length) && length > 64 * 1024 * 1024 + 65552) throw new Error('The password index returned an invalid response.')
    const result = await parseCompactRange(await response.arrayBuffer(), hash)
    if (signal.aborted) throw new Error('Password check cancelled.')
    return result
}
