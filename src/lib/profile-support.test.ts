import { beforeEach, expect, mock, test } from 'bun:test'
import type { AppSettings } from '../types'
import type { SupportTicket } from './profile-api'
let calls: Array<{ url: string; init: RequestInit }> = []
let respond = () => Response.json({ tickets: [] })
mock.module('react-native', () => ({ Platform: { OS: 'ios' }, Alert: {}, Text: 'Text', TextInput: 'TextInput', View: 'View' }))
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
test('message read uses exact route and detaches caller cancellation after settlement', async () => {
    respond = () => Response.json({ messages: [] })
    const controller = new AbortController()
    await fetchSupportMessages(settings, id, controller.signal)
    expect(calls[0].url).toBe(`https://support.hanasand.com/api/support/tickets/${id}/messages`)
    controller.abort(); expect(calls[0].init.signal?.aborted).toBe(false)
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

test('native AbortSignal without static any supports pre-abort, later abort and listener cleanup', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'any')!
    Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true })
    try {
        const pre = new AbortController(); pre.abort()
        await fetchAccountSupportTickets(settings, pre.signal)
        expect(calls[0].init.signal?.aborted).toBe(true)
        const later = new AbortController()
        let finish!: (response: Response) => void
        respond = (() => new Promise<Response>(resolve => { finish = resolve })) as unknown as typeof respond
        const pending = fetchAccountSupportTickets(settings, later.signal)
        later.abort(); expect(calls[1].init.signal?.aborted).toBe(true)
        finish(Response.json({ tickets: [] })); await pending
        respond = () => Response.json({ tickets: [] })
        const settled = new AbortController()
        await fetchAccountSupportTickets(settings, settled.signal)
        settled.abort()
        expect(calls[2].init.signal?.aborted).toBe(false)
    } finally { Object.defineProperty(AbortSignal, 'any', descriptor) }
})
test('ticket paths accept UUID versions1–8 instead of artificially rejecting version7 records', async () => {
    respond = () => Response.json({ messages: [] })
    await fetchSupportMessages(settings, '11111111-1111-7111-8111-111111111111')
    expect(calls[0].url).toEndWith('/11111111-1111-7111-8111-111111111111/messages')
})

// The navigation transition is the same state used by the panel's conditional
// list/conversation/composer rendering. GUI coverage uses the100-ticket fixture.
mock.module('expo-crypto', () => ({ randomUUID: () => id }))
mock.module('../components/ui', () => ({ GlassCard: 'GlassCard', InlineNotice: 'InlineNotice', PillButton: 'PillButton', SectionTitle: 'SectionTitle' }))
mock.module('../theme/context', () => ({ useAppTheme: () => ({}) }))
const { supportNavigation, canEditSupportDraft } = await import('../components/ProfileSupportPanel')
test('Support opens one focused task and Back retains the conversation identity for draft-safe resume', () => {
    const initial = { mode: 'list' as const, ticketId: '' }
    const opened = supportNavigation(initial, { ticketId: id })
    expect(opened).toEqual({ mode: 'conversation', ticketId: id })
    const back = supportNavigation(opened, 'back')
    expect(back).toEqual({ mode: 'list', ticketId: id })
    expect(supportNavigation(back, { ticketId: id })).toEqual(opened)
    const composing = supportNavigation(back, 'new')
    expect(composing).toEqual({ mode: 'new', ticketId: '' })
    expect(supportNavigation(supportNavigation(composing, 'back'), 'new')).toEqual(composing)
})

test('queued keyboard events cannot replace submitted text while writing or awaiting outcome review', () => {
    for (const state of [{ writing: true, blocked: false }, { writing: false, blocked: true }, { writing: true, blocked: true }]) {
        let draft = 'uncertain123'
        if (canEditSupportDraft(state.writing, state.blocked)) draft = 'late autocorrect'
        expect(draft).toBe('uncertain123')
    }
    expect(canEditSupportDraft(false, false)).toBe(true)
})


