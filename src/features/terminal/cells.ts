import type { Terminal } from '@xterm/headless'

export const CELL_FOREGROUND = '#e5e5e5'
export const CELL_BACKGROUND = '#101416'
const ANSI = ['#000000', '#cd0000', '#00cd00', '#cdcd00', '#0000ee', '#cd00cd', '#00cdcd', '#e5e5e5', '#7f7f7f', '#ff0000', '#00ff00', '#ffff00', '#5c5cff', '#ff00ff', '#00ffff', '#ffffff']
export function paletteColor(index: number): string {
    if (index < 16) return ANSI[index] ?? CELL_FOREGROUND
    if (index >= 232) {
        const value = 8 + (index - 232) * 10
        return `#${value.toString(16).padStart(2, '0').repeat(3)}`
    }
    const cube = [0, 95, 135, 175, 215, 255]
    const n = index - 16
    return `#${[cube[Math.floor(n / 36)], cube[Math.floor(n / 6) % 6], cube[n % 6]].map(value => value.toString(16).padStart(2, '0')).join('')}`
}
const rgb = (value: number) => `#${value.toString(16).padStart(6, '0')}`
export interface TerminalCell {
    column: number; width: number; text: string; foreground: string; background: string
    bold: boolean; italic: boolean; dim: boolean; underline: boolean; strike: boolean; overline: boolean; blink: boolean
}
export interface TerminalFrame {
    cols: number; rows: number; lines: TerminalCell[][]; cursorX: number; cursorY: number
    alternate: boolean; viewport: number; bottom: number
}
export function readFrame(terminal: Terminal): TerminalFrame {
    const buffer = terminal.buffer.active
    const lines: TerminalCell[][] = []
    for (let row = 0; row < terminal.rows; row++) {
        const line = buffer.getLine(buffer.viewportY + row)
        const cells: TerminalCell[] = []
        for (let col = 0; col < terminal.cols; col++) {
            const cell = line?.getCell(col)
            if (!cell || cell.getWidth() === 0) continue
            let foreground = cell.isFgRGB() ? rgb(cell.getFgColor()) : cell.isFgPalette() ? paletteColor(cell.getFgColor() + (cell.isBold() && cell.getFgColor() < 8 ? 8 : 0)) : CELL_FOREGROUND
            let background = cell.isBgRGB() ? rgb(cell.getBgColor()) : cell.isBgPalette() ? paletteColor(cell.getBgColor()) : CELL_BACKGROUND
            if (cell.isInverse()) [foreground, background] = [background, foreground]
            if (cell.isInvisible()) foreground = background
            cells.push({ column: col, width: cell.getWidth(), text: cell.isInvisible() ? ' ' : cell.getChars() || ' ', foreground, background,
                bold: !!cell.isBold(), italic: !!cell.isItalic(), dim: !!cell.isDim(), underline: !!cell.isUnderline(), strike: !!cell.isStrikethrough(), overline: !!cell.isOverline(), blink: !!cell.isBlink() })
        }
        lines.push(cells)
    }
    return { cols: terminal.cols, rows: terminal.rows, lines, cursorX: Math.min(buffer.cursorX, terminal.cols - 1), cursorY: buffer.baseY + buffer.cursorY - buffer.viewportY,
        alternate: buffer.type === 'alternate', viewport: buffer.viewportY, bottom: buffer.baseY }
}
