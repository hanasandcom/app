import * as Crypto from 'expo-crypto'
import * as DocumentPicker from 'expo-document-picker'
import { File, Paths } from 'expo-file-system'
import type { AppSettings, MailAddress, MailboxItem, MailMessageSummary } from '../types'
import { apiFetch } from './api'

export type MailAttachment = { blobId: string; name: string; type: string; size: number }
export type MailMessage = MailMessageSummary & {
    cc: MailAddress[]
    replyTo: MailAddress[]
    textBody: string
    attachments: MailAttachment[]
}
export type MailOverview = {
    mailboxUser: string
    mailboxAddress: string
    accessibleAccounts: Array<{ id: string; name: string; address: string; unreadCount?: number }>
    mailboxes: MailboxItem[]
    selectedMailboxId: string | null
    messages: MailMessage[]
    selectedMessage: MailMessage | null
    nextCursor: string | null
    canSend: boolean
    notice: string
}
export type MailScope = { mailboxUser?: string; mailboxId?: string | null }
export type MailAction = 'read' | 'unread' | 'flag' | 'unflag' | 'archive' | 'trash' | 'restore' | 'move' | 'junk' | 'ham'
export type MailDraftAttachment = { name: string; type: string; size: number; contentBase64: string }
export type MailDraft = { mailboxUser: string; to: string; cc: string; bcc: string; subject: string; textBody: string; attachments: MailDraftAttachment[] }
export type MailComposer = { draft: MailDraft; idempotencyKey: string }

// The independent Mail API limits the entire JSON request, including Base64, to 25 MiB.
export const mailSendBodyLimit = 25 * 1024 * 1024
export function createMailComposer(mailboxUser: string): MailComposer {
    return { draft: { mailboxUser, to: '', cc: '', bcc: '', subject: '', textBody: '', attachments: [] }, idempotencyKey: Crypto.randomUUID() }
}
export function editMailComposer(current: MailComposer, patch: Partial<MailDraft>): MailComposer {
    if (!(Object.keys(patch) as Array<keyof MailDraft>).some(key => patch[key] !== current.draft[key])) return current
    return { draft: { ...current.draft, ...patch }, idempotencyKey: Crypto.randomUUID() }
}
export function canSendMail(draft: MailDraft) {
    return Boolean(draft.to.trim() && (draft.subject.trim() || draft.textBody.trim() || draft.attachments.length))
}
export function hasMailDraftContent(draft: MailDraft) {
    return Boolean(draft.to || draft.cc || draft.bcc || draft.subject || draft.textBody || draft.attachments.length)
}
function utf8Bytes(value: string) {
    let bytes = 0
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index)
        if (code < 0x80) bytes += 1
        else if (code < 0x800) bytes += 2
        else if (code >= 0xd800 && code <= 0xdbff && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) { bytes += 4; index += 1 }
        else bytes += 3
    }
    return bytes
}
export function mailSendBodyBytes(draft: MailDraft) {
    const metadata = { ...draft, attachments: draft.attachments.map(item => ({ ...item, contentBase64: '' })) }
    return utf8Bytes(JSON.stringify(metadata)) + draft.attachments.reduce((sum, item) => sum + item.contentBase64.length, 0)
}
function requireMailBodyBudget(draft: MailDraft) {
    if (mailSendBodyBytes(draft) > mailSendBodyLimit) throw new Error('This message exceeds the 25 MB mail limit. Remove an attachment or shorten the message.')
}
export async function pickMailAttachments(draft: MailDraft): Promise<MailDraftAttachment[] | null> {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true, type: '*/*' })
    if (result.canceled || !result.assets.length) return null
    const candidates = result.assets.map(asset => {
        if (!asset.uri.startsWith('file://')) throw new Error('The selected file could not be copied to this device. Choose it again.')
        const file = new File(asset.uri)
        if (!file.exists || !Number.isSafeInteger(file.size) || file.size < 0) throw new Error(`Unable to read ${asset.name || 'this file'}. Choose it again.`)
        const name = (asset.name || file.name || 'attachment').split(/[\\/]/).pop()!.replace(/[\r\n\0]/g, '').trim() || 'attachment'
        const type = asset.mimeType && !/[\r\n]/.test(asset.mimeType) ? asset.mimeType : 'application/octet-stream'
        return { file, attachment: { name, type, size: file.size, contentBase64: '' } }
    })
    const metadataDraft = { ...draft, attachments: [...draft.attachments, ...candidates.map(item => item.attachment)] }
    const predictedSize = mailSendBodyBytes(metadataDraft) + candidates.reduce((sum, item) => sum + 4 * Math.ceil(item.attachment.size / 3), 0)
    if (predictedSize > mailSendBodyLimit) throw new Error('These files exceed the 25 MB mail limit. Choose fewer or smaller files.')
    const selected: MailDraftAttachment[] = []
    for (const { file, attachment } of candidates) {
        const contentBase64 = await file.base64()
        if (contentBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64)) throw new Error(`Unable to read ${attachment.name}. Choose it again.`)
        const padding = contentBase64.endsWith('==') ? 2 : contentBase64.endsWith('=') ? 1 : 0
        if (contentBase64.length / 4 * 3 - padding !== attachment.size) throw new Error(`${attachment.name} changed while reading. Choose it again.`)
        selected.push({ ...attachment, contentBase64 })
    }
    const attachments = [...draft.attachments, ...selected]
    requireMailBodyBudget({ ...draft, attachments })
    return attachments
}

