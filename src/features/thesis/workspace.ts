// Derived from Hanasand website workspace.ts at a71de441; preserves its document format and calculations.
import { markdownBlocks } from './markdown'
import { validActivityLog, type ActivityLog } from './timetableData'

export const sheetNames = ['Overview', 'Timetable', 'Plan', 'Research'] as const
export type SheetSettings = { insertTable?: boolean, history?: boolean, codeReview?: boolean }
export type Sheet = { title: string, body: string, id?: string, name?: string, settings?: SheetSettings, activityLog?: ActivityLog }
const marker = /^<!-- thesis-sheet:(Overview|Timetable|Plan|Research) title:(.*?) -->\n/gm

export function readSheets(title: string, body: string): Sheet[] {
    // Lengths keep literal metadata examples inside markdown from becoming sheet boundaries.
    const header = /^<!-- thesis-workspace:2 (.*?) -->\n/.exec(body)
    if (header) {
        try {
            const metadata = JSON.parse(decodeURIComponent(header[1]))
            let offset = header[0].length
            if (!Array.isArray(metadata) || !metadata.length) throw new Error('Invalid sheets')
            const result: Sheet[] = metadata.map(item => {
                if (!item || typeof item.title !== 'string' || !Number.isSafeInteger(item.length) || item.length < 0 ||
                    (item.settings !== undefined && (!item.settings || typeof item.settings !== 'object' || Array.isArray(item.settings) || Object.entries(item.settings).some(([key, value]) => !['insertTable', 'history', 'codeReview'].includes(key) || typeof value !== 'boolean'))) ||
                    (item.activityLog !== undefined && !validActivityLog(item.activityLog)) ||
                    (item.id !== undefined && typeof item.id !== 'string') || (item.name !== undefined && typeof item.name !== 'string')) throw new Error('Invalid sheet')
                const { length, ...sheet } = item
                const content = body.slice(offset, offset + length)
                if (content.length !== length) throw new Error('Incomplete sheet')
                offset += length + 2
                return { ...sheet, body: content }
            })
            if (offset - 2 !== body.length) throw new Error('Unexpected content')
            return result
        } catch { /* Preserve malformed metadata as ordinary markdown. */ }
    }
    const sheets = sheetNames.map(name => ({ title: `# ${name}`, body: '' }))
    sheets[0] = { title, body }
    const matches = [...body.matchAll(marker)]
    if (!matches.length) return sheets
    // Only canonical boundaries outside fenced code are document metadata.
    const comments = new Set<number>()
    let offset = 0
    for (const token of markdownBlocks(body)) {
        const start = body.indexOf(token.raw, offset)
        if (token.type === 'html') comments.add(start)
        offset = start + token.raw.length
    }
    const seen = new Set<string>()
    const boundaries = matches.filter(match => {
        if (!comments.has(match.index!) || seen.has(match[1])) return false
        try { decodeURIComponent(match[2]) } catch { return false }
        seen.add(match[1])
        return true
    })
    if (!boundaries.length) return sheets
    sheets[0].body = body.slice(0, boundaries[0].index).replace(/\n\n$/, '')
    for (let i = 0; i < boundaries.length; i++) {
        const match = boundaries[i]
        const index = sheetNames.indexOf(match[1] as typeof sheetNames[number])
        sheets[index] = { title: decodeURIComponent(match[2]), body: body.slice(match.index! + match[0].length, boundaries[i + 1]?.index).replace(i + 1 < boundaries.length ? /\n\n$/ : /$^/, '') }
    }
    return sheets
}

export function writeSheets(sheets: Sheet[]) {
    const metadata = sheets.map(({ body, ...sheet }) => ({ ...sheet, length: body.length }))
    return `<!-- thesis-workspace:2 ${encodeURIComponent(JSON.stringify(metadata)).replace(/-/g, '%2D')} -->\n` + sheets.map(sheet => sheet.body).join('\n\n')
}

