// Derived from Hanasand website timetableData.ts at a71de441; preserves its document format and calculations.
import { expectedWeek } from './norwegianCalendar'
import { cellValue, type TableData } from './workspace'

export type Activity = { id: string, date: string, hours: number, category: string, description: string }
export type ActivityLog = { startYear: number, activities: Activity[] }
export type Week = { key: string, year: number, week: number, start: string, end: string, values: string[], activities: Activity[], legacy: boolean, sourceRow?: number, expected: number, exclusions: string[] }
export const initialTimetableYear = 2026
const day = 86400000
export const hoursText = (hours: number) => String(Math.round(hours * 100) / 100)
export const expectedHoursText = (hours: number) => hoursText(Math.floor(hours / 10) * 10)
export function validDate(value: unknown): value is string {
    return typeof value === 'string' && /^(19|20|21)\d{2}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
}
export function validActivityLog(value: unknown): value is ActivityLog {
    if (!value || typeof value !== 'object') return false
    const log = value as ActivityLog
    if (!Number.isInteger(log.startYear) || log.startYear < 1900 || log.startYear > 2198 || !Array.isArray(log.activities) || log.activities.length > 10000) return false
    const ids = new Set<string>()
    return log.activities.every(item => {
        if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 100 || ids.has(item.id) || !validDate(item.date) ||
            typeof item.hours !== 'number' || !Number.isFinite(item.hours) || item.hours <= 0 || item.hours > 24 || Math.abs(item.hours * 100 - Math.round(item.hours * 100)) > 1e-8 ||
            typeof item.category !== 'string' || !item.category.trim() || item.category.length > 100 || typeof item.description !== 'string' || item.description.length > 4000) return false
        ids.add(item.id)
        return true
    })
}
export function isoWeek(date: string) {
    const value = new Date(date + 'T00:00:00Z')
    value.setUTCDate(value.getUTCDate() + 4 - (value.getUTCDay() || 7))
    const year = value.getUTCFullYear()
    const week = Math.ceil(((value.getTime() - Date.UTC(year, 0, 1)) / day + 1) / 7)
    return { year, week, key: `${year}-W${String(week).padStart(2, '0')}` }
}
export function weekDates(year: number, week: number) {
    const jan4 = new Date(Date.UTC(year, 0, 4))
    const monday = jan4.getTime() - ((jan4.getUTCDay() || 7) - 1) * day + (week - 1) * 7 * day
    return { start: new Date(monday).toISOString().slice(0, 10), end: new Date(monday + 6 * day).toISOString().slice(0, 10) }
}
export function isTimetable(data: TableData) {
    const header = data.cells[0]
    return header.length >= 3 && /^week$/i.test(header[0].trim()) && /^total$/i.test(header.at(-1)!.trim())
}
export function timetable(data: TableData, log: ActivityLog) {
    const original = data.cells[0].slice(1, -1)
    const categories = [...new Set([...original, ...log.activities.map(item => item.category)])]
    const weeks = new Map<string, Week>()
    const notes: string[] = []
    let year = log.startYear, previous = 0
    for (let row = 1; row < data.cells.length; row++) {
        const label = data.cells[row][0].trim()
        if ((/^total(?:\s|$)/i.test(label) || /^\d+\s+weeks$/i.test(label))) continue
        const explicit = /^(\d{4})-W(\d{1,2})$/.exec(label)
        const week = Number(explicit?.[2] || label)
        if (!Number.isInteger(week) || week < 1 || week > 53) {
            if (data.cells[row].some(value => value.trim())) notes.push(`Original row ${row + 1}: ${data.cells[row].map((_, col) => cellValue(data.cells, row, col)).join(' | ')}`)
            continue
        }
        if (explicit) year = Number(explicit[1])
        else if (previous >= 40 && week <= 10) year++
        previous = week
        const key = `${year}-W${String(week).padStart(2, '0')}`
        const values = categories.map(category => {
            const col = original.indexOf(category)
            return col < 0 ? '' : cellValue(data.cells, row, col + 1)
        })
        const total = cellValue(data.cells, row, data.cells[0].length - 1)
        const legacy = [...values, total].some(value => value.trim() !== '' && value.trim() !== '0')
        // Never discard imported hours or claim they have dated activity evidence.
        if (weeks.has(key)) { notes.push(`Duplicate ${key}: ${[...values, total].join(' | ')}`); continue }
        weeks.set(key, { key, year, week, ...weekDates(year, week), values: [...values, total], activities: [], legacy, sourceRow: row, expected: 0, exclusions: [] })
    }
    for (const activity of log.activities) {
        const { year: activityYear, week, key } = isoWeek(activity.date)
        if (!weeks.has(key)) weeks.set(key, { key, year: activityYear, week, ...weekDates(activityYear, week), values: categories.map(() => '').concat(''), activities: [], legacy: false, expected: 0, exclusions: [] })
        weeks.get(key)!.activities.push(activity)
    }
    const rows = [...weeks.values()].sort((a, b) => a.start.localeCompare(b.start)).map(week => {
        week.activities.sort((a, b) => a.date.localeCompare(b.date) || a.category.localeCompare(b.category) || a.id.localeCompare(b.id))
        const values = categories.map((category, index) => {
            const added = week.activities.filter(item => item.category === category).reduce((sum, item) => sum + Math.round(item.hours * 100), 0) / 100
            const old = week.values[index].trim()
            return !old || Number.isFinite(Number(old)) ? (added || old ? hoursText(Number(old || 0) + added) : '') : old + (added ? ` + ${hoursText(added)}` : '')
        })
        const imported = week.values.slice(0, -1).reduce((sum, value) => sum + (Number.isFinite(Number(value)) ? Number(value) : 0), 0)
        const oldTotal = week.values.at(-1)!.trim()
        const base = oldTotal && Number.isFinite(Number(oldTotal)) ? Number(oldTotal) : imported
        const logged = week.activities.reduce((sum, item) => sum + Math.round(item.hours * 100), 0) / 100
        const expected = expectedWeek(week.start, week.week, log.startYear, week.sourceRow !== undefined)
        return { ...week, expected: expected.hours, exclusions: expected.exclusions, values: [...values, base || logged ? hoursText(base + logged) : ''] }
    })
    const totals = [...categories, 'Total'].map((_, index) => hoursText(rows.reduce((sum, week) => sum + (Number.isFinite(Number(week.values[index])) ? Math.round(Number(week.values[index]) * 100) : 0), 0) / 100))
    return { categories, weeks: rows, notes, totals, plannedWeeks: rows.filter(week => week.sourceRow !== undefined).length, expectedHours: rows.reduce((sum, week) => sum + Math.round(week.expected * 100), 0) / 100 }
}
export function activityError(activity: Activity, activities: Activity[]) {
    if (!activity.description.trim()) return 'Describe the activity so its hours can be reviewed.'
    if (!validActivityLog({ startYear: initialTimetableYear, activities: [activity] })) return 'Enter a valid date, 0.01–24 hours (up to two decimal places), a category and a description of at most 4,000 characters.'
    const total = activities.filter(item => item.date === activity.date && item.id !== activity.id).reduce((sum, item) => sum + Math.round(item.hours * 100), Math.round(activity.hours * 100))
    if (total > 2400) return 'The activities for one date cannot exceed 24 hours.'
    if (activities.length >= 10000 && !activities.some(item => item.id === activity.id)) return 'The activity log is full.'
    return ''
}
