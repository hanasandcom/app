import type { AppSettings } from '../../types'
import { identifier, intentScope, own, sessionScope, type Access, type Directory } from './model'
export type Intent = { token: string; action: 'create' | 'update' | 'revoke'; target: string }
export class AccountIntents {
    private entries = new Map<string, Intent>()
    constructor(private capacity = 64) {}
    get(scope: string) { const value = this.entries.get(scope); return value ? { ...value } : undefined }
    claim(scope: string, value: Intent) {
        if (this.entries.has(scope) || this.entries.size >= this.capacity || !['create', 'update', 'revoke'].includes(value.action) || !/^[A-Za-z0-9-]{1,100}$/.test(value.token)) return false
        identifier(value.target); this.entries.set(scope, { token: value.token, action: value.action, target: value.target }); return true
    }
    clear(scope: string, token: string) { if (this.entries.get(scope)?.token !== token) return false; this.entries.delete(scope); return true }
}
const accountIntents = new AccountIntents()
export type ReadTicket = { generation: number; manual: boolean; intent?: string; signal: AbortSignal }
export type Review = { generation: number; revision: number; action: Intent['action']; target: string }
export type Operation = Intent & { generation: number; signal: AbortSignal }
export class AccountController {
    visible = false; generation = 0; revision = 0; reading = false; writing = false; needsRead = true; canWrite = false
    private readonly scope: string; private readonly session: string; private readonly own: boolean
    private abort?: AbortController; private read?: ReadTicket; private operation?: Operation; private reviewed?: string
    constructor(settings: AppSettings, private registry = accountIntents) { this.scope = intentScope(settings); this.session = sessionScope(settings); this.own = own(settings) }
    get unknown() { return this.registry.get(this.scope) }
    get locked() { return this.needsRead || !!this.unknown }
    get canAcknowledge() { return this.canWrite && !this.needsRead && !!this.unknown && this.reviewed === this.unknown.token }
    current(g: number) { return this.visible && g === this.generation }
    idle(g: number) { return this.current(g) && !this.reading && !this.writing }
    sessionCurrent(settings: AppSettings) { return this.visible && this.session === sessionScope(settings) }
    private retire() { this.generation++; this.revision++; this.abort?.abort(); this.abort = undefined; this.read = undefined; this.reviewed = undefined }
    hide() { this.visible = false; this.retire(); this.operation = undefined; this.reading = false; this.writing = false; this.needsRead = true; this.canWrite = false }
    navigate(g: number) { if (!this.idle(g)) return false; this.retire(); return true }
    edit(g: number) { if (!this.idle(g) || this.locked || !this.canWrite) return false; this.revision++; return true }
    beginRead(g: number, manual: boolean): ReadTicket | null {
        if (!this.idle(g)) return null
        this.retire(); this.reading = true; this.needsRead = true; this.canWrite = false; this.abort = new AbortController()
        this.read = { generation: this.generation, manual, intent: this.unknown?.token, signal: this.abort.signal }; return this.read
    }
    finishRead(ticket: ReadTicket, access: Access | null, directory: Directory | null) {
        if (!this.current(ticket.generation) || this.read !== ticket) return false
        const readable = !!access && access.scope === this.session && access.canRead && !!directory
        this.canWrite = readable && !!access?.canWrite && this.own
        this.reading = false; this.needsRead = !readable; this.read = undefined
        const unknown = this.unknown
        if (readable && this.canWrite && ticket.manual && unknown && ticket.intent === unknown.token
            && (unknown.action === 'create' || directory!.accounts.some(row => row.id === unknown.target))) this.reviewed = unknown.token
        this.generation++; this.revision++; return true
    }
    review(g: number, action: Intent['action'], target: string): Review | null {
        if (!this.idle(g) || this.locked || !this.canWrite || !this.own) return null
        return { generation: g, revision: this.revision, action, target: identifier(target) }
    }
    begin(review: Review, token: string): Operation | null {
        if (!this.idle(review.generation) || this.locked || !this.canWrite || !this.own || review.revision !== this.revision || !this.registry.claim(this.scope, { token, action: review.action, target: review.target })) return null
        this.retire(); this.writing = true; this.needsRead = true; this.canWrite = false; this.abort = new AbortController()
        this.operation = { token, action: review.action, target: review.target, generation: this.generation, signal: this.abort.signal }; return this.operation
    }
    operationCurrent(op: Operation) { return this.current(op.generation) && this.writing && this.operation === op && !op.signal.aborted }
    finish(op: Operation, definite: boolean) {
        if (!this.operationCurrent(op)) return false
        if (definite) this.registry.clear(this.scope, op.token)
        this.writing = false; this.operation = undefined; this.generation++; this.revision++; return true
    }
    acknowledge(g: number, token: string) {
        if (!this.idle(g) || !this.canAcknowledge || !this.registry.clear(this.scope, token)) return false
        this.reviewed = undefined; this.generation++; this.revision++; return true
    }
}
