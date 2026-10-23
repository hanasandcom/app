import { beforeEach, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { AppSettings } from '../types'
const calls: Array<{ path: string; init: RequestInit; base: string }> = []
let respond: () => unknown = () => ({})
class TestAccountError extends Error { constructor(message: string, readonly status: number) { super(message) } }
mock.module('./profile-api', () => ({
    supportBase: () => 'https://support.synthetic.invalid/api', AccountRequestError: TestAccountError,
    accountRequest: async (_settings: AppSettings, path: string, init: RequestInit, base: string) => {
        calls.push({ path, init, base }); return respond()
    }
}))
const api = await import('./support-desk')
const settings = { siteBaseUrl: 'https://synthetic.invalid', apiBaseUrl: 'https://api.synthetic.invalid/api',
    userId: 'synthetic-agent', authToken: 'synthetic-token', selectedOrganizationId: 'workspace-one',
    impersonationToken: '', impersonatingUserId: '' } as AppSettings
const id = '11111111-1111-4111-8111-111111111111', messageId = '22222222-2222-4222-8222-222222222222'
const ticket = { id, subject: 'Synthetic customer', user_id: 'synthetic-customer', channel: 'human', status: 'open', updated_at: '2026-10-23T06:00:00Z' }
const desk = () => ({ scope: api.supportDeskScope(settings), isSupport: true, realtime: true, tickets: [ticket] })
beforeEach(() => { calls.length = 0; respond = () => ({}) })
test('queue sends canonical filters to Support, keeps status local and projects harmless optional values', async () => {
    respond = () => ({ isSupport: true, realtime: true, tickets: [{ ...ticket, user_name: { invalid: true }, feedback_rating: 99, secret: 'discard-this' }] })
    const result = await api.loadSupportDesk(settings, { ...api.emptyDeskFilters, search: ' customer ', from: '2026-10-01', stars: 'rated', feedback: 'comment', status: 'resolved' })
    expect(calls[0].base).toBe('https://support.synthetic.invalid/api')
    expect(calls[0].path).toBe('support/tickets?search=customer&from=2026-10-01&stars=rated&feedback=comment')
    expect(calls[0].init.method).toBe('GET'); expect(calls[0].init.credentials).toBe('omit')
    expect(result.isSupport).toBe(true); expect(result.tickets[0].user_name).toBeUndefined()
    expect(JSON.stringify(result)).not.toContain('discard-this')
    expect(api.visibleDeskTickets(result.tickets, 'resolved')).toEqual([])
})
test('invalid dates and filter enums fail before any request, with empty/error states distinct', async () => {
    for (const change of [{ from: '2026-02-30' }, { from: '2026-10-02', to: '2026-10-01' }, { stars: '6' }, { feedback: 'arbitrary' }])
        expect(() => api.deskFilterQuery({ ...api.emptyDeskFilters, ...change })).toThrow()
    expect(calls).toHaveLength(0)
    for (const body of [{}, { tickets: [] }, { isSupport: false, realtime: true }, { isSupport: true, realtime: true, tickets: [{}] }]) {
        respond = () => body; await expect(api.loadSupportDesk(settings, api.emptyDeskFilters)).rejects.toThrow()
    }
    respond = () => ({ isSupport: false, realtime: true, tickets: [] })
    expect((await api.loadSupportDesk(settings, api.emptyDeskFilters)).tickets).toEqual([])
})
test('writer authority requires current server queue, own account, session and workspace', async () => {
    for (const current of [
        { ...settings, authToken: 'new' }, { ...settings, userId: 'new' }, { ...settings, selectedOrganizationId: 'new' },
        { ...settings, impersonationToken: 'synthetic-impersonation' }, { ...settings, impersonatingUserId: 'synthetic-target' }
    ]) await expect(api.replyToDeskTicket(current, desk(), ticket, 'Reply', messageId)).rejects.toThrow('verified Support')
    await expect(api.replyToDeskTicket(settings, { ...desk(), isSupport: false }, ticket, 'Reply', messageId)).rejects.toThrow()
    await expect(api.setDeskTicketStatus(settings, { ...desk(), tickets: [] }, ticket, 'closed')).rejects.toThrow()
    expect(calls).toHaveLength(0)
})
test('reply preserves explicit idempotency UUID and never retries a lost response', async () => {
    respond = () => ({ ok: true, messageId })
    expect(await api.replyToDeskTicket(settings, desk(), ticket, '  Reply  ', messageId)).toBe(messageId)
    expect(calls[0].path).toBe(`support/tickets/${id}/messages`)
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ message: 'Reply', requestId: messageId })
    calls.length = 0; respond = () => { throw new Error('synthetic lost response') }
    await expect(api.replyToDeskTicket(settings, desk(), ticket, 'Reply', messageId)).rejects.toMatchObject({ uncertain: true })
    expect(calls).toHaveLength(1)
    calls.length = 0
    await expect(api.replyToDeskTicket(settings, desk(), { ...ticket, status: 'closed' }, 'Reply', messageId)).rejects.toThrow()
    expect(calls).toHaveLength(0)
})
test('status changes require a matching durable ticket receipt', async () => {
    respond = () => ({ ok: true, ticket: { id, status: 'closed' } })
    await api.setDeskTicketStatus(settings, desk(), ticket, 'closed')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ status: 'closed' })
    for (const body of [{ ok: true }, { ok: true, ticket: { id: messageId, status: 'closed' } }, { ok: true, ticket: { id, status: 'open' } }]) {
        respond = () => body; await expect(api.setDeskTicketStatus(settings, desk(), ticket, 'closed')).rejects.toMatchObject({ uncertain: true })
    }
})
test('account changes use exact method/body, with credentials absent from URL and list projection', async () => {
    respond = () => ({ ok: true })
    await api.changeDeskAccount(settings, desk(), ticket, 'password', 'synthetic-only-password-value')
    expect(calls[0].init.method).toBe('POST'); expect(calls[0].path).toBe(`support/tickets/${id}/account/password`)
    expect(calls[0].path).not.toContain('synthetic-only-password-value')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ password: 'synthetic-only-password-value' })
    await api.changeDeskAccount(settings, desk(), ticket, 'email', 'person@synthetic.invalid')
    expect(calls[1].init.method).toBe('PUT')
    for (const [field, value] of [['password', 'short'], ['email', 'invalid']] as const)
        await expect(api.changeDeskAccount(settings, desk(), ticket, field, value)).rejects.toThrow()
    await expect(api.changeDeskAccount(settings, desk(), { ...ticket, user_id: null }, 'email', 'person@synthetic.invalid')).rejects.toThrow()
    expect(calls).toHaveLength(2)
})
test('service failures preserve recovery status without echoing private payloads', async () => {
    for (const status of [401, 403, 409, 500]) {
        respond = () => { throw new TestAccountError('private-input-password', status) }
        let error: unknown
        try { await api.setDeskTicketStatus(settings, desk(), ticket, 'closed') } catch (cause) { error = cause }
        expect(error).toBeInstanceOf(api.SupportDeskError)
        expect(String(error)).not.toContain('private-input-password')
        expect((error as InstanceType<typeof api.SupportDeskError>).status).toBe(status)
        expect((error as InstanceType<typeof api.SupportDeskError>).uncertain).toBe(true)
    }
})
test('aborted reads do not start, and late writes cannot produce acknowledged results', async () => {
    const already = new AbortController(); already.abort()
    await expect(api.loadSupportDesk(settings, api.emptyDeskFilters, already.signal)).rejects.toThrow()
    expect(calls).toHaveLength(0)
    let finish!: (value: unknown) => void
    respond = () => new Promise(resolve => { finish = resolve })
    const controller = new AbortController()
    const result = api.replyToDeskTicket(settings, desk(), ticket, 'Reply', messageId, controller.signal).catch(error => error)
    controller.abort(); finish({ ok: true, messageId })
    expect(await result).toBeInstanceOf(api.SupportDeskError)
    expect(calls[0].init.signal?.aborted).toBe(true)
})
test('native screen retains explicit-only uncertainty reconciliation and scoped confirmations', () => {
    const source = readFileSync(new URL('../screens/SupportDeskScreen.tsx', import.meta.url).pathname, 'utf8')
    expect(source).toContain('review.current !== version')
    expect(source).toContain('selectedId.current !== target')
    expect(source).toContain('writing.current.abort()')
    expect(source).toContain('if (explicit) { locked.current = false')
    expect(source).toContain('key={supportDeskScope(settings)}')
})
