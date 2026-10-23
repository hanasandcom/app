export function canApplyThesisRead(ticket: { operation: number; authorization: number }, current: { operation: number; authorization: number; pending: boolean }) {
    return !current.pending && ticket.operation === current.operation && ticket.authorization === current.authorization
}
export function canEditThesisInput(value: { alive: boolean; generation: number; currentGeneration: number; canEdit: boolean; unknown: boolean; conflict: boolean; recovering: boolean }) {
    return value.alive && value.generation === value.currentGeneration && value.canEdit && !value.unknown && !value.conflict && !value.recovering
}
export function thesisInputKey(label: string, host: number) { return `${label}:${host}` }
