export function canApplyThesisRead(ticket: { operation: number; authorization: number }, current: { operation: number; authorization: number; pending: boolean }) {
    return !current.pending && ticket.operation === current.operation && ticket.authorization === current.authorization
}
export function canEditThesisInput(value: { alive: boolean; generation: number; currentGeneration: number; canEdit: boolean; unknown: boolean; conflict: boolean; recovering: boolean }) {
    return value.alive && value.generation === value.currentGeneration && value.canEdit && !value.unknown && !value.conflict && !value.recovering
}
export function thesisInputKey(label: string, host: number) { return `${label}:${host}` }
export function canReadThesis(value: { alive: boolean; generation: number; currentGeneration: number; reading: boolean; saving: boolean }) {
    return value.alive && value.generation === value.currentGeneration && !value.reading && !value.saving
}
export function thesisActionKey(host: number, row: number, col: number) { return `${host}:${row}:${col}` }
export function thesisGoalKey(host: number, row: number, index: number, text: string) { return `${host}:${row}:${index}:${text}` }
export function sourceReviewMatches(action: { id: string; sha256: string; reviewHash: string }, current?: { id: string; sha256: string; reviewHash: string }, detail?: { id: string; sha256: string; reviewHash: string }) {
    return !!current && !!detail && [current, detail].every(item => item.id === action.id && item.sha256 === action.sha256 && item.reviewHash === action.reviewHash)
}
export function canRestoreThesisAfterFlush(review: { epoch: number; contentVersion: number }, current: { epoch: number; contentVersion: number; visible: boolean; sameModel: boolean; canEdit: boolean; dirty: boolean; pending: boolean; unknown: boolean; conflict: boolean }) {
    return current.visible && current.sameModel && current.canEdit && review.epoch === current.epoch && review.contentVersion === current.contentVersion
        && !current.dirty && !current.pending && !current.unknown && !current.conflict
}
