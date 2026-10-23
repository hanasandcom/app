import { expect, test } from 'bun:test'
import type { AppSettings } from '../../types'
import { articleId, assertItemScope, contentItem, filterContent, PublishingError, requireWriter } from './contracts'
import { createPublishingApi } from './api'
import { markdownBlocks, openMarkdownLink, safeLink } from '../../lib/markdown'

const settings = { apiBaseUrl: 'https://publishing.invalid/api', userId: 'synthetic', authToken: 'synthetic-token', selectedOrganizationId: 'org', impersonationToken: '', impersonatingUserId: '' } as AppSettings
const signal = () => new AbortController().signal
const thought = { id: 42, title: '# A thought', created_by: 'synthetic', organization_id: 'org', created_at: '2026-01-01' }
const article = { id: 'example.md', title: 'Example', organization_id: 'org', metadata: { wordCount: 3, estimatedMinutes: 1 }, content: '# Example' }
const access = { scope: JSON.stringify([settings.apiBaseUrl, settings.userId, settings.authToken, 'org', '', '']), organizationId: 'org', name: 'Synthetic', canRead: true, canWrite: true }

test('canonical numeric Thought identities, absent modified time, list rows without article bodies', () => {
    expect(contentItem(thought, 'thoughts').id).toBe('42')
    expect(contentItem(thought, 'thoughts').updatedAt).toBeUndefined()
    expect(contentItem({ ...article, content: undefined }, 'articles').body).toBeUndefined()
    for (const id of [0, -1, 1.2, '0', '../42', Number.MAX_SAFE_INTEGER + 1]) expect(() => contentItem({ ...thought, id }, 'thoughts')).toThrow()
    expect(articleId('example')).toBe('example.md')
    for (const id of ['.secret', '../escape', 'a/b', 'a%2fb']) expect(() => articleId(id)).toThrow()
    expect(() => assertItemScope(contentItem(article, 'articles'), null)).toThrow()
})
test('writer authority is tied to current account, original content scope and both impersonation states', () => {
    requireWriter(settings, access, contentItem(article, 'articles'))
    for (const changed of [{ ...settings, authToken: 'other' }, { ...settings, impersonationToken: 'imp' }, { ...settings, impersonatingUserId: 'target' }, { ...settings, selectedOrganizationId: 'elsewhere' }]) expect(() => requireWriter(changed, access)).toThrow()
    expect(() => requireWriter(settings, access, { ...contentItem(article, 'articles'), organizationId: null })).toThrow()
})
test('correct Thought lookup is a read-only POST; save uses registered PUT and accepts actual 201 PG rows', async () => {
    const requests: { url: string; init: RequestInit }[] = []
    const api = createPublishingApi(settings, 'thoughts', async (_, url, init) => {
        requests.push({ url, init })
        return Response.json(url.endsWith('thought/title') ? [thought] : { result: { rows: [thought] }, message: 'Updated' }, { status: url.endsWith('thought/title') ? 200 : 201 })
    })
    expect((await api.findThought(thought.title, signal()))[0].id).toBe('42')
    expect((await api.mutate(access, { action: 'update', original: contentItem(thought, 'thoughts'), draft: { id: '42', body: thought.title } }, signal())).id).toBe('42')
    expect(requests.map(row => [new URL(row.url).pathname, row.init.method])).toEqual([['/api/thought/title', 'POST'], ['/api/thought/42', 'PUT']])
    const headers = new Headers(requests[1].init.headers)
    expect(headers.get('Authorization')).toBe('Bearer synthetic-token')
    expect(headers.get('id')).toBe('synthetic')
    expect(headers.get('x-organization-id')).toBe('org')
})
test('article create receipt is canonical; wrong receipt and failed durable transport stay uncertain without retry', async () => {
    let calls = 0
    const api = createPublishingApi(settings, 'articles', async () => { calls++; return Response.json({ created: true, name: 'wrong.md' }, { status: 201 }) })
    await expect(api.mutate(access, { action: 'create', draft: { id: 'example', body: '# Example' } }, signal())).rejects.toMatchObject({ uncertain: true })
    expect(calls).toBe(1)
    const failed = createPublishingApi(settings, 'articles', async () => { calls++; return Response.json({ error: 'Git failed after write' }, { status: 500 }) })
    await expect(failed.mutate(access, { action: 'create', draft: { id: 'example', body: '# Example' } }, signal())).rejects.toMatchObject({ uncertain: true, status: 500 })
    expect(calls).toBe(2)
})
test('permissions fail closed for malformed/missing lifecycle and refresh picks current active role', async () => {
    for (const lifecycleStatus of [undefined, 'paused', 'deleted', 'active']) {
        const api = createPublishingApi(settings, 'articles', async () => Response.json({ organizations: [{ id: 'org', name: 'Org', role: 'editor', lifecycleStatus }] }))
        expect((await api.access(signal())).canWrite).toBe(lifecycleStatus === 'active')
    }
})
test('scope mismatch, unauthorized status, and malformed saved Thought never become receipts', async () => {
    const api = createPublishingApi(settings, 'thoughts', async () => Response.json({ ...thought, organization_id: 'other' }, { status: 201 }))
    await expect(api.mutate(access, { action: 'create', draft: { id: '', body: thought.title } }, signal())).rejects.toMatchObject({ uncertain: true })
    const denied = createPublishingApi(settings, 'articles', async () => Response.json({ error: 'Denied' }, { status: 403 }))
    await expect(denied.list(signal())).rejects.toMatchObject({ status: 403 })
})
test('bounded transport covers held body, pre-aborted request sends nothing', async () => {
    let calls = 0
    const api = createPublishingApi(settings, 'articles', async () => { calls++; return { status: 201, ok: true, text: () => new Promise(() => {}) } as unknown as Response }, 5)
    const c = new AbortController(); c.abort()
    await expect(api.list(c.signal)).rejects.toBeInstanceOf(PublishingError)
    expect(calls).toBe(0)
    await expect(api.mutate(access, { action: 'create', draft: { id: 'example', body: '# Text' } }, signal())).rejects.toMatchObject({ uncertain: true })
    expect(calls).toBe(1)
})
test('generic Markdown parser preserves GFM and never evaluates publishing formula text; safe links reject credentials and handle failures', async () => {
    expect(markdownBlocks('| **A** | B |\n| --- | --- |\n| =SUMMARIZE(A1:A1) | x |')[0].rows[0][0].text).toBe('=SUMMARIZE(A1:A1)')
    for (const value of ['https://user:secret@example.invalid', 'javascript:alert(1)', 'file:///secret', 'https://a.invalid/\n']) expect(safeLink(value)).toBeNull()
    expect(safeLink('mailto:someone@example.invalid')).not.toBeNull()
    let errors = 0, opens = 0
    await openMarkdownLink('https://example.invalid', async () => { opens++; throw new Error('Unavailable') }, () => { errors++ })
    await openMarkdownLink('https://user:secret@example.invalid', async () => { opens++ }, () => { errors++ })
    expect([opens, errors]).toEqual([1, 2])
})
test('search and sorting operate on the actual unpaginated server list without assuming bodies', () => {
    const one = contentItem({ ...article, content: undefined }, 'articles')
    expect(filterContent([one], 'example', 'newest')).toHaveLength(1)
    expect(filterContent([one], 'missing', 'title')).toHaveLength(0)
})
