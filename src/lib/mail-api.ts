import * as Crypto from 'expo-crypto'
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
export type MailDraft = { mailboxUser: string; to: string; cc: string; bcc: string; subject: string; textBody: string }

const mailBaseUrl = (process.env.EXPO_PUBLIC_MAIL_API_BASE_URL || 'https://mail.hanasand.com/api').replace(/\/+$/, '')
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
