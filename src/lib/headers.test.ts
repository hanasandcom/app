import { describe, expect, test } from 'bun:test'
import { deleteHeader, getHeader, headerRecord, responseLike, setHeader } from './headers'

describe('native-safe fetch headers', () => {
    test('merges object, tuple, and Headers-like inputs case insensitively', () => {
        expect(headerRecord({ Authorization: 'Bearer first', accept: 'application/json' })).toEqual({ authorization: 'Bearer first', accept: 'application/json' })
        expect(headerRecord([['X-Trace', 'one'], ['x-trace', 'two']])).toEqual({ 'x-trace': 'two' })
        const headersLike = { forEach: (callback: (value: string, name: string) => void) => callback('synthetic', 'X-Fixture') } as unknown as HeadersInit
        expect(getHeader(headersLike, 'x-fixture')).toBe('synthetic')
    })

    test('sets and deletes without a Web Headers constructor', () => {
        const headers = headerRecord()
        setHeader(headers, 'Content-Type', 'application/json')
        setHeader(headers, 'Authorization', 'Bearer test')
        expect(getHeader(headers, 'content-type')).toBe('application/json')
        deleteHeader(headers, 'CONTENT-TYPE')
        expect(getHeader(headers, 'content-type')).toBeNull()
        expect(headers).toEqual({ authorization: 'Bearer test' })
    })

    test('provides the Response methods native desktop-agent transports need', async () => {
        const response = responseLike('{"ok":true}', 200, 'OK', { 'Content-Type': 'application/json', 'Content-Length': '11' })
        expect(response.ok).toBe(true)
        expect(getHeader(response.headers, 'content-type')).toBe('application/json')
        expect(await response.json()).toEqual({ ok: true })
        expect(await response.clone().text()).toBe('{"ok":true}')
    })
})
