import { beforeEach, expect, mock, test } from 'bun:test'
import type { AppSettings } from '../types'
import type { SupportTicket } from './profile-api'
let calls: Array<{ url: string; init: RequestInit }> = []
let respond = () => Response.json({ tickets: [] })
mock.module('react-native', () => ({ Platform: { OS: 'ios' } }))
mock.module('react-native-passkeys', () => ({ create: async () => null, isSupported: () => false }))
mock.module('./api', () => ({ apiFetch: async (_settings: AppSettings, url: string, init: RequestInit) => { calls.push({ url, init }); return respond() } }))
const { AccountRequestError, fetchAccountSupportTickets, fetchSupportMessages, sendSupportMessage, sendSupportFeedback, supportTicketAccess, supportAccountScope } = await import('./profile-api')
const settings = { apiBaseUrl: 'https://api.example.test/api', userId: 'synthetic-owner', authToken: 'synthetic-session', impersonationToken: '', impersonatingUserId: '', selectedOrganizationId: 'unrelated-org' } as AppSettings
const id = '11111111-1111-4111-8111-111111111111'
const ticket = (change: Partial<SupportTicket> = {}): SupportTicket => ({ id, user_id: settings.userId, subject: 'Synthetic question', status: 'closed', resolution_version: 3, feedback_rating: null, updated_at: '2026-10-23T10:00:00Z', ...change })
beforeEach(() => { calls = []; respond = () => Response.json({ tickets: [] }) })

