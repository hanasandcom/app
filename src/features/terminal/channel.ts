/** Parent owns authentication, transport deadlines and socket closure. No credentials belong here. */
export type TerminalEvent =
    | { type: 'state'; state: 'connecting' | 'ready' | 'closed'; message?: string }
    | { type: 'output'; data: string }

export interface TerminalChannel {
    /** Unique connection nonce, including account/VM context; never a token. */
    id: string
    /** Must synchronously deliver the latest state to a new subscriber. */
    subscribe(listener: (event: TerminalEvent) => void): () => void
    input(data: string): boolean
    resize(cols: number, rows: number): void
}
