export type CaseIntent = { token: string; kind: 'update' | 'merge' | 'connect' | 'disconnect' | 'link'; target: string; repository?: string }
export class CaseIntents {
    private values = new Map<string, CaseIntent>()
    constructor(private maximum = 64) {}
    get(scope: string) { const v = this.values.get(scope); return v ? { ...v } : undefined }
    claim(scope: string, value: CaseIntent) { if (this.values.has(scope) || this.values.size >= this.maximum) return false; this.values.set(scope, { ...value }); return true }
    clear(scope: string, token: string) { if (this.values.get(scope)?.token !== token) return false; this.values.delete(scope); return true }
}
const intents = new CaseIntents()
export type ReadTicket = { generation: number; manual: boolean; intent?: string }
export class CaseController {
    generation = 0
    visible = false
    reading = false
    writing = false
    needsRead = true
    private abort?: AbortController
    private reviewed?: string
    constructor(private scope: string, private registry = intents) {}
    get unknown() { return this.registry.get(this.scope) }
    get locked() { return this.needsRead || !!this.unknown }
    get canAcknowledge() { return !!this.unknown && this.reviewed === this.unknown.token }
    current(g: number) { return this.visible && this.generation === g }
    idle(g: number) { return this.current(g) && !this.reading && !this.writing }
    context(g: number) { if (!this.idle(g)) return false; this.generation++; this.reviewed = undefined; return true }
    hide() { this.visible = false; this.generation++; this.abort?.abort(); this.reading = false; this.writing = false; this.needsRead = true; this.reviewed = undefined }
    beginRead(g: number, manual: boolean) {
        if (!this.idle(g)) return null
        this.generation++; this.reading = true; this.reviewed = undefined; this.needsRead = true; this.abort = new AbortController()
        return { ticket: { generation: this.generation, manual, intent: this.unknown?.token }, controller: this.abort }
    }
    finishRead(ticket: ReadTicket, complete: boolean) {
        if (!this.current(ticket.generation)) return false
        this.reading = false; this.needsRead = !complete
        if (complete && ticket.manual && ticket.intent && this.unknown?.token === ticket.intent) this.reviewed = ticket.intent
        this.generation++; return true
    }
    beginWrite(g: number, intent: CaseIntent) {
        if (!this.idle(g) || this.locked || !this.registry.claim(this.scope, intent)) return null
        this.generation++; this.writing = true; this.needsRead = true; this.reviewed = undefined; this.abort = new AbortController()
        return { generation: this.generation, controller: this.abort }
    }
    finishWrite(g: number, intent: CaseIntent, definite: boolean) {
        if (!this.current(g)) return false
        if (definite) this.registry.clear(this.scope, intent.token)
        this.writing = false; this.generation++; return true
    }
    acknowledge(g: number, token: string) {
        if (!this.idle(g) || this.needsRead || this.reviewed !== token || !this.registry.clear(this.scope, token)) return false
        this.reviewed = undefined; this.generation++; return true
    }
}

export type CaseContext = { selected: string; panel: string; repository: string }
export function caseCallbackAllowed(ops: CaseController, generation: number, expected: CaseContext, current: CaseContext, expectedDraft = '', currentDraft = '') {
    return expectedDraft === currentDraft && ops.idle(generation) && !ops.locked && expected.selected === current.selected && expected.panel === current.panel && expected.repository === current.repository
}

export function caseReadComplete(kind: CaseIntent['kind'] | undefined, reads: { list: boolean; detail: boolean; repositories: boolean; development: boolean; connection: boolean }) {
    return reads.list && reads.detail
        && (!kind || !['connect', 'disconnect', 'link'].includes(kind) || reads.repositories)
        && (kind !== 'link' || reads.development) && (kind !== 'connect' || reads.connection)
}
