import { matchedPrivacyOutcome, type PrivacyAction, type PrivacyState } from './model'

export type PrivacyIntent = { action: PrivacyAction; requestId: string }
type Ticket = { generation: number; sequence: number; manual: boolean }
export class PrivacyController {
    generation = 0
    visible = false
    pending = false
    reading = false
    locked = false
    unknown?: PrivacyIntent
    private sequence = 0
    private controller?: AbortController
    private manual?: Ticket
    current(generation: number) { return this.visible && generation === this.generation }
    usable(generation: number) { return this.current(generation) && !this.pending && !this.reading }
    invalidate() { this.generation++; this.controller?.abort(); this.controller = undefined; this.manual = undefined }
    hide() { if (this.pending) this.locked = true; this.visible = false; this.pending = false; this.reading = false; this.invalidate() }
    navigate(capturedGeneration: number) {
        if (!this.usable(capturedGeneration)) return false
        this.invalidate()
        return true
    }
    beginRead(capturedGeneration: number, manual: boolean) {
        if (!this.usable(capturedGeneration)) return null
        this.invalidate(); this.reading = true
        const ticket = { generation: this.generation, sequence: ++this.sequence, manual }
        if (manual) this.manual = ticket
        this.controller = new AbortController()
        return { ticket, controller: this.controller }
    }
    finishRead(ticket: Ticket, state: PrivacyState) {
        if (!this.current(ticket.generation)) return false
        this.reading = false
        if (ticket === this.manual) {
            this.manual = undefined
            if (!this.unknown || matchedPrivacyOutcome(state, this.unknown)) { this.unknown = undefined; this.locked = false }
        }
        this.generation++
        return true
    }
    failRead(ticket: Ticket) {
        if (!this.current(ticket.generation)) return false
        this.reading = false; this.locked = true; this.manual = undefined; this.generation++
        return true
    }
    beginWrite(capturedGeneration: number, intent: PrivacyIntent) {
        if (!this.usable(capturedGeneration) || this.locked) return null
        this.invalidate(); this.pending = true; this.unknown = intent; this.locked = true
        this.controller = new AbortController()
        return { generation: this.generation, controller: this.controller }
    }
    finishWrite(generation: number, confirmed: boolean) {
        if (!this.current(generation)) return false
        this.pending = false
        if (confirmed) this.unknown = undefined
        this.generation++
        return true
    }
}