test('Support customer feed retains server lifecycle, ownership and resolution data', async () => {
    respond = () => Response.json({ tickets: [ticket()], isSupport: false })
    expect(await fetchAccountSupportTickets(settings)).toEqual([ticket()])
    expect(calls[0].url).toBe('https://support.hanasand.com/api/support/my-tickets')
    expect(calls[0].init.credentials).toBe('omit')
    expect(new Headers(calls[0].init.headers).get('id')).toBe(settings.userId)
    expect(new Headers(calls[0].init.headers).get('x-organization-id')).toBeNull()
})
test('message read uses exact route and caller cancellation', async () => {
    respond = () => Response.json({ messages: [] })
    const controller = new AbortController()
    await fetchSupportMessages(settings, id, controller.signal)
    expect(calls[0].url).toBe(`https://support.hanasand.com/api/support/tickets/${id}/messages`)
    controller.abort(); expect(calls[0].init.signal?.aborted).toBe(true)
})
test('customer write authority is server-owned open/closed state, never organization membership', () => {
    expect(supportTicketAccess(settings, ticket({ status: 'open' }))).toMatchObject({ canReply: true, canFeedback: false })
    expect(supportTicketAccess(settings, ticket())).toMatchObject({ canReply: false, canFeedback: true })
    for (const row of [ticket({ user_id: 'foreign' }), ticket({ user_id: undefined }), ticket({ status: 'unknown' })]) expect(supportTicketAccess(settings, row)).toMatchObject({ canReply: false, canFeedback: false })
    for (const row of [ticket({ resolution_version: undefined }), ticket({ resolution_version: -1 }), ticket({ feedback_rating: 4 }), ticket({ feedback_rating: undefined })]) expect(supportTicketAccess(settings, row).canFeedback).toBe(false)
})
test('either impersonation field disables writes and feedback before transport', async () => {
    for (const changed of [{ impersonationToken: 'synthetic-impersonation' }, { impersonatingUserId: 'other' }]) {
        const value = { ...settings, ...changed }
        expect(supportTicketAccess(value, ticket()).ownAccount).toBe(false)
        expect(() => sendSupportMessage(value, id, '', 'hello')).toThrow('own account')
        expect(() => sendSupportFeedback(value, ticket(), 3, 'feedback')).toThrow('own account')
    }
    expect(calls).toHaveLength(0)
})
test('closed owned feedback sends exact version and low-rating text without an actor or role', async () => {
    respond = () => Response.json({ ok: true })
    await sendSupportFeedback(settings, ticket(), 3, '  useful feedback  ')
    expect(calls[0].url).toBe(`https://support.hanasand.com/api/support/tickets/${id}/feedback`)
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ rating: 3, comment: 'useful feedback', resolutionVersion: 3 })
    await sendSupportFeedback(settings, ticket(), 5, 'not sent for high rating')
    expect(JSON.parse(String(calls[1].init.body)).comment).toBe('')
})
test('invalid feedback and foreign/open tickets never send a request', () => {
    for (const row of [ticket({ user_id: 'foreign' }), ticket({ status: 'open' }), ticket({ resolution_version: undefined })]) expect(() => sendSupportFeedback(settings, row, 3, '')).toThrow('Refresh')
    for (const rating of [0, 6, 2.5]) expect(() => sendSupportFeedback(settings, ticket(), rating, '')).toThrow('stars')
    expect(() => sendSupportFeedback(settings, ticket(), 2, 'x'.repeat(2001))).toThrow('2,000')
    expect(calls).toHaveLength(0)
})
test('409 preserves status and leaves the supplied feedback draft/version unchanged with no retry', async () => {
    const original = ticket(); const before = JSON.stringify(original)
    respond = () => Response.json({ error: 'Refresh this resolution.' }, { status: 409 })
    try { await sendSupportFeedback(settings, original, 2, 'keep draft'); throw new Error('Expected conflict') }
    catch (error) { expect(error).toBeInstanceOf(AccountRequestError); expect((error as InstanceType<typeof AccountRequestError>).status).toBe(409) }
    expect(JSON.stringify(original)).toBe(before); expect(calls).toHaveLength(1)
})
test('create and reply preserve actual API contracts; stable reply UUID is forwarded unchanged', async () => {
    respond = () => Response.json({ id })
    await sendSupportMessage(settings, '', ' Subject ', ' Message ')
    expect(calls[0].url).toBe('https://support.hanasand.com/api/support/tickets')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ subject: 'Subject', message: 'Message' })
    respond = () => Response.json({ ok: true, messageId: id })
    await sendSupportMessage(settings, id, '', 'Reply', id)
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ message: 'Reply', requestId: id })
})
test('uncertain create/reply/feedback failures issue exactly one request and never claim success', async () => {
    for (const work of [() => sendSupportMessage(settings, '', 'question', 'message'), () => sendSupportMessage(settings, id, '', 'reply', id), () => sendSupportFeedback(settings, ticket(), 3, '')]) {
        calls = []; respond = () => { throw new Error('synthetic offline') }
        await expect(work()).rejects.toThrow('offline'); expect(calls).toHaveLength(1)
    }
    respond = () => Response.json({})
    await expect(sendSupportMessage(settings, '', 'question', 'message')).rejects.toThrow('not confirmed')
    await expect(sendSupportFeedback(settings, ticket(), 3, '')).rejects.toThrow('not confirmed')
})
test('scope changes on account/session/service/either impersonation but not selected organization', () => {
    const key = supportAccountScope(settings)
    for (const change of [{ userId: 'other' }, { authToken: 'another-session' }, { apiBaseUrl: 'https://other.test/api' }, { impersonationToken: 'impersonated' }, { impersonatingUserId: 'other' }]) expect(supportAccountScope({ ...settings, ...change })).not.toBe(key)
    expect(supportAccountScope({ ...settings, selectedOrganizationId: 'different-org' })).toBe(key)
})

// Account/session remount and cancellation are separate guards: the old read is
// aborted, and its eventual payload is not accepted by the component after abort.
test('cancelled account read exposes its aborted signal even if transport resolves late', async () => {
    let finish!: (response: Response) => void
    const delayed = new Promise<Response>(resolve => { finish = resolve })
    respond = (() => delayed) as unknown as typeof respond
    const controller = new AbortController()
    const read = fetchAccountSupportTickets(settings, controller.signal)
    controller.abort()
    expect(calls[0].init.signal?.aborted).toBe(true)
    expect(supportAccountScope({ ...settings, userId: 'another-account' })).not.toBe(supportAccountScope(settings))
    finish(Response.json({ tickets: [ticket()] }))
    // The helper preserves transport semantics; UI's abort/scope guard discards it.
    expect(await read).toEqual([ticket()])
})
