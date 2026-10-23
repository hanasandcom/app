import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { TerminalChannel, TerminalEvent } from './channel'
import { TerminalEngine, terminalSize } from './engine'
import { paletteColor } from './cells'
import { loadTerminal, withTerminalNavigator } from './loader'

function fixture(state: 'connecting' | 'ready' = 'ready') {
    let listener: ((event: TerminalEvent) => void) | null = null
    const sent: string[] = [], sizes: number[][] = [], failures: string[] = []
    let unsubscribed = 0
    const channel: TerminalChannel = {
        id: 'synthetic-session-1',
        subscribe(next) { listener = next; next({ type: 'state', state }); return () => { unsubscribed++; listener = null } },
        input(data) { sent.push(data); return true },
        resize(cols, rows) { sizes.push([cols, rows]) },
    }
    const engine = new TerminalEngine(channel, () => {}, message => failures.push(message))
    return { engine, sent, sizes, failures, event: (event: TerminalEvent) => listener?.(event), unsubscribed: () => unsubscribed }
}
async function output(f: ReturnType<typeof fixture>, data: string) {
    f.event({ type: 'output', data })
    await new Promise<void>(resolve => f.engine.terminal.write('', resolve))
}
const line = (f: ReturnType<typeof fixture>, row = 0) => f.engine.snapshot().frame.lines[row].map(cell => cell.text).join('').trimEnd()

