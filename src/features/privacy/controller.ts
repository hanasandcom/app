import { matchedPrivacyOutcome, type PrivacyAction, type PrivacyState } from './model'

export type PrivacyIntent = { action: PrivacyAction; requestId: string }
type Ticket = { generation: number; sequence: number; manual: boolean; intent?: PrivacyIntent }
const sameIntent = (left: PrivacyIntent | undefined, right: PrivacyIntent | undefined) => !!left && !!right && left.action === right.action && left.requestId === right.requestId
const copyIntent = (intent: PrivacyIntent): PrivacyIntent => ({ action: intent.action, requestId: intent.requestId })
export class PrivacyIntentRegistry {
    private readonly entries = new Map<string, PrivacyIntent>()
    constructor(private readonly maximum = 128) {}
    get size() { return this.entries.size }
    get(scope: string) {
        const intent = this.entries.get(scope)
        return intent ? copyIntent(intent) : undefined
    }
    claim(scope: string, intent: PrivacyIntent) {
        if (!scope || scope.length > 4096 || this.entries.has(scope) || this.entries.size >= this.maximum
            || !['export', 'run_retention', 'delete'].includes(intent.action) || !/^[A-Za-z0-9_.:@-]{1,200}$/.test(intent.requestId)) return false
        this.entries.set(scope, copyIntent(intent))
        return true
    }
    clear(scope: string, expected: PrivacyIntent) {
        if (!sameIntent(this.entries.get(scope), expected)) return false
        this.entries.delete(scope)
        return true
    }
}
// Unresolved writes are never silently evicted. At capacity, another write is refused before dispatch.
const sessionIntents = new PrivacyIntentRegistry()
export class PrivacyController {
    generation = 0
    visible = false
    pending = false
    reading = false
    blockedReason = ''
    private reviewRequired = false
    private localUnknown?: PrivacyIntent
    private activeIntent?: PrivacyIntent
    private sequence = 0
    private controller?: AbortController
    private manual?: Ticket
    constructor(private readonly intentScope?: string, private readonly intents = sessionIntents) {}
    get unknown() { return this.intentScope ? this.intents.get(this.intentScope) : this.localUnknown }
    get locked() { return this.reviewRequired || !!this.unknown }
    current(generation: number) { return this.visible && generation === this.generation }
    usable(generation: number) { return this.current(generation) && !this.pending && !this.reading }
    invalidate() { this.generation++; this.controller?.abort(); this.controller = undefined; this.manual = undefined }
    hide() { if (this.pending) this.reviewRequired = true; this.visible = false; this.pending = false; this.reading = false; this.invalidate() }
    navigate(capturedGeneration: number) {
        if (!this.usable(capturedGeneration)) return false
        this.invalidate()
        return true
    }
    beginRead(capturedGeneration: number, manual: boolean) {
        if (!this.usable(capturedGeneration)) return null
        this.invalidate(); this.reading = true
        const ticket = { generation: this.generation, sequence: ++this.sequence, manual, intent: this.unknown }
        if (manual) this.manual = ticket
        this.controller = new AbortController()
        return { ticket, controller: this.controller }
    }
    finishRead(ticket: Ticket, state: PrivacyState) {
        if (!this.current(ticket.generation)) return false
        this.reading = false
        if (ticket === this.manual) {
            this.manual = undefined
            const unknown = this.unknown
            if (!unknown) this.reviewRequired = false
            else if (sameIntent(unknown, ticket.intent) && matchedPrivacyOutcome(state, unknown)) {
                this.clearIntent(unknown)
                this.reviewRequired = !!this.unknown
            }
        }
        this.generation++
        return true
    }
    failRead(ticket: Ticket) {
        if (!this.current(ticket.generation)) return false
        this.reading = false; this.reviewRequired = true; this.manual = undefined; this.generation++
        return true
    }
    beginWrite(capturedGeneration: number, intent: PrivacyIntent) {
        this.blockedReason = ''
        if (!this.usable(capturedGeneration) || this.locked) return null
        if (this.intentScope && !this.intents.claim(this.intentScope, intent)) {
            this.blockedReason = 'Another request is unresolved, or the unresolved-request limit has been reached. Review earlier requests before continuing.'
            return null
        }
        if (!this.intentScope) this.localUnknown = copyIntent(intent)
        this.activeIntent = copyIntent(intent)
        this.invalidate(); this.pending = true; this.reviewRequired = true
        this.controller = new AbortController()
        return { generation: this.generation, controller: this.controller }
    }
    finishWrite(generation: number, confirmed: boolean) {
        if (!this.current(generation)) return false
        this.pending = false
        if (confirmed && this.activeIntent) this.clearIntent(this.activeIntent)
        this.activeIntent = undefined
        this.generation++
        return true
    }
    private clearIntent(expected: PrivacyIntent) {
        if (this.intentScope) this.intents.clear(this.intentScope, expected)
        else if (sameIntent(this.localUnknown, expected)) this.localUnknown = undefined
    }
}
