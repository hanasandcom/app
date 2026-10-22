import { beforeEach, describe, expect, it, mock } from 'bun:test'

const calls: Array<{ url: string; init: RequestInit }> = []
const reads: string[] = []
const files = new Map<string, { size: number; content: string; error?: string }>()
let pickerResult: { canceled: boolean; assets: Array<{ uri: string; name: string; mimeType?: string; size?: number }> | null }
let pickerOptions: unknown
let status = 201
let responseBody: unknown = { ok: true }
let uuid = 0
let transportFailure = false
mock.module('./api', () => ({ apiFetch: async (_settings: unknown, url: string, init: RequestInit) => {
    calls.push({ url, init })
    if (transportFailure) throw new Error('Network connection lost')
    return new Response(JSON.stringify(responseBody), { status })
} }))
mock.module('expo-crypto', () => ({ randomUUID: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}` }))
mock.module('expo-document-picker', () => ({ getDocumentAsync: async (options: unknown) => { pickerOptions = options; return pickerResult } }))
mock.module('expo-file-system', () => ({
    Paths: { cache: '/cache' },
    File: class {
        constructor(public uri: string) {}
        get exists() { return files.has(this.uri) }
        get size() { return files.get(this.uri)?.size || 0 }
        get name() { return 'file.bin' }
        async base64() {
            reads.push(this.uri)
            const file = files.get(this.uri)!
            if (file.error) throw new Error(file.error)
            return file.content
        }
    },
}))
const api = await import('./mail-api')
const settings = { authToken: 'synthetic-token', userId: 'synthetic-user', impersonationToken: '' } as Parameters<typeof api.sendMail>[0]
function choose(name: string, content: string, options: { mimeType?: string; reportedSize?: number; actualSize?: number; error?: string } = {}) {
    const uri = `file:///cache/${encodeURIComponent(name)}`
    files.set(uri, { size: options.actualSize ?? Buffer.from(content, 'base64').byteLength, content, error: options.error })
    return { uri, name, mimeType: options.mimeType, size: options.reportedSize }
}
beforeEach(() => {
    calls.length = 0; reads.length = 0; files.clear(); uuid = 0; status = 201; responseBody = { ok: true }; pickerOptions = undefined; transportFailure = false
    pickerResult = { canceled: true, assets: null }
})

describe('native mail outgoing attachments', () => {
    it('preserves the composer and send key when Files selection is cancelled', async () => {
        const composer = api.createMailComposer('shared:support')
        expect(await api.pickMailAttachments(composer.draft)).toBeNull()
        expect(pickerOptions).toEqual({ multiple: true, copyToCacheDirectory: true, type: '*/*' })
        expect(api.editMailComposer(composer, {})).toBe(composer)
        expect(reads).toEqual([])
        expect(calls).toEqual([])
    })

    it('reads actual cached file bytes, supports multiple files, and never sends device URIs', async () => {
        const composer = api.editMailComposer(api.createMailComposer('shared:support'), { to: 'recipient@example.test' })
        pickerResult = { canceled: false, assets: [choose('receipt.pdf', 'SGk=', { mimeType: 'application/pdf', reportedSize: 0 }), choose('image.png', 'AQID', { mimeType: 'image/png' })] }
        const attachments = await api.pickMailAttachments(composer.draft)
        expect(attachments).toEqual([
            { name: 'receipt.pdf', type: 'application/pdf', size: 2, contentBase64: 'SGk=' },
            { name: 'image.png', type: 'image/png', size: 3, contentBase64: 'AQID' },
        ])
        const ready = api.editMailComposer(composer, { attachments: attachments! })
        expect(api.canSendMail(ready.draft)).toBe(true)
        expect(ready.idempotencyKey).not.toBe(composer.idempotencyKey)
        await api.sendMail(settings, ready.draft, ready.idempotencyKey)
        expect(calls[0].url).toBe('https://mail.hanasand.com/api/mail/send')
        const payload = JSON.parse(String(calls[0].init.body))
        expect(payload.attachments).toEqual(attachments)
        expect(payload.mailboxUser).toBe('shared:support')
        expect(String(calls[0].init.body)).not.toContain('file:///')
        expect(new Headers(calls[0].init.headers).get('Idempotency-Key')).toBe(ready.idempotencyKey)
    })

    it('keeps identical attachment payload and key for retries, then rotates key after removal', async () => {
        let composer = api.editMailComposer(api.createMailComposer('owner'), { to: 'recipient@example.test' })
        pickerResult = { canceled: false, assets: [choose('one.txt', 'MQ=='), choose('two.txt', 'Mg==')] }
        composer = api.editMailComposer(composer, { attachments: (await api.pickMailAttachments(composer.draft))! })
        transportFailure = true
        await expect(api.sendMail(settings, composer.draft, composer.idempotencyKey)).rejects.toThrow('Network connection lost')
        transportFailure = false
        await api.sendMail(settings, composer.draft, composer.idempotencyKey)
        expect(calls[0].init.body).toBe(calls[1].init.body)
        expect(new Headers(calls[0].init.headers).get('Idempotency-Key')).toBe(new Headers(calls[1].init.headers).get('Idempotency-Key'))
        const removed = api.editMailComposer(composer, { attachments: composer.draft.attachments.filter((_, index) => index !== 0) })
        expect(removed.idempotencyKey).not.toBe(composer.idempotencyKey)
        expect(removed.draft.attachments.map(item => item.name)).toEqual(['two.txt'])
        expect(reads).toHaveLength(2)
    })

    it('rejects oversized selections before reading Base64, including existing attachments and Unicode text', async () => {
        const composer = api.editMailComposer(api.createMailComposer('owner'), { to: 'recipient@example.test', textBody: 'Ø😀'.repeat(100), attachments: [{ name: 'existing', type: 'text/plain', size: 1, contentBase64: 'MQ==' }] })
        pickerResult = { canceled: false, assets: [choose('too-big.bin', '', { actualSize: 20 * 1024 * 1024, reportedSize: 1 })] }
        await expect(api.pickMailAttachments(composer.draft)).rejects.toThrow('25 MB')
        expect(reads).toHaveLength(0)
        expect(composer.draft.attachments).toHaveLength(1)
        expect(calls).toHaveLength(0)
    })

    it('leaves existing attachments intact when any file read fails or changes size', async () => {
        const composer = api.editMailComposer(api.createMailComposer('owner'), { attachments: [{ name: 'existing', type: 'text/plain', size: 1, contentBase64: 'MQ==' }] })
        pickerResult = { canceled: false, assets: [choose('good.txt', 'Mg=='), choose('missing.txt', 'Mw==', { error: 'File permission denied' })] }
        await expect(api.pickMailAttachments(composer.draft)).rejects.toThrow('permission denied')
        expect(composer.draft.attachments.map(item => item.name)).toEqual(['existing'])
        pickerResult = { canceled: false, assets: [choose('changed.txt', 'Mg==', { actualSize: 12 })] }
        await expect(api.pickMailAttachments(composer.draft)).rejects.toThrow('changed while reading')
        expect(calls).toHaveLength(0)
    })

    it('handles zero-byte files, missing MIME types, and provider filenames safely', async () => {
        const composer = api.createMailComposer('owner')
        pickerResult = { canceled: false, assets: [choose('../\r\nempty.txt', '')] }
        expect(await api.pickMailAttachments(composer.draft)).toEqual([{ name: 'empty.txt', type: 'application/octet-stream', size: 0, contentBase64: '' }])
        pickerResult = { canceled: false, assets: [{ uri: 'https://remote.example.test/file', name: 'file' }] }
        await expect(api.pickMailAttachments(composer.draft)).rejects.toThrow('copied to this device')
    })

    it('counts exact UTF-8 request bytes and refuses oversized sends without network calls', async () => {
        const composer = api.editMailComposer(api.createMailComposer('owner'), { to: 'recipient@example.test', textBody: 'Ø 😀 \\ \n', attachments: [{ name: '日本語.pdf', type: 'application/pdf', size: 2, contentBase64: 'SGk=' }] })
        expect(api.mailSendBodyBytes(composer.draft)).toBe(new TextEncoder().encode(JSON.stringify(composer.draft)).byteLength)
        const huge = { ...composer.draft, textBody: 'a'.repeat(api.mailSendBodyLimit) }
        await expect(api.sendMail(settings, huge, composer.idempotencyKey)).rejects.toThrow('25 MB')
        expect(calls).toHaveLength(0)
    })

    it('uses the actual service rule for subjectless messages and attachment-only drafts', async () => {
        const empty = api.createMailComposer('owner').draft
        expect(api.canSendMail(empty)).toBe(false)
        expect(api.hasMailDraftContent(empty)).toBe(false)
        const addressed = { ...empty, to: 'recipient@example.test' }
        expect(api.canSendMail(addressed)).toBe(false)
        expect(api.canSendMail({ ...addressed, textBody: 'Message without a subject' })).toBe(true)
        expect(api.hasMailDraftContent({ ...empty, attachments: [{ name: 'empty', type: 'text/plain', size: 0, contentBase64: '' }] })).toBe(true)
        await expect(api.sendMail(settings, addressed, 'unused')).rejects.toThrow('Add a recipient')
        expect(calls).toHaveLength(0)
    })
})
