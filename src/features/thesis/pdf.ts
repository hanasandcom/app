import type { ActivityLog } from './timetableData'
import { timetable } from './timetableData'

export function htmlEscape(value: string) { return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]!) }
export function timetableHtml(title: string, model: ReturnType<typeof timetable>, log: ActivityLog) {
    const table = (header: string[], rows: string[][]) => '<table><thead><tr>' + header.map(v => '<th>' + htmlEscape(v) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(row => '<tr>' + row.map(value => '<td>' + htmlEscape(value) + '</td>').join('') + '</tr>').join('') + '</tbody></table>'
    const daily = new Map<string, number>()
    for (const activity of log.activities) daily.set(activity.date, (daily.get(activity.date) || 0) + Math.round(activity.hours * 100))
    return '<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:18mm}body{font:12px -apple-system,Arial,sans-serif}table{width:100%;border-collapse:collapse;margin:14px 0}th,td{border:1px solid #aaa;padding:5px;white-space:pre-wrap;text-align:left}tr{break-inside:avoid}thead{display:table-header-group}</style></head><body><h1>' + htmlEscape(title) + '</h1><p>' + htmlEscape(`${model.plannedWeeks} planned weeks · ${model.totals.at(-1)} spent hours · ${model.expectedHours} expected hours`) + '</p>'
        + '<h2>Weekly timetable</h2>' + table(['Week', ...model.categories, 'Total'], [...model.weeks.map(week => [week.key, ...week.values]), ['Total', ...model.totals]])
        + '<p>Earlier imported totals may have no dated activity evidence. New activities are added to those totals. Expected hours follow the Norwegian weekday holiday and Christmas-break plan.</p>'
        + '<h2>Activity log</h2>' + table(['Date', 'Hours', 'Category', 'Description'], [...log.activities].sort((a, b) => a.date.localeCompare(b.date)).map(activity => [activity.date, String(activity.hours), activity.category, activity.description]))
        + '<h2>Daily totals</h2>' + table(['Date', 'Hours'], [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, hours]) => [date, String(hours / 100)]))
        + model.notes.map(note => '<p>' + htmlEscape(note) + '</p>').join('') + '</body></html>'
}
export async function exportTimetable(title: string, model: ReturnType<typeof timetable>, log: ActivityLog, isCurrent: () => boolean = () => true) {
    if (!isCurrent()) return
    const Print = await import('expo-print')
    const Sharing = await import('expo-sharing')
    const { File, Paths } = await import('expo-file-system')
    const result = await Print.printToFileAsync({ html: timetableHtml(title, model, log), width: 595, height: 842 })
    const temporary = new File(result.uri)
    const destination = new File(Paths.cache, `thesis-timetable-${new Date().toISOString().slice(0, 10)}.pdf`)
    try {
        if (!isCurrent()) return
        if (destination.exists) destination.delete()
        temporary.move(destination)
        if (!await Sharing.isAvailableAsync()) throw new Error('File sharing is unavailable on this device.')
        if (!isCurrent()) return
        await Sharing.shareAsync(destination.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Timetable PDF' })
    } finally { if (temporary.exists) temporary.delete(); if (destination.exists) destination.delete() }
}