export type TableData = { cells: string[][], widths: number[], heights: number[] }
export type TableRange = { start: number, end: number, data: TableData }
const decode = (value: string) => value.replace(/<br\s*\/?\s*>/gi, '\n').replace(/\\\|/g, '|').replace(/&#(\d+);/g, (_, n) => Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : '\uFFFD').replace(/&amp;/g, '&')
const encode = (value: string) => value.replace(/&/g, '&amp;').replace(/\\/g, '&#92;').replace(/\|/g, '&#124;').replace(/</g, '&#60;').replace(/>/g, '&#62;').replace(/\n/g, '<br>').replace(/^\s+|\s+$|\t|\r/gu, whitespace => [...whitespace].map(character => `&#${character.codePointAt(0)};`).join(''))

export function tables(body: string): TableRange[] {
    const result: TableRange[] = []
    let offset = 0
    for (const token of markdownBlocks(body)) {
        const start = body.indexOf(token.raw, offset)
        offset = start + token.raw.length
        if (token.type !== 'table') continue
        const metadata = /^<!-- thesis-table:(.*?) -->\n?/.exec(body.slice(offset))
        let sizes: { widths?: number[], heights?: number[] } = {}
        try { sizes = JSON.parse(metadata?.[1] || '{}') ?? {} } catch { /* Fall back to automatic sizing. */ }
        const clean = (value: unknown, fallback: number) => Array.isArray(value) ? value.map(n => typeof n === 'number' && Number.isFinite(n) ? Math.max(40, Math.min(1200, n)) : fallback) : []
        result.push({ start, end: offset + (metadata?.[0].length || 0), data: {
            cells: [token.header, ...token.rows].map(row => row.map((cell: { text: string }) => decode(cell.text))),
            widths: clean(sizes.widths, 180), heights: clean(sizes.heights, 48),
        } })
    }
    return result
}

export function writeTable(data: TableData) {
    const rows = data.cells.map(row => `| ${row.map(encode).join(' | ')} |`)
    rows.splice(1, 0, `| ${data.cells[0].map(() => '---').join(' | ')} |`)
    return rows.join('\n') + `\n<!-- thesis-table:${JSON.stringify({ widths: data.widths, heights: data.heights })} -->\n`
}

export function replaceTableAt(body: string, table: Pick<TableRange, 'start' | 'end'>, data: TableData) {
    return body.slice(0, table.start) + writeTable(data) + body.slice(table.end)
}

export function tableEditorRows(value: string) {
    const lines = value.split('\n')
    while (lines.length > 1 && !lines.at(-1)?.trim()) lines.pop()
    return lines.length
}

export function columnName(index: number): string {
    return index < 26 ? String.fromCharCode(65 + index) : columnName(Math.floor(index / 26) - 1) + String.fromCharCode(65 + index % 26)
}
export function cellValue(cells: string[][], row: number, col: number, visiting = new Set<string>(), budget = { remaining: 100000 }): string {
    if (--budget.remaining < 0) return '#LIMIT!'
    const raw = cells[row]?.[col]
    if (raw === undefined) return '#REF!'
    if (!/^=SUMMARIZE\b/i.test(raw.trim())) return raw
    const match = /^=SUMMARIZE\(\s*([A-Z]+)([1-9]\d*)\s*:\s*([A-Z]+)([1-9]\d*)\s*\)$/i.exec(raw.trim())
    if (!match) return raw.includes('#REF!') ? '#REF!' : '#FORMULA!'
    const key = `${row}:${col}`
    if (visiting.has(key) || visiting.size > 200) return '#CYCLE!'
    const column = (letters: string) => [...letters.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1
    const r1 = Number(match[2]) - 1, r2 = Number(match[4]) - 1, c1 = column(match[1]), c2 = column(match[3])
    if (Math.max(r1, r2) >= cells.length || Math.max(c1, c2) >= cells[0].length) return '#REF!'
    visiting.add(key)
    let total = 0
    for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
        const value = cellValue(cells, r, c, visiting, budget)
        if (value === '#LIMIT!' || (value.startsWith('#') && cells[r][c].trim().startsWith('='))) { visiting.delete(key); return value }
        if (value.trim() && Number.isFinite(Number(value))) total += Number(value)
    }
    visiting.delete(key)
    return Number.isFinite(total) ? String(total) : '#NUMBER!'
}

// Keep references attached to their cells when table structure changes.
export function reshape(data: TableData, axis: 'row' | 'column', index: number, remove: boolean): TableData {
    const cells = data.cells.map(row => [...row])
    if (axis === 'row') cells.splice(index, remove ? 1 : 0, ...(!remove ? [cells[0].map(() => '')] : []))
    else cells.forEach(row => row.splice(index, remove ? 1 : 0, ...(!remove ? [''] : [])))
    const adjust = (letters: string, digits: string) => {
        let r = Number(digits) - 1, c = [...letters.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
        const position = axis === 'row' ? r : c
        if (remove && position === index) return '#REF!'
        if (position >= index) { if (axis === 'row') r += remove ? -1 : 1; else c += remove ? -1 : 1 }
        return columnName(c) + (r + 1)
    }
    for (const row of cells) for (let c = 0; c < row.length; c++) if (/^=SUMMARIZE\(/i.test(row[c])) row[c] = row[c].replace(/([A-Z]+)([1-9]\d*)/gi, (_, letters, digits) => adjust(letters, digits))
    const widths = [...data.widths], heights = [...data.heights]
    ;(axis === 'row' ? heights : widths).splice(index, remove ? 1 : 0, ...(!remove ? [axis === 'row' ? 48 : 180] : []))
    return { cells, widths, heights }
}

export function identifiedSheets(title: string, body: string) {
    return readSheets(title, body).map((sheet, index) => ({ ...sheet, id: sheet.id || sheetNames[index] || String(index), name: sheet.name || sheetNames[index] || `Sheet ${index + 1}` }))
}

export function sheetChanges(before: Sheet[], after: Sheet[]) {
    return [...before.map(sheet => ({ before: sheet, after: after.find(current => current.id === sheet.id) })),
        ...after.filter(sheet => !before.some(old => old.id === sheet.id)).map(sheet => ({ before: undefined, after: sheet }))]
        .filter(change => !change.before || !change.after || change.before.title !== change.after.title || change.before.body !== change.after.body || change.before.name !== change.after.name || JSON.stringify(change.before.settings) !== JSON.stringify(change.after.settings) || JSON.stringify(change.before.activityLog) !== JSON.stringify(change.after.activityLog))
}
