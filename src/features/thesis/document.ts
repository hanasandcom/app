export type ThesisDocument = { title: string; body: string; revision: number }
export const BODY_LIMIT = 1_000_000

export function document(value: unknown): ThesisDocument {
    const data = value as ThesisDocument | null
    if (!data || typeof data.title !== 'string' || !data.title.trim() || data.title.length > 500 || /[\r\n]/.test(data.title)
        || typeof data.body !== 'string' || data.body.length > BODY_LIMIT || !Number.isSafeInteger(data.revision) || data.revision < 0) {
        throw new Error('The thesis response is invalid. Your draft is unchanged.')
    }
    return { title: data.title, body: data.body, revision: data.revision }
}

export const sameContent = (a: ThesisDocument, b: ThesisDocument) => a.title === b.title && a.body === b.body

export class ThesisState {
    base: ThesisDocument
    draft: ThesisDocument
    conflict: ThesisDocument | null = null
    unknown = false
    pending = false
    operation = 0
    private undoStack: ThesisDocument[] = []
    private redoStack: ThesisDocument[] = []
    private lastEdit = 0
    private group = ''
    private sent: ThesisDocument | null = null

    constructor(initial: ThesisDocument) { this.base = document(initial); this.draft = { ...this.base } }
    get dirty() { return !sameContent(this.base, this.draft) }
    get canUndo() { return !this.conflict && this.undoStack.length > 0 }
    get canRedo() { return !this.conflict && this.redoStack.length > 0 }

    edit(next: ThesisDocument, group = '', now = Date.now()) {
        if (typeof next.title !== 'string' || next.title.length > 500 || /[\r\n]/.test(next.title) || typeof next.body !== 'string' || next.body.length > BODY_LIMIT) throw new Error('The draft exceeded its limits.')
        if (sameContent(this.draft, next)) return
        if (!group || group !== this.group || now - this.lastEdit > 750) {
            this.undoStack.push({ ...this.draft })
            if (this.undoStack.length > 50) this.undoStack.shift()
        }
        this.redoStack = []
        this.group = group; this.lastEdit = now
        this.draft = { ...next, revision: this.base.revision }
    }

    undo(redo = false) {
        if (this.conflict || this.pending) return
        const source = redo ? this.redoStack : this.undoStack
        const next = source.pop()
        if (!next) return
        ;(redo ? this.undoStack : this.redoStack).push(this.draft)
        this.draft = { ...next, revision: this.base.revision }; this.group = ''
    }

    receive(value: ThesisDocument, manual = false) {
        const remote = document(value)
        if (remote.revision < this.base.revision) return
        if (manual) this.unknown = false
        if (this.pending && this.sent && sameContent(remote, this.sent)) {
            this.base = remote; this.draft = { ...this.draft, revision: remote.revision }
            return
        }
        if (sameContent(remote, this.draft)) {
            this.base = remote; this.draft = { ...remote }; this.conflict = null
        } else if (!this.dirty) {
            this.base = remote; this.draft = { ...remote }; this.conflict = null
            this.undoStack = []; this.redoStack = []
        } else if (!sameContent(this.base, remote)) this.conflict = remote
    }

    beginSave() {
        if (this.pending || this.unknown || this.conflict || !this.dirty) throw new Error('Refresh and resolve this draft before saving.')
        document(this.draft)
        this.pending = true; this.operation++
        this.sent = { ...this.draft, revision: this.base.revision }
        return this.sent
    }

    saved(sent: ThesisDocument, value: ThesisDocument) {
        const saved = document(value)
        if (!sameContent(sent, saved)) throw new Error('The saved response does not match this draft.')
        this.pending = false; this.unknown = false; this.sent = null
        if (saved.revision < this.base.revision) return
        this.base = saved
        // An accepted save must not erase text typed while it was in flight.
        this.draft = { ...this.draft, revision: saved.revision }
        if (!this.conflict || this.conflict.revision <= saved.revision) this.conflict = null
    }

    failed(remote?: ThesisDocument) {
        this.pending = false; this.sent = null
        if (remote) this.conflict = document(remote)
        else this.unknown = true
    }

    resolve(useLocal: boolean) {
        if (this.pending || this.unknown || !this.conflict) return
        this.base = this.conflict
        this.draft = useLocal ? { ...this.draft, revision: this.base.revision } : { ...this.base }
        this.conflict = null; this.undoStack = []; this.redoStack = []
    }
}
