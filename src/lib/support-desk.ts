import type { AppSettings } from '../types'
import { accountRequest, AccountRequestError, supportBase, type SupportMessage, type SupportTicket } from './profile-api'

export type DeskFilters = { search: string; from: string; to: string; stars: string; feedback: string; status: 'open' | 'resolved' | 'all' }
export type DeskTicket = SupportTicket & { user_name?: string; agent_name?: string; channel?: string; last_message?: string; reply_count?: number; created_at?: string }
export type SupportDesk = { scope: string; isSupport: boolean; realtime: boolean; tickets: DeskTicket[] }
export const emptyDeskFilters: DeskFilters = { search: '', from: '', to: '', stars: 'all', feedback: 'all', status: 'open' }
export const supportDeskScope = (settings: AppSettings) => JSON.stringify([
    supportBase(), settings.siteBaseUrl, settings.userId, settings.authToken,
    settings.impersonationToken, settings.impersonatingUserId, settings.selectedOrganizationId
])
export function canEditDeskInput(state: {
    alive: boolean; visible: boolean; allowed: boolean; reading: boolean; writing: boolean; locked: boolean
    ticket: string; selected: string
}) {
    return state.alive && state.visible && state.allowed && !state.reading && !state.writing && !state.locked
        && !!state.ticket && state.ticket === state.selected
}
export class SupportDeskError extends Error {
    constructor(message: string, readonly uncertain = false, readonly status = 0) { super(message) }
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
function ticketId(id: string) {
    if (!idPattern.test(id)) throw new SupportDeskError('Choose a valid support conversation.')
    return encodeURIComponent(id)
}
export function validDeskDate(value: string) {
    if (!value) return true
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
        && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}
export function deskFilterQuery(filters: DeskFilters) {
    if (filters.search.length > 160 || !validDeskDate(filters.from) || !validDeskDate(filters.to)
        || filters.from && filters.to && filters.from > filters.to
        || !['all', 'rated', 'unrated', '1', '2', '3', '4', '5'].includes(filters.stars)
        || !['all', 'comment', 'none'].includes(filters.feedback)
        || !['open', 'resolved', 'all'].includes(filters.status)) throw new SupportDeskError('Check the search, dates and feedback filters.')
    const query = new URLSearchParams()
    if (filters.search.trim()) query.set('search', filters.search.trim())
    if (filters.from) query.set('from', filters.from)
    if (filters.to) query.set('to', filters.to)
    if (filters.stars !== 'all') query.set('stars', filters.stars)
    if (filters.feedback !== 'all') query.set('feedback', filters.feedback)
    return query.toString() ? `?${query}` : ''
}
export function visibleDeskTickets(tickets: DeskTicket[], status: DeskFilters['status']) {
    return tickets.filter(ticket => status === 'all' || (status === 'resolved' ? ticket.status === 'closed' : ticket.status !== 'closed'))
}
async function request(settings: AppSettings, path: string, signal?: AbortSignal, body?: unknown, method = 'POST'): Promise<Record<string, unknown>> {
    const base = new URL(supportBase())
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new SupportDeskError('Support requires a secure service address.')
    if (!settings.userId || !settings.authToken) throw new SupportDeskError('Sign in to view Support.', false, 401)
    const controller = new AbortController(), cancel = () => controller.abort()
    const timer = setTimeout(cancel, 20000)
    if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel)
    try {
        if (controller.signal.aborted) throw new SupportDeskError('Support request cancelled.')
        const result = await accountRequest<unknown>(settings, path, {
            signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error',
            method: body === undefined ? 'GET' : method, body: body === undefined ? undefined : JSON.stringify(body)
        }, supportBase())
        if (controller.signal.aborted) throw new SupportDeskError('Support request cancelled.', body !== undefined)
        return record(result)
    } catch (cause) {
        const status = cause instanceof AccountRequestError ? cause.status : cause instanceof SupportDeskError ? cause.status : 0
        throw new SupportDeskError(status === 401 ? 'Sign in again to use Support.'
            : status === 403 ? 'Support access could not be verified. Refresh before changing this conversation.'
                : status === 409 ? 'This conversation changed. Refresh and review it before trying again.'
                    : body !== undefined ? 'The operation outcome is unknown. Refresh and review the conversation before another change.'
                        : 'Support is unavailable. Refresh to try again.', body !== undefined, status)
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel) }
}
export async function loadSupportDesk(settings: AppSettings, filters: DeskFilters, signal?: AbortSignal): Promise<SupportDesk> {
    const data = await request(settings, `support/tickets${deskFilterQuery(filters)}`, signal)
    if (typeof data.isSupport !== 'boolean' || typeof data.realtime !== 'boolean' || !Array.isArray(data.tickets)
        || data.tickets.length > 100) throw new SupportDeskError('Support returned an incomplete queue. Refresh to try again.')
    const tickets = data.tickets.map(value => {
        const row = record(value)
        if (typeof row.id !== 'string' || !idPattern.test(row.id) || typeof row.subject !== 'string'
            || typeof row.status !== 'string' || typeof row.updated_at !== 'string') throw new SupportDeskError('Support returned an invalid conversation.')
        const optional = (key: string) => typeof row[key] === 'string' ? row[key] as string : undefined
        return {
            id: row.id, subject: row.subject, status: row.status, updated_at: row.updated_at,
            user_id: optional('user_id') || null, user_name: optional('user_name'),
            agent_name: optional('agent_name'), channel: optional('channel'), last_message: optional('last_message'),
            created_at: optional('created_at'), feedback_comment: optional('feedback_comment') || null,
            feedback_rating: Number.isInteger(row.feedback_rating) && Number(row.feedback_rating) >= 1 && Number(row.feedback_rating) <= 5 ? Number(row.feedback_rating) : null,
            resolution_version: Number.isSafeInteger(row.resolution_version) && Number(row.resolution_version) >= 0 ? Number(row.resolution_version) : undefined,
            reply_count: Number.isSafeInteger(row.reply_count) && Number(row.reply_count) >= 0 ? Number(row.reply_count) : undefined
        }
    })
    return { scope: supportDeskScope(settings), isSupport: data.isSupport, realtime: data.realtime, tickets }
}
export function requireSupportAgent(settings: AppSettings, desk: SupportDesk, ticket: DeskTicket) {
    if (!desk.isSupport || desk.scope !== supportDeskScope(settings) || settings.impersonationToken
        || settings.impersonatingUserId || !desk.tickets.some(row => row.id === ticket.id)) {
        throw new SupportDeskError('Refresh verified Support access in your own account before making changes.')
    }
}
export async function loadDeskMessages(settings: AppSettings, id: string, signal?: AbortSignal) {
    const data = await request(settings, `support/tickets/${ticketId(id)}/messages`, signal)
    if (!Array.isArray(data.messages)) throw new SupportDeskError('Support messages are unavailable.')
    return data.messages.map(value => {
        const row = record(value)
        if (typeof row.id !== 'string' || typeof row.body !== 'string' || typeof row.created_at !== 'string') throw new SupportDeskError('Support returned an invalid message.')
        return { id: row.id, body: row.body, created_at: row.created_at,
            sender_id: typeof row.sender_id === 'string' ? row.sender_id : null,
            sender_name: typeof row.sender_name === 'string' ? row.sender_name : 'Unknown sender' } as SupportMessage
    })
}
export async function replyToDeskTicket(settings: AppSettings, desk: SupportDesk, ticket: DeskTicket, message: string, requestId: string, signal?: AbortSignal) {
    requireSupportAgent(settings, desk, ticket)
    if (ticket.status === 'closed' || !message.trim() || message.length > 10000 || !idPattern.test(requestId)) throw new SupportDeskError('Reopen the conversation and enter a message under 10,000 characters.')
    const data = await request(settings, `support/tickets/${ticketId(ticket.id)}/messages`, signal, { message: message.trim(), requestId })
    if (data.ok !== true || typeof data.messageId !== 'string' || !idPattern.test(data.messageId)) throw new SupportDeskError('The reply was not confirmed. Refresh before sending again.', true)
    return data.messageId
}
export async function setDeskTicketStatus(settings: AppSettings, desk: SupportDesk, ticket: DeskTicket, status: 'open' | 'closed', signal?: AbortSignal) {
    requireSupportAgent(settings, desk, ticket)
    if (!['open', 'closed'].includes(status)) throw new SupportDeskError('Choose an open or resolved conversation.')
    const data = await request(settings, `support/tickets/${ticketId(ticket.id)}/status`, signal, { status })
    const changed = record(data.ticket)
    if (data.ok !== true || changed.id !== ticket.id || changed.status !== status) throw new SupportDeskError('The status change was not confirmed. Refresh before changing it again.', true)
}
export function validateSupportAccountChange(field: 'password' | 'email', value: string) {
    if (field === 'password' ? value.length < 16 || value.length > 1024 : value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new SupportDeskError(field === 'password' ? 'Use a password of 16–1,024 characters.' : 'Enter a valid email address.')
}
export async function changeDeskAccount(settings: AppSettings, desk: SupportDesk, ticket: DeskTicket, field: 'password' | 'email', value: string, signal?: AbortSignal) {
    requireSupportAgent(settings, desk, ticket)
    if (!ticket.user_id || ticket.channel !== 'human') throw new SupportDeskError('Choose an account-linked human support conversation.')
    validateSupportAccountChange(field, value)
    const data = await request(settings, `support/tickets/${ticketId(ticket.id)}/account/${field}`, signal, { [field]: value }, field === 'email' ? 'PUT' : 'POST')
    if (data.ok !== true) throw new SupportDeskError('The account update was not confirmed. Refresh before trying again.', true)
}
