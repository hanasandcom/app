import { afterEach, describe, expect, it } from 'bun:test'
import { zlibSync } from 'fflate'
import type { AppSettings } from '../types'
import { checkPasswordHash, normalizePasswordHash } from './password-check'
import { parseCompactRange } from './pwned-prefix'
const originalFetch = globalThis.fetch
const settings = { siteBaseUrl: 'https://hanasand.com', authToken: 'must-not-send', userId: 'must-not-send' } as AppSettings
const hash = 'ABCDE' + '1'.repeat(35)
function frame(options: { match?: boolean; expected?: number; catalog?: string[] } = {}) {
    const catalog = new TextEncoder().encode(JSON.stringify(options.catalog || ['synthetic.txt']))
    const raw = new Uint8Array(38)
    const data = new DataView(raw.buffer)
    data.setUint32(0, 1, true)
    raw.set(Uint8Array.from((options.match === false ? '2'.repeat(36) : hash.slice(4)).match(/../g)!, part => parseInt(part, 16)), 4)
    data.setUint32(22, 0, true); data.setUint32(26, 8, true)
    // One file, two line ranges: lines 2–4 and 8–9 => five exact occurrences.
    raw.set([1, 0, 2, 2, 3, 4, 2, 0], 30)
    // Posting consumes seven bytes; no trailing bytes in its interval.
    data.setUint32(26, 7, true)
    const compressed = zlibSync(raw)
    const bytes = new Uint8Array(20 + catalog.length + compressed.length)
    bytes.set(new TextEncoder().encode('PWNPRF01'))
    const view = new DataView(bytes.buffer)
    view.setUint32(8, catalog.length, true); view.setUint32(12, parseInt(hash.slice(0, 5), 16), true)
    bytes.set(catalog, 16); view.setUint32(16 + catalog.length, options.expected ?? raw.length, true); bytes.set(compressed, 20 + catalog.length)
    return bytes.buffer
}
afterEach(() => { globalThis.fetch = originalFetch })

describe('native private password-prefix lookup', () => {
    it('sends only the first five hash characters with no token/cookies or full hash in URL/body', async () => {
        const calls: Array<{ url: string; init: RequestInit }> = []
        globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => { calls.push({ url: String(url), init: init! }); return new Response(frame(), { headers: { 'content-type': 'application/vnd.hanasand.pwned-prefix' } }) }) as unknown as typeof fetch
        expect(await checkPasswordHash(settings, hash.toLowerCase(), new AbortController().signal)).toEqual({ count: 5, files: [{ file: 'synthetic.txt', count: 5, lineRanges: [[2, 4], [8, 9]] }] })
        expect(calls[0].url).toBe('https://hanasand.com/api/pwned')
        expect(calls[0].init.credentials).toBe('omit')
        expect(calls[0].init.body).toBe(JSON.stringify({ prefix: 'ABCDE' }))
        const headers = new Headers(calls[0].init.headers)
        expect(headers.has('authorization')).toBe(false); expect(headers.has('cookie')).toBe(false); expect(headers.has('id')).toBe(false)
        expect(JSON.stringify(calls)).not.toContain(hash)
        expect(JSON.stringify(calls)).not.toContain('must-not-send')
    })
    it('performs the exact suffix comparison locally, without treating adjacent hashes as a match', async () => {
        expect(await parseCompactRange(frame({ match: false }), hash)).toEqual({ count: 0, files: [] })
        expect(normalizePasswordHash(` ${hash.toLowerCase()} `)).toBe(hash)
    })
    it('rejects plaintext, malformed index, bad prefix and declared expansion overflow', async () => {
        expect(() => normalizePasswordHash('plain password')).toThrow('40-character')
        await expect(parseCompactRange(new ArrayBuffer(0), hash)).rejects.toThrow('invalid response')
        const wrongPrefix = frame(); new DataView(wrongPrefix).setUint32(12, 123, true)
        await expect(parseCompactRange(wrongPrefix, hash)).rejects.toThrow('invalid response')
        await expect(parseCompactRange(frame({ expected: 8 }), hash)).rejects.toThrow('invalid response')
        await expect(parseCompactRange(frame({ expected: 64 * 1024 * 1024 + 1 }), hash)).rejects.toThrow('invalid response')
        const corrupt = new Uint8Array(frame()); corrupt[corrupt.length - 1] ^= 1
        await expect(parseCompactRange(corrupt.buffer, hash)).rejects.toThrow('invalid response')
    })
    it('decodes bundles and rejects duplicate file catalogs across frames', async () => {
        const parts = [new Uint8Array(frame()), new Uint8Array(frame({ catalog: ['other.txt'] }))]
        const bundle = new Uint8Array(16 + parts.reduce((sum, part) => sum + 4 + part.length, 0))
        bundle.set(new TextEncoder().encode('PWNPRF02'))
        const view = new DataView(bundle.buffer); view.setUint32(8, 2, true); view.setUint32(12, parseInt(hash.slice(0, 5), 16), true)
        let position = 16
        for (const part of parts) { view.setUint32(position, part.length, true); position += 4; bundle.set(part, position); position += part.length }
        expect((await parseCompactRange(bundle.buffer, hash)).count).toBe(10)
        const duplicate = new Uint8Array(16 + 8 + parts[0].length * 2)
        duplicate.set(bundle.subarray(0, 16))
        const duplicateView = new DataView(duplicate.buffer)
        duplicateView.setUint32(16, parts[0].length, true); duplicate.set(parts[0], 20)
        duplicateView.setUint32(20 + parts[0].length, parts[0].length, true); duplicate.set(parts[0], 24 + parts[0].length)
        await expect(parseCompactRange(duplicate.buffer, hash)).rejects.toThrow('invalid response')
    })
    it('refuses invalid transport/content and respects cancellation', async () => {
        let calls = 0
        globalThis.fetch = (async () => { calls++; return Response.json({ error: 'Synthetic unavailable' }, { status: 503 }) }) as unknown as typeof fetch
        await expect(checkPasswordHash(settings, 'plaintext', new AbortController().signal)).rejects.toThrow('40-character')
        expect(calls).toBe(0)
        await expect(checkPasswordHash({ ...settings, siteBaseUrl: 'http://example.test' }, hash, new AbortController().signal)).rejects.toThrow('HTTPS')
        expect(calls).toBe(0)
        await expect(checkPasswordHash(settings, hash, new AbortController().signal)).rejects.toThrow('Unable to check')
        const controller = new AbortController(); controller.abort()
        globalThis.fetch = (async () => new Response(frame(), { headers: { 'content-type': 'application/vnd.hanasand.pwned-prefix' } })) as unknown as typeof fetch
        await expect(checkPasswordHash(settings, hash, controller.signal)).rejects.toThrow('cancelled')
    })
})