describe('actual xterm parser and channel lifecycle', () => {
    test('narrow navigator descriptors are restored on success and failure', () => {
        const before = Object.getOwnPropertyDescriptors(globalThis.navigator)
        expect(withTerminalNavigator(() => typeof navigator.platform)).toBe('string')
        expect(() => withTerminalNavigator(() => { throw Error('synthetic') })).toThrow('synthetic')
        expect(Object.getOwnPropertyDescriptors(globalThis.navigator)).toEqual(before)
        const Terminal = loadTerminal()
        const term = new Terminal({ cols: 20, rows: 8, allowProposedApi: true })
        expect(term.cols).toBe(20); term.dispose()
    })
    test('actual cursor positioning, erasure, widths and attributes become cells', async () => {
        const f = fixture()
        try {
            await output(f, 'abc\x1b[2DZ\x1b[K\r\n界e\u0301\x1b[38;2;1;2;3;48;5;196;1;3;4;9mX\x1b[0m')
            expect(line(f)).toBe('aZ')
            const cells = f.engine.snapshot().frame.lines[1]
            expect(cells[0].width).toBe(2)
            expect(cells[1].text).toBe('é')
            const x = cells.find(cell => cell.text === 'X')!
            expect(x.foreground).toBe('#010203'); expect(x.background).toBe('#ff0000')
            expect([x.bold, x.italic, x.underline, x.strike]).toEqual([true, true, true, true])
            await output(f, '\x1b[7mI\x1b[8mH')
            const inverse = f.engine.snapshot().frame.lines[1].find(cell => cell.text === 'I')!
            expect(inverse.foreground).toBe('#101416')
            expect(line(f, 1)).not.toContain('H')
            expect(paletteColor(232)).toBe('#080808')
        } finally { f.engine.dispose() }
    })
    test('alternate buffer, scrollback, cursor visibility/style and resize use parser state', async () => {
        const f = fixture()
        try {
            await output(f, 'normal\x1b[?1049h\x1b[Halt\x1b[?25l\x1b[5 q')
            expect(line(f)).toBe('alt'); expect(f.engine.snapshot().frame.alternate).toBe(true)
            expect(f.engine.snapshot().cursorVisible).toBe(false); expect(f.engine.snapshot().cursorStyle).toBe('bar')
            expect(f.engine.snapshot().cursorBlink).toBe(true)
            await output(f, '\x1b[?1049l\x1b[?25h')
            expect(line(f)).toBe('normal')
            f.engine.resize(40, 10); expect(f.sizes).toEqual([[40, 10]])
            await output(f, '\r\n'.repeat(30))
            const bottom = f.engine.snapshot().frame.bottom
            expect(bottom).toBeGreaterThan(0)
            f.engine.scroll(-6, f.engine.snapshot().generation)
            expect(f.engine.snapshot().frame.viewport).toBe(bottom - 6)
            expect(terminalSize(999, 999)).toEqual([120, 48])
        } finally { f.engine.dispose() }
    })
    test('application arrows, control, paste, mouse and protocol replies use current modes', async () => {
        const f = fixture()
        try {
            const generation = f.engine.snapshot().generation
            f.engine.key('Up', generation)
            await output(f, '\x1b[?1h\x1b[?2004h\x1b[?1000h\x1b[?1006h')
            f.engine.key('Up', generation); f.engine.control('C', generation)
            f.engine.paste('abc\x1bdef', generation)
            f.engine.mouse(2, 3, 'press', generation); f.engine.mouse(2, 3, 'release', generation)
            await output(f, '\x1b[6n')
            expect(f.sent.slice(0, 6)).toEqual(['\x1b[A', '\x1bOA', '\x03', '\x1b[200~abcdef\x1b[201~', '\x1b[<0;3;4M', '\x1b[<0;3;4m'])
            expect(f.sent.at(-1)?.startsWith('\x1b[')).toBe(true)
            expect(f.sent.at(-1)?.endsWith('R')).toBe(true)
            await output(f, '\x1b]52;c;c2VjcmV0\x07\x1b]8;;https://example.invalid\x07link\x1b]8;;\x07')
            expect(f.sent.length).toBe(7) // No clipboard/link side effects or device bridge.
        } finally { f.engine.dispose() }
    })
    test('connecting cannot send, stale generation cannot send, close clears and unsubscribes', async () => {
        const f = fixture('connecting')
        const old = f.engine.snapshot().generation
        expect(f.engine.send('secret', old)).toBe(false)
        f.event({ type: 'state', state: 'ready' })
        expect(f.engine.send('old', old)).toBe(false)
        expect(f.engine.send('current', f.engine.snapshot().generation)).toBe(true)
        await output(f, 'private output')
        f.event({ type: 'state', state: 'closed' })
        expect(f.unsubscribed()).toBe(1)
        expect(f.engine.send('late', f.engine.snapshot().generation)).toBe(false)
        expect(f.sent).toEqual(['current'])
        expect(line(f)).toBe('')
        f.engine.dispose()
    })
    test('ordered writes retain all output and overflow fails once without silent drops', async () => {
        const f = fixture()
        try {
            for (const data of ['one', 'two', 'three']) f.event({ type: 'output', data })
            await new Promise(resolve => setTimeout(resolve, 30))
            expect(line(f)).toBe('onetwothree')
            f.event({ type: 'output', data: 'x'.repeat(131073) })
            f.event({ type: 'output', data: 'late' })
            expect(f.failures).toHaveLength(1); expect(f.unsubscribed()).toBe(1)
        } finally { f.engine.dispose() }
    })
    test('hidden/context cleanup and stable output/input host binding remain explicit', () => {
        const source = readFileSync(`${import.meta.dir}/TerminalSurface.tsx`, 'utf8')
        expect(source).toContain('engine.current?.dispose(); engine.current = null')
        expect(source).toContain('current.current.visible = false')
        expect(source).toContain('key={`composer:${host}:${visible}`}')
        expect(source).toContain('key={`viewport:${context}`}')
        expect(source).toContain('current.current.host = \'retired\'')
        expect(source).toContain('live.context === context')
        expect(source).not.toContain('Linking')
    })
})

import { TerminalInputFence } from './input'

test('native current-props target lookup cannot replay a cleared composer', () => {
    const fence = new TerminalInputFence()
    let text = '', ready = true
    const targets = new Map<string, (value: string) => void>()
    const render = () => {
        const revision = fence.revision
        const target = `composer:${revision}`
        targets.clear()
        targets.set(target, value => { if (fence.permits(revision, ready)) text = value })
        return target
    }
    const old = render()
    targets.get(old)!('draft')
    targets.get(old)!('ordinary typing')
    expect(fence.revision).toBe(0)
    expect(text).toBe('ordinary typing')
    fence.retire(); text = ''
    targets.get(old)?.('queued before commit')
    expect(text).toBe('')
    const current = render()
    targets.get(old)?.('native target after commit')
    expect(text).toBe('')
    targets.get(current)!('new input')
    expect(text).toBe('new input')
    ready = false
    targets.get(current)!('hidden event')
    expect(text).toBe('new input')
})

