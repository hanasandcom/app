export type SystemIntent = { token: string; kind: 'restart' | 'cleanup'; target: string }
const copy = (v: SystemIntent): SystemIntent => ({ token: v.token, kind: v.kind, target: v.target })
export class SystemIntents {
    private values = new Map<string, SystemIntent>()
    constructor(private maximum = 64) {}
    get(scope: string) { const v = this.values.get(scope); return v ? copy(v) : undefined }
    claim(scope: string, value: SystemIntent) {
        if (this.values.has(scope) || this.values.size >= this.maximum) return false
        this.values.set(scope, copy(value)); return true
    }
    clear(scope: string, token: string) { if (this.values.get(scope)?.token !== token) return false; this.values.delete(scope); return true }
}
const intents = new SystemIntents()
type ReadTicket = { generation: number; manual: boolean; intent?: string }
export class SystemController {
    visible = false
    generation = 0
    reading = false
    writing = false
    needsReview = false
    private abort?: AbortController
    private reviewed?: string
    constructor(private scope: string, private registry = intents) {}
    get unknown() { return this.registry.get(this.scope) }
    get locked() { return this.needsReview || !!this.unknown }
    get canAcknowledge() { return !!this.unknown && this.reviewed === this.unknown.token }
    current(g: number) { return this.visible && this.generation === g }
    usable(g: number) { return this.current(g) && !this.reading && !this.writing }
    context(g: number) { if (!this.usable(g)) return false; this.generation++; this.reviewed = undefined; return true }
    hide() { this.visible = false; this.generation++; this.abort?.abort(); this.reading = false; this.writing = false; this.reviewed = undefined }
    beginRead(g: number, manual: boolean) {
        if (!this.usable(g)) return null
        this.generation++; this.reading = true; this.reviewed = undefined; this.abort = new AbortController()
        return { ticket: { generation: this.generation, manual, intent: this.unknown?.token }, controller: this.abort }
    }
    finishRead(ticket: ReadTicket, success: boolean) {
        if (!this.current(ticket.generation)) return false
        this.reading = false
        if (!success) this.needsReview = true
        else if (ticket.manual) {
            if (!this.unknown) this.needsReview = false
            else if (ticket.intent === this.unknown.token) this.reviewed = ticket.intent
        }
        this.generation++; return true
    }
    beginWrite(g: number, value: SystemIntent) {
        if (!this.usable(g) || this.locked || !this.registry.claim(this.scope, value)) return null
        this.generation++; this.writing = true; this.needsReview = true; this.reviewed = undefined; this.abort = new AbortController()
        return { generation: this.generation, controller: this.abort, intent: copy(value) }
    }
    finishWrite(g: number, value: SystemIntent, confirmed: boolean) {
        if (!this.current(g)) return false
        if (confirmed) this.registry.clear(this.scope, value.token)
        this.writing = false; this.generation++; return true
    }
    acknowledge(g: number, token: string) {
        if (!this.usable(g) || this.reviewed !== token || !this.registry.clear(this.scope, token)) return false
        this.reviewed = undefined; this.needsReview = false; this.generation++; return true
    }
}
