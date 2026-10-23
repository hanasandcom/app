import type { Terminal, IDisposable } from '@xterm/headless'
import type { TerminalChannel, TerminalEvent } from './channel'
import { readFrame, type TerminalFrame } from './cells'
import { loadTerminal, type TerminalConstructor } from './loader'

export type TerminalKey = 'Up' | 'Down' | 'Left' | 'Right' | 'Enter' | 'Escape' | 'Tab' | 'Backspace' | 'Home' | 'End' | 'Delete' | 'PageUp' | 'PageDown'
export interface TerminalSnapshot {
    frame: TerminalFrame; state: 'connecting' | 'ready' | 'closed'; message: string
    generation: number; cursorVisible: boolean; cursorStyle: 'block' | 'underline' | 'bar'; cursorBlink: boolean; mouse: boolean
}
const MAX_QUEUED_CHARS = 524288
const MAX_EVENT_CHARS = 131072
const MAX_INPUT_CHARS = 16384
export function terminalSize(cols: number, rows: number): [number, number] {
    return [Math.max(20, Math.min(120, Math.floor(cols) || 80)), Math.max(8, Math.min(48, Math.floor(rows) || 24))]
}

/** One parser, one connection. Overflow fails closed rather than losing or reordering output. */
export class TerminalEngine {
    readonly terminal: Terminal
    private state: TerminalSnapshot['state'] = 'connecting'
    private message = ''
    private live = true
    private generation = 0
    private queue: string[] = []
    private queuedChars = 0
    private totalChars = 0
    private writing = false
    private frameTimer?: ReturnType<typeof setTimeout>
    private unsubscribe?: () => void
    private subscriptions: IDisposable[] = []
    private cursorVisible = true
    private cursorBlink = false
    private cursorStyle: TerminalSnapshot['cursorStyle'] = 'block'
    private mouseEncoding: 'legacy' | 'utf8' | 'sgr' | 'urxvt' = 'legacy'
    private failed = false