test('customer Support native targets cannot restore cleared text or retarget another conversation', async () => {
    const { canEditCustomerSupportInput } = await import('./profile-support')
    const state = { mounted: true, writing: false, locked: false, generation: 0, selection: 'first' }
    let draft = 'Retained body', hostGeneration = -1, target = 0
    const targets = new Map<number, (value: string) => void>()
    function commit() {
        if (hostGeneration !== state.generation) { targets.delete(target); target++; hostGeneration = state.generation }
        const generation = state.generation, selection = state.selection
        targets.set(target, value => { if (canEditCustomerSupportInput(state, generation, selection)) draft = value })
        return target
    }
    const dispatch = (id: number, value: string) => targets.get(id)?.(value)
    const beforeSend = commit()
    dispatch(beforeSend, 'Retained body'); expect(commit()).toBe(beforeSend)
    state.writing = true; state.generation++
    dispatch(beforeSend, 'Queued before commit'); expect(draft).toBe('Retained body')
    commit(); state.generation++; draft = ''; commit()
    state.writing = false; state.generation++; const idle = commit()
    dispatch(beforeSend, 'Restore after send idle'); expect(draft).toBe('')
    dispatch(idle, 'New unsent body'); expect(draft).toBe('New unsent body')
    state.generation++; state.selection = 'second'; commit()
    dispatch(idle, 'Retarget old conversation'); expect(draft).toBe('New unsent body')
    state.writing = true; state.generation++; commit()
    // Uncertain and failed outcomes retain draft state outside the replaced native input.
    state.locked = true; state.writing = false; state.generation++; const locked = commit()
    dispatch(locked, 'Overwrite unknown body'); expect(draft).toBe('New unsent body')
    state.generation++; state.locked = false; const reviewed = commit()
    dispatch(reviewed, 'Corrected body'); expect(draft).toBe('Corrected body')
    for (const change of [{ mounted: false }, { writing: true }, { locked: true }, { generation: state.generation + 1 }, { selection: 'third' }])
        expect(canEditCustomerSupportInput({ ...state, ...change }, state.generation, state.selection)).toBe(false)
    const source = await Bun.file(new URL('../components/ProfileSupportPanel.tsx', import.meta.url)).text()
    expect(source).toContain('<TextInput key={`support:${nativeKey}`}')
    expect(source).toContain('generation: inputGeneration.current, selection: selectedId.current }, capturedGeneration, ticketId)')
    expect(source).toContain('submitting.current = true; renewInputs()')
    expect(source).toContain('finally { submitting.current = false; if (mounted.current) { renewInputs(); setBusy(false) } }')
    expect(source).toContain('Back/resume keeps drafts, conflict and request UUID.')
    const edit = source.slice(source.indexOf('function edit('), source.indexOf('function select('))
    expect(edit).not.toContain('renewInputs()')
})


test('focused form replacement removes delayed rating and Send targets across submit and selection', async () => {
    const { canEditCustomerSupportInput } = await import('./profile-support')
    const state = { mounted: true, writing: false, locked: false, generation: 0, selection: 'first' }
    let nativeTarget = 0, hostGeneration = -1, rating = 0
    const sends: string[] = [], targets = new Map<number, { send: () => void; rate: () => void }>()
    function commit() {
        if (hostGeneration !== state.generation) { targets.delete(nativeTarget); nativeTarget++; hostGeneration = state.generation }
        const generation = state.generation, selection = state.selection
        targets.set(nativeTarget, {
            send() { if (canEditCustomerSupportInput(state, generation, selection)) sends.push(selection) },
            rate() { if (canEditCustomerSupportInput(state, generation, selection)) rating = 3 }
        })
        return nativeTarget
    }
    const oldTarget = commit()
    const oldCallback = targets.get(oldTarget)!
    state.writing = true; state.generation++
    oldCallback.send(); expect(sends).toEqual([])
    commit(); state.writing = false; state.generation++; commit()
    targets.get(oldTarget)?.send(); targets.get(oldTarget)?.rate()
    expect(sends).toEqual([]); expect(rating).toBe(0)
    const beforeSelection = nativeTarget, beforeSelectionCallback = targets.get(beforeSelection)!
    state.selection = 'second'; state.generation++
    beforeSelectionCallback.send(); beforeSelectionCallback.rate()
    expect(sends).toEqual([]); expect(rating).toBe(0)
    const current = commit()
    targets.get(beforeSelection)?.send(); targets.get(beforeSelection)?.rate()
    expect(sends).toEqual([]); expect(rating).toBe(0)
    targets.get(current)?.rate(); targets.get(current)?.send()
    expect(rating).toBe(3); expect(sends).toEqual(['second'])
    const source = await Bun.file(new URL('../components/ProfileSupportPanel.tsx', import.meta.url)).text()
    expect(source).toContain('<View key={`support-form:${inputKey}:${ticketId}:${mode}`}')
    expect(source).toContain('if (!canEdit() || loading || error || !access.ownAccount) return')
})