const mailBaseUrl = (process.env.EXPO_PUBLIC_MAIL_API_BASE_URL || 'https://api.hanasand.com/api').replace(/\/+$/, '')
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}
const string = (value: unknown) => typeof value === 'string' ? value : ''
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : []
function addresses(value: unknown): MailAddress[] {
    return array(value).flatMap(item => {
        const entry = record(item)
        return string(entry.email) ? [{ email: string(entry.email), name: string(entry.name) }] : []
    })
}
function message(value: unknown): MailMessage | null {
    const entry = record(value)
    if (!string(entry.id)) return null
    return {
        id: string(entry.id), subject: string(entry.subject), preview: string(entry.preview), receivedAt: string(entry.receivedAt),
        from: addresses(entry.from), to: addresses(entry.to), cc: addresses(entry.cc), replyTo: addresses(entry.replyTo),
        isRead: entry.isRead === true, isFlagged: entry.isFlagged === true, hasAttachment: entry.hasAttachment === true,
        textBody: string(entry.textBody), attachments: array(entry.attachments).flatMap(item => {
            const attachment = record(item)
            return string(attachment.blobId) ? [{ blobId: string(attachment.blobId), name: string(attachment.name) || 'attachment', type: string(attachment.type), size: Number(attachment.size) || 0 }] : []
        }),
    }
}
async function request(settings: AppSettings, path: string, init: RequestInit = {}) {
    if (!settings.authToken || !settings.userId) throw new Error('Sign in to load your mail.')
    if (new URL(mailBaseUrl).protocol !== 'https:') throw new Error('Mail requires a secure HTTPS connection.')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20_000)
    let response: Response
    try {
        response = await apiFetch(settings, `${mailBaseUrl}/${path}`, {
            ...init,
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json', Authorization: `Bearer ${settings.authToken}`, id: settings.userId,
                ...(settings.impersonationToken ? { 'x-impersonation-token': settings.impersonationToken } : {}),
                ...init.headers,
            },
        })
    } catch (cause) {
        if (controller.signal.aborted) throw new Error('Mail request timed out. Please try again.', { cause })
        throw cause
    } finally {
        clearTimeout(timeout)
    }
    if (!response.ok) {
        const body = record(await response.json().catch(() => ({})))
        throw new Error(string(body.error) || `Mail request failed (${response.status}).`)
    }
    return response
}
function query(scope: MailScope, extra: Record<string, string | undefined> = {}) {
    const params = new URLSearchParams()
    if (scope.mailboxUser) params.set('mailboxUser', scope.mailboxUser)
    if (scope.mailboxId) params.set('mailboxId', scope.mailboxId)
    for (const [key, value] of Object.entries(extra)) if (value) params.set(key, value)
    return params.toString()
}
export async function loadMail(settings: AppSettings, scope: MailScope, messageId?: string): Promise<MailOverview> {
    const body = record(await (await request(settings, `mail/overview?${query(scope, { messageId })}`)).json())
    if (!string(body.mailboxUser)) throw new Error('Mail returned an unexpected account response.')
    return {
        mailboxUser: string(body.mailboxUser), mailboxAddress: string(body.mailboxAddress),
        accessibleAccounts: array(body.accessibleAccounts).flatMap(item => {
            const account = record(item)
            return string(account.id) ? [{ id: string(account.id), name: string(account.name), address: string(account.address), unreadCount: Number(account.unreadCount) || 0 }] : []
        }),
        mailboxes: array(body.mailboxes).flatMap(item => {
            const box = record(item)
            return string(box.id) ? [{ id: string(box.id), name: string(box.name), role: string(box.role), unreadEmails: Number(box.unreadEmails) || 0 }] : []
        }),
        selectedMailboxId: string(body.selectedMailboxId) || null,
        messages: array(body.messages).map(message).filter((item): item is MailMessage => item !== null),
        selectedMessage: message(body.selectedMessage), nextCursor: string(body.nextCursor) || null,
        canSend: record(body.actor).canSend !== false,
        notice: !array(body.mailboxes).length ? array(record(body.health).checks).map(item => string(record(item).detail)).filter(Boolean).join('\n') : '',
    }
}
export async function loadMailPage(settings: AppSettings, scope: MailScope, after: string) {
    const body = record(await (await request(settings, `mail/overview?${query(scope, { after })}`)).json())
    return { messages: array(body.messages).map(message).filter((item): item is MailMessage => item !== null), nextCursor: string(body.nextCursor) || null }
}
export async function searchMail(settings: AppSettings, scope: MailScope, search: string, after?: string) {
    const body = record(await (await request(settings, `mail/search?${query(scope, { query: search, after })}`)).json())
    return { messages: array(body.messages).map(message).filter((item): item is MailMessage => item !== null), nextCursor: string(body.nextCursor) || null }
}
export async function updateMail(settings: AppSettings, mailboxUser: string, messageId: string, action: MailAction, targetMailboxId?: string) {
    await request(settings, `mail/message/${encodeURIComponent(messageId)}/action`, {
        method: 'POST', body: JSON.stringify({ mailboxUser, action, targetMailboxId }),
    })
}
export async function addMailFolder(settings: AppSettings, mailboxUser: string, name: string) {
    await request(settings, 'mail/mailboxes', { method: 'POST', body: JSON.stringify({ mailboxUser, name }) })
}
export async function sendMail(settings: AppSettings, draft: MailDraft, idempotencyKey: string) {
    if (!canSendMail(draft)) throw new Error('Add a recipient and a message, subject, or attachment before sending.')
    requireMailBodyBudget(draft)
    await request(settings, 'mail/send', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(draft) })
}
export async function saveMailAttachment(settings: AppSettings, mailboxUser: string, attachment: MailAttachment) {
    const path = [mailboxUser, attachment.blobId, attachment.name].map(encodeURIComponent).join('/')
    const response = await request(settings, `mail/blob/${path}`)
    const name = attachment.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'attachment'
    const file = new File(Paths.cache, `mail-${Crypto.randomUUID()}-${name}`)
    file.write(new Uint8Array(await response.arrayBuffer()))
    return file.uri
}
