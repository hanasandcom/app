import { useState } from 'react'
import * as Crypto from 'expo-crypto'
import { View } from 'react-native'
import { GlassCard, InlineNotice, PillButton } from '../../components/ui'
import { activityError, initialTimetableYear, isTimetable, isoWeek, timetable, type Activity } from './timetableData'
import { replaceTableAt, tables, type Sheet } from './workspace'
import { Actions, ThesisField, ThesisText } from './ui'
import { exportTimetable } from './pdf'

export function TimetableSheet({ sheet, enabled, host, guard, onChange }: { sheet: Sheet; enabled: boolean; host: number; guard: () => boolean; onChange: (value: Sheet, structural?: boolean) => void }) {
    const parsed = tables(sheet.body), target = parsed.find(table => isTimetable(table.data))
    const log = sheet.activityLog || { startYear: initialTimetableYear, activities: [] }
    const model = target ? timetable(target.data, log) : null
    const [form, setForm] = useState<(Omit<Activity, 'hours'> & { hours: string; existing: boolean }) | null>(null)
    const [message, setMessage] = useState('')
    const [expanded, setExpanded] = useState('')
    const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
    const [year, setYear] = useState(String(log.startYear))
    const [pdfBusy, setPdfBusy] = useState(false)
    function open(existing?: Activity) {
        if (!enabled || !guard()) return
        setForm(existing ? { ...existing, hours: String(existing.hours), existing: true } : { id: Crypto.randomUUID(), date, hours: '', category: model?.categories[0] || 'Research', description: '', existing: false })
    }
    function save() {
        if (!form || !enabled || !guard()) return
        const value: Activity = { id: form.id, date: form.date, hours: Number(form.hours), category: form.category.trim(), description: form.description.trim() }
        const failure = activityError(value, log.activities)
        if (failure) { setMessage(failure); return }
        if (form.existing && !log.activities.some(item => item.id === value.id)) { setMessage('This activity was removed. Review the latest log.'); return }
        onChange({ ...sheet, activityLog: { ...log, activities: form.existing ? log.activities.map(item => item.id === value.id ? value : item) : [...log.activities, value] } }, true)
        setForm(null); setMessage('Activity added to your draft. Undo can restore changes.')
    }
    function changeWeek(key: string | undefined, chosenDate: string) {
        if (!enabled || !guard() || !target || !model) return
        const cells = target.data.cells.map(row => [...row])
        for (const week of model.weeks) if (week.sourceRow !== undefined) cells[week.sourceRow][0] = week.key
        const existing = model.weeks.find(week => week.key === key)
        if (existing?.sourceRow !== undefined) cells.splice(existing.sourceRow, 1)
        else {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(chosenDate) || !Number.isFinite(Date.parse(chosenDate))) { setMessage('Enter a valid date for the week.'); return }
            const chosen = isoWeek(chosenDate)
            if (model.weeks.some(week => week.key === chosen.key && week.sourceRow !== undefined)) { setMessage('That week is already planned.'); return }
            cells.push([chosen.key, ...cells[0].slice(1).map(() => '')])
        }
        const summary = cells.find(row => /^(?:total(?:\s|$)|\d+\s+weeks$)/i.test(row[0].trim()))
        if (summary) summary[0] = `${model.plannedWeeks + (existing?.sourceRow !== undefined ? -1 : 1)} weeks`
        onChange({ ...sheet, body: replaceTableAt(sheet.body, target, { ...target.data, cells, heights: [] }) }, true)
    }
    if (!model) return <View style={{ gap: 10 }}><ThesisText>No timetable table yet. Create a Week / category / Total table to start.</ThesisText><PillButton label='Create timetable' disabled={!enabled} onPress={() => { if (guard()) onChange({ ...sheet, body: sheet.body + '\n\n| Week | Research | Total |\n| --- | --- | --- |\n| 43 | | |\n' }, true) }} /></View>
    return (
        <View style={{ gap: 12 }}>
            <ThesisText heading>Timetable</ThesisText>
            <ThesisText>{model.totals.at(-1)} spent / {model.expectedHours} expected hours · {model.plannedWeeks} planned weeks</ThesisText>
            <ThesisText muted>12 hours per week before Christmas; 7.5 hours per weekday from January. Norwegian weekday holidays and weeks 51–53 are excluded. Work on days off still counts.</ThesisText>
            <InlineNotice message={message} tone='info' />
            <Actions key={host}>
                <PillButton label='Log activity' disabled={!enabled} onPress={() => open()} />
                <PillButton label={pdfBusy ? 'Creating PDF…' : 'Export timetable PDF'} disabled={pdfBusy} onPress={() => { setPdfBusy(true); void exportTimetable(sheet.title, model, log).catch(() => setMessage('The PDF could not be created.')).finally(() => setPdfBusy(false)) }} />
            </Actions>
            {form && <GlassCard><View style={{ gap: 10 }}>
                <ThesisText heading>{form.existing ? 'Edit activity' : 'Log activity'}</ThesisText>
                {(['date', 'hours', 'category', 'description'] as const).map(field => <ThesisField key={field} label={`Activity ${field}`} value={form[field]} host={host} enabled={enabled} multiline={field === 'description'} numeric={field === 'hours'} onChange={value => { if (guard()) setForm(current => current ? { ...current, [field]: value } : current) }} />)}
                <Actions key={host}><PillButton label='Keep activity' disabled={!enabled} onPress={save} /><PillButton label='Close activity form' onPress={() => setForm(null)} /></Actions>
            </View></GlassCard>}
            <ThesisField label='Initial timetable year' value={year} onChange={value => { if (guard()) setYear(value) }} enabled={enabled} numeric host={host} />
            <PillButton key={`year:${host}`} label='Apply timetable year' disabled={!enabled} onPress={() => { if (guard() && Number.isInteger(Number(year)) && Number(year) >= 1900 && Number(year) <= 2198) onChange({ ...sheet, activityLog: { ...log, startYear: Number(year) } }, true) }} />
            <ThesisField label='Date in a week to plan (YYYY-MM-DD)' value={date} onChange={value => { if (guard()) setDate(value) }} enabled={enabled} host={host} />
            <PillButton key={`week:${host}`} label='Include week in plan' disabled={!enabled} onPress={() => changeWeek(undefined, date)} />
            {model.weeks.map(week => <GlassCard key={week.key}><View style={{ gap: 10 }}>
                <PillButton label={`${week.key} · ${week.values.at(-1) || '0'} hours`} onPress={() => setExpanded(expanded === week.key ? '' : week.key)} />
                <ThesisText>{model.categories.map((name, i) => `${name}: ${week.values[i] || '0'}`).join(' · ')}</ThesisText>
                {expanded === week.key && <>
                    <ThesisText>{week.start} – {week.end} · {week.expected} expected hours</ThesisText>
                    <ThesisText muted>{week.exclusions.join(' · ')}</ThesisText>
                    {week.legacy && <InlineNotice tone='info' message='Includes earlier totals without dated activity details. New entries are added to those totals.' />}
                    {week.activities.map(activity => <View key={activity.id} style={{ gap: 6 }}><ThesisText>{activity.date} · {activity.hours} h · {activity.category}</ThesisText><ThesisText>{activity.description}</ThesisText><Actions key={host}><PillButton label='Edit activity' disabled={!enabled} onPress={() => open(activity)} /><PillButton label='Remove activity' disabled={!enabled} onPress={() => { if (guard()) onChange({ ...sheet, activityLog: { ...log, activities: log.activities.filter(item => item.id !== activity.id) } }, true) }} /></Actions></View>)}
                    {!week.activities.length && <ThesisText muted>No dated activities for this week.</ThesisText>}
                    <PillButton key={host} label={week.sourceRow !== undefined ? 'Remove week from plan' : 'Include week in plan'} disabled={!enabled} onPress={() => changeWeek(week.key, week.start)} />
                </>}
            </View></GlassCard>)}
            {model.notes.map((note, i) => <ThesisText key={i} muted>{note}</ThesisText>)}
        </View>
    )
}