    constructor(private channel: TerminalChannel, private changed: (snapshot: TerminalSnapshot) => void, private onFailure: (message: string) => void, factory: TerminalConstructor = loadTerminal()) {
        this.terminal = new factory({ cols: 80, rows: 24, scrollback: 1000, allowProposedApi: true, logLevel: 'off', allowTransparency: false })
        const passiveMode = (params: (number | number[])[], enabled: boolean) => {
            for (const mode of params) {
                if (mode === 25) this.cursorVisible = enabled
                if (mode === 12) this.cursorBlink = enabled
                if (mode === 1006) this.mouseEncoding = enabled ? 'sgr' : 'legacy'
                if (mode === 1005) this.mouseEncoding = enabled ? 'utf8' : 'legacy'
                if (mode === 1015) this.mouseEncoding = enabled ? 'urxvt' : 'legacy'
            }
            return false
        }
        this.subscriptions.push(
            this.terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, p => passiveMode(p, true)),
            this.terminal.parser.registerCsiHandler({ prefix: '?', final: 'l' }, p => passiveMode(p, false)),
            this.terminal.parser.registerCsiHandler({ intermediates: ' ', final: 'q' }, p => {
                const value = Number(p[0] ?? 0)
                this.cursorBlink = value === 0 || value === 1 || value === 3 || value === 5
                this.cursorStyle = value === 3 || value === 4 ? 'underline' : value === 5 || value === 6 ? 'bar' : 'block'
                return false
            }),
            this.terminal.parser.registerEscHandler({ final: 'c' }, () => {
                this.cursorVisible = true; this.cursorBlink = false; this.cursorStyle = 'block'; this.mouseEncoding = 'legacy'
                return false
            }),
            // Replies (DA/DSR) use the same ready/current gate as user input.
            this.terminal.onData(data => { this.send(data, this.generation) }),
            this.terminal.onScroll(() => this.schedule()),
        )
        let unsubscribe: () => void
        try { unsubscribe = channel.subscribe(event => this.receive(event)) }
        catch { this.dispose(); throw new Error('Terminal subscription failed') }
        // A synchronous closed/error event may dispose us during subscribe.
        if (this.live) this.unsubscribe = unsubscribe
        else unsubscribe()
        this.schedule()
    }

    private receive(event: TerminalEvent) {
        if (!this.live) return
        if (event.type === 'state') {
            if (event.state !== this.state) this.generation++
            this.state = event.state; this.message = event.message ?? ''
            if (event.state === 'closed') {
                this.generation++; this.queue = []; this.queuedChars = 0
                this.terminal.reset(); this.terminal.clear()
                const closed = this.snapshot()
                this.dispose()
                this.changed(closed)
                return
            }
            this.schedule()
            return
        }
        if (this.state === 'closed') return
        if (typeof event.data !== 'string' || this.totalChars + event.data.length > 8 * 1024 * 1024 || event.data.length > MAX_EVENT_CHARS || this.queuedChars + event.data.length > MAX_QUEUED_CHARS) {
            this.fail('Terminal output exceeded the safe buffer limit. Reconnect to continue.')
            return
        }
        this.totalChars += event.data.length
        this.queue.push(event.data); this.queuedChars += event.data.length
        this.pump()
    }

    private pump() {
        if (!this.live || this.writing || !this.queue.length) return
        const data = this.queue.shift()!
        this.writing = true
        try {
            this.terminal.write(data, () => {
                if (!this.live) return
                this.queuedChars -= data.length; this.writing = false
                this.schedule(); this.pump()
            })
        } catch { this.fail('Terminal output could not be decoded. Reconnect to continue.') }
    }

    private schedule() {
        if (!this.live || this.frameTimer) return
        this.frameTimer = setTimeout(() => {
            this.frameTimer = undefined
            if (this.live) this.changed(this.snapshot())
        }, 16)
    }

    snapshot(): TerminalSnapshot {
        return { frame: readFrame(this.terminal), state: this.state, message: this.message, generation: this.generation,
            cursorVisible: this.cursorVisible, cursorStyle: this.cursorStyle, cursorBlink: this.cursorBlink, mouse: this.terminal.modes.mouseTrackingMode !== 'none' }
    }

    matches(channel: TerminalChannel) { return this.channel === channel }

    owns(generation: number) { return this.live && this.state === 'ready' && generation === this.generation }

    send(data: string, generation: number): boolean {
        if (!this.owns(generation) || !data || data.length > MAX_INPUT_CHARS) return false
        try {
            if (!this.channel.input(data)) { this.fail('The terminal connection stopped accepting input. Reconnect to continue.'); return false }
            return true
        } catch { this.fail('Terminal input could not be sent. Reconnect to continue.'); return false }
    }

    key(key: TerminalKey, generation: number): boolean {
        const arrows: Partial<Record<TerminalKey, string>> = { Up: 'A', Down: 'B', Right: 'C', Left: 'D', Home: 'H', End: 'F' }
        const fixed: Partial<Record<TerminalKey, string>> = { Enter: '\r', Escape: '\x1b', Tab: '\t', Backspace: '\x7f', Delete: '\x1b[3~', PageUp: '\x1b[5~', PageDown: '\x1b[6~' }
        return this.send(arrows[key] ? `\x1b${this.terminal.modes.applicationCursorKeysMode ? 'O' : '['}${arrows[key]}` : fixed[key]!, generation)
    }

    control(letter: string, generation: number) {
        const code = letter.toUpperCase().charCodeAt(0)
        return code >= 64 && code <= 95 ? this.send(String.fromCharCode(code - 64), generation) : false
    }

    paste(text: string, generation: number) {
        // No pasted ESC can terminate the bracketed region and inject controls into a TUI.
        const safe = text.split(String.fromCharCode(27)).join('')
        return this.send(this.terminal.modes.bracketedPasteMode ? `\x1b[200~${safe}\x1b[201~` : safe, generation)
    }

    mouse(column: number, row: number, action: 'press' | 'release' | 'move' | 'wheelUp' | 'wheelDown', generation: number) {
        if (!this.owns(generation)) return false
        const mode = this.terminal.modes.mouseTrackingMode
        if (mode === 'none' || (mode === 'x10' && action !== 'press') || (mode !== 'drag' && mode !== 'any' && action === 'move')) return false
        const x = Math.max(1, Math.min(this.terminal.cols, Math.floor(column) + 1))
        const y = Math.max(1, Math.min(this.terminal.rows, Math.floor(row) + 1))
        const button = action === 'wheelUp' ? 64 : action === 'wheelDown' ? 65 : action === 'move' ? 32 : 0
        if (this.mouseEncoding === 'sgr') return this.send(`\x1b[<${button};${x};${y}${action === 'release' ? 'm' : 'M'}`, generation)
        const code = action === 'release' ? 3 : button
        if (this.mouseEncoding === 'urxvt') return this.send(`\x1b[${code + 32};${x};${y}M`, generation)
        if (this.mouseEncoding === 'legacy' && (x > 223 || y > 223)) return false
        return this.send(`\x1b[M${String.fromCharCode(code + 32, x + 32, y + 32)}`, generation)
    }

    scroll(lines: number, generation: number) {
        if (!this.owns(generation)) return
        if (this.terminal.modes.mouseTrackingMode !== 'none') {
            for (let i = 0; i < Math.min(8, Math.abs(lines)); i++) this.mouse(0, 0, lines < 0 ? 'wheelUp' : 'wheelDown', generation)
        } else if (this.terminal.buffer.active.type === 'alternate') {
            for (let i = 0; i < Math.min(8, Math.abs(lines)); i++) this.key(lines < 0 ? 'Up' : 'Down', generation)
        } else { this.terminal.scrollLines(lines); this.schedule() }
    }

    resize(cols: number, rows: number) {
        if (!this.live) return
        const [width, height] = terminalSize(cols, rows)
        if (this.terminal.cols === width && this.terminal.rows === height) return
        try { this.terminal.resize(width, height); this.channel.resize(width, height); this.schedule() }
        catch { this.fail('The terminal could not resize. Reconnect to continue.') }
    }

    private fail(message: string) {
        if (this.failed || !this.live) return
        this.failed = true
        this.dispose()
        this.onFailure(message)
    }

    dispose() {
        if (!this.live) return
        this.live = false; this.generation++; this.queue = []; this.queuedChars = 0
        if (this.frameTimer) clearTimeout(this.frameTimer)
        this.unsubscribe?.()
        for (const subscription of this.subscriptions) subscription.dispose()
        this.terminal.reset(); this.terminal.clear()
        this.terminal.dispose()
    }
}