test('channel replacement and disposed parser cannot send to the previous transport', () => {
    const f = fixture()
    const other: TerminalChannel = { id: 'different', subscribe: () => () => {}, input: () => true, resize: () => {} }
    expect(f.engine.matches(other)).toBe(false)
    const generation = f.engine.snapshot().generation
    f.engine.dispose()
    expect(f.engine.send('late secret', generation)).toBe(false)
    expect(f.sent).toEqual([])
    expect(f.unsubscribed()).toBe(1)
})

test('queued output pressure, transport rejection and resize failure close once', () => {
    const burst = fixture()
    for (let index = 0; index < 6; index++) burst.event({ type: 'output', data: 'x'.repeat(100000) })
    expect(burst.failures).toHaveLength(1)
    expect(burst.unsubscribed()).toBe(1)
    const failures: string[] = []
    const channel: TerminalChannel = {
        id: 'closed-transport',
        subscribe(listener) { listener({ type: 'state', state: 'ready' }); return () => {} },
        input: () => false,
        resize: () => { throw Error('synthetic resize failure') },
    }
    const engine = new TerminalEngine(channel, () => {}, message => failures.push(message))
    expect(engine.send('command', engine.snapshot().generation)).toBe(false)
    engine.resize(40, 10)
    expect(failures).toHaveLength(1)
    const resized = new TerminalEngine(channel, () => {}, message => failures.push(message))
    resized.resize(40, 10)
    expect(failures).toHaveLength(2)
    engine.dispose(); resized.dispose()
})


test('native pointer target retires across channel and connection generation, not output frames', async () => {
    const a = fixture(), b = fixture()
    try {
        await output(a, '\x1b[?1000h\x1b[?1006h')
        await output(b, '\x1b[?1000h\x1b[?1006h')
        const listeners = new Map<number, () => void>()
        let serial = 0, nativeTarget = 0, renderedKey = '', currentContext = ''
        const render = (context: string, engine: TerminalEngine) => {
            const key = `viewport:${context}`
            if (key !== renderedKey) {
                listeners.delete(nativeTarget)
                nativeTarget = ++serial; renderedKey = key
            }
            const generation = engine.snapshot().generation
            listeners.set(nativeTarget, () => {
                if (currentContext === context) engine.mouse(0, 0, 'press', generation)
            })
            return nativeTarget
        }
        currentContext = 'A:1'
        const oldTarget = render(currentContext, a.engine)
        expect(render(currentContext, a.engine)).toBe(oldTarget) // ordinary redraw
        const oldListener = listeners.get(oldTarget)!
        currentContext = 'B:1'
        oldListener() // queued JS callback before commit
        expect(a.sent).toEqual([]); expect(b.sent).toEqual([])
        const newTarget = render(currentContext, b.engine)
        expect(newTarget).not.toBe(oldTarget)
        // RN resolves current props by the retained native target, not an old JS closure.
        listeners.get(oldTarget)?.()
        expect(b.sent).toEqual([])
        listeners.get(newTarget)!()
        expect(b.sent).toEqual(['\x1b[<0;1;1M'])
        b.event({ type: 'state', state: 'connecting' })
        b.event({ type: 'state', state: 'ready' })
        currentContext = `B:${b.engine.snapshot().generation}`
        const generationTarget = render(currentContext, b.engine)
        expect(generationTarget).not.toBe(newTarget)
        listeners.get(newTarget)?.()
        expect(b.sent).toHaveLength(1)
        const source = readFileSync(`${import.meta.dir}/TerminalSurface.tsx`, 'utf8')
        expect(source).toContain('key={`viewport:${context}`}')
        expect(source).toContain('const context = `${channel.id}:${snapshot?.generation ?? -1}`')
    } finally { a.engine.dispose(); b.engine.dispose() }
})
