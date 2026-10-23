export type CustomerSupportInputState = {
    mounted: boolean
    writing: boolean
    locked: boolean
    generation: number
    selection: string
}
export function canEditCustomerSupportInput(current: CustomerSupportInputState, generation: number, selection: string) {
    return current.mounted && !current.writing && !current.locked
        && current.generation === generation && current.selection === selection
}

type CustomerSupportReadTicket = { operation: number; sequence: number; selection: string }
/** Only the one read started by a current explicit review may reconcile a write lock. */
export class CustomerSupportReviews {
    private operation = 0
    private sequence = 0
    private pending?: CustomerSupportReadTicket
    private eligible?: CustomerSupportReadTicket
    requestManual(selection: string) {
        const ticket = { operation: this.operation, sequence: ++this.sequence, selection }
        this.pending = ticket; this.eligible = ticket
    }
    beginRead() {
        const ticket = this.pending
        this.pending = undefined
        return ticket
    }
    finishRead(ticket: CustomerSupportReadTicket | undefined, selection: string, success: boolean) {
        if (!ticket || ticket !== this.eligible) return false
        this.eligible = undefined
        return success && ticket.operation === this.operation && ticket.selection === selection
    }
    invalidate() { this.operation++; this.pending = undefined; this.eligible = undefined }
}
export function canRefreshCustomerSupport(current: Omit<CustomerSupportInputState, 'locked'>, generation: number, selection: string) {
    return current.mounted && !current.writing && current.generation === generation && current.selection === selection
}
