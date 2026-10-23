import { describe, expect, test } from 'bun:test'
import { readSheets, writeSheets, tables, writeTable, reshape, cellValue } from './workspace'
import { activityError, isoWeek, timetable } from './timetableData'
import { safeLink } from './markdown'

describe('website-compatible Thesis models', () => {
    test('workspace lengths preserve marker examples and malformed metadata', () => {
        const sheets = [{ id: 'x', name: 'Notes', title: '# Notes', body: '<!-- thesis-sheet:Research title:x -->\n```\n| a | b |\n| --- | --- |\n```' }]
        expect(readSheets('Thesis', writeSheets(sheets))).toEqual(sheets)
        expect(readSheets('Thesis', '<!-- thesis-workspace:2 nope -->\ntext')[0].body).toContain('nope')
        expect(tables(sheets[0].body)).toHaveLength(0)
    })
    test('GFM table cells preserve escaping, metadata, whitespace and formulas', () => {
        const data = { cells: [['Name', 'Hours'], [' a | b\\c\n<raw>', '2'], ['Total', '=SUMMARIZE(B2:B2)']], widths: [200, 250], heights: [48, 60, 70] }
        const body = 'Text\n\n' + writeTable(data) + '\nAfter'
        expect(tables(body)).toHaveLength(1)
        expect(tables(body)[0].data).toEqual(data)
        expect(cellValue(data.cells, 2, 1)).toBe('2')
        expect(reshape(data, 'row', 1, true).cells[1][1]).toContain('#REF!')
    })
    test('legacy markers inside code cannot split sheets', () => {
        const text = '```html\n<!-- thesis-sheet:Research title:Research -->\n```'
        expect(readSheets('Thesis', text)[0].body).toBe(text)
    })
    test('cycles and unsupported references fail visibly', () => {
        expect(cellValue([['=SUMMARIZE(A1:A1)']], 0, 0)).toBe('#CYCLE!')
        expect(cellValue([['=SUMMARIZE(B1:B1)']], 0, 0)).toBe('#REF!')
        expect(safeLink('javascript:alert(1)')).toBeNull()
    })
    test('daily hours and real dates validate without inventing dated imported hours', () => {
        const activity = { id: 'a', date: '2026-10-23', hours: 12, category: 'Research', description: 'Review' }
        expect(activityError({ ...activity, id: 'b', hours: 13 }, [activity])).toContain('24')
        expect(activityError({ ...activity, date: '2026-02-30' }, [])).toContain('valid date')
        expect(isoWeek('2027-01-01').year).toBe(2026)
        const result = timetable({ cells: [['Week', 'Research', 'Total'], ['43', '2', '2']], widths: [], heights: [] }, { startYear: 2026, activities: [] })
        expect(result.weeks[0].legacy).toBe(true)
        expect(result.weeks[0].activities).toEqual([])
    })
})
