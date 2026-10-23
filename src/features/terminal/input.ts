/** Retire native targets only at operation/context boundaries, never on ordinary typing. */
export class TerminalInputFence {
    revision = 0
    permits(capturedRevision: number, ready: boolean): boolean {
        return ready && capturedRevision === this.revision
    }
    retire(): number { return ++this.revision }
}
