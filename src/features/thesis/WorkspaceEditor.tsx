import { useState } from 'react'
import * as Crypto from 'expo-crypto'
import { View } from 'react-native'
import { GlassCard, InlineNotice, PillButton } from '../../components/ui'
import type { ThesisDocument } from './document'
import { identifiedSheets, replaceTableAt, tables, writeSheets, writeTable, type Sheet } from './workspace'
import { Actions, ThesisField, ThesisText } from './ui'
import { MarkdownView } from './MarkdownView'
import { TableEditor } from './TableEditor'
import { TimetableSheet } from './TimetableSheet'
import { PlanSheet } from './PlanSheet'

export function WorkspaceEditor({ value, enabled, host, guard, onChange, onContext, onHistory, onCode }: { value: ThesisDocument; enabled: boolean; host: number; guard: () => boolean; onChange: (value: ThesisDocument, group?: string, structural?: boolean) => void; onContext: () => void; onHistory: () => void; onCode: () => void }) {
    const sheets = identifiedSheets(value.title, value.body)
    const [selection, setSelection] = useState('Overview')
    const [source, setSource] = useState(false)
    const [newName, setNewName] = useState('')
    const [deleteName, setDeleteName] = useState('')
    const [rows, setRows] = useState('3')
    const [columns, setColumns] = useState('3')
    const [selectedTable, setTable] = useState(0)
    const [error, setError] = useState('')
    const active = Math.max(0, sheets.findIndex(sheet => sheet.id === selection))
    const sheet = sheets[active], parsed = tables(sheet.body), tableIndex = Math.min(selectedTable, parsed.length - 1)
    const timetable = sheet.id === 'Timetable' || sheet.name.toLowerCase() === 'timetable'
    const plan = sheet.id === 'Plan' || sheet.name.toLowerCase() === 'plan'
    const codeEnabled = sheet.settings?.codeReview ?? sheet.name.toLowerCase() === 'code'
    function updateSheets(next: Sheet[], group?: string, structural = false) {
        if (!enabled || !guard()) return
        onChange({ ...value, body: writeSheets(next) }, group, structural)
    }
    function update(next: Sheet, structural = false, group = '') {
        updateSheets(sheets.map((old, index) => index === active ? next : old), `${sheet.id}:${group}`, structural)
    }
    function choose(id: string) { onContext(); setSelection(id); setDeleteName(''); setTable(0); setError('') }
    function create() {
        if (!enabled || !guard()) return
        const name = newName.trim()
        if (!name || name.length > 100) { setError('Enter a page name of 1–100 characters.'); return }
        const id = Crypto.randomUUID()
        updateSheets([...sheets, { id, name, title: '# ' + name, body: '' }], undefined, true)
        setSelection(id); setNewName('')
    }
    function remove() {
        if (!enabled || !guard() || sheets.length <= 1 || deleteName !== sheet.name) return
        const next = sheets.filter(item => item.id !== sheet.id)
        updateSheets(next, undefined, true); setSelection(next[Math.max(0, active - 1)].id); setDeleteName('')
    }
    function insertTable() {
        if (!enabled || !guard()) return
        const r = Number(rows), c = Number(columns)
        if (!Number.isInteger(r) || !Number.isInteger(c) || r < 1 || r > 100 || c < 1 || c > 20) { setError('Choose 1–100 rows and 1–20 columns.'); return }
        const cells = Array.from({ length: r }, (_, row) => Array.from({ length: c }, (_, col) => row === 0 ? `Column ${col + 1}` : ''))
        update({ ...sheet, body: sheet.body + '\n\n' + writeTable({ cells, widths: [], heights: [] }) }, true)
        setTable(parsed.length)
    }
    return (
        <View style={{ gap: 14 }}>
            <Actions key={`pages:${host}`}>{sheets.map(item => <PillButton key={item.id} label={`${item.id === sheet.id ? '✓ ' : ''}${item.name}`} onPress={() => choose(item.id)} />)}</Actions>
            <GlassCard><View style={{ gap: 10 }}>
                <ThesisText heading>{sheet.name}</ThesisText>
                <ThesisField label='Sheet title' value={sheet.title} host={host} enabled={enabled} onChange={title => update({ ...sheet, title }, false, 'title')} />
                <Actions key={host}>
                    <PillButton label={source ? 'Preview Markdown' : 'Edit Markdown'} onPress={() => { onContext(); setSource(!source) }} />
                    {sheet.settings?.history !== false && <PillButton label='Version history' onPress={onHistory} />}
                    {codeEnabled && <PillButton label='Source inventory and review' onPress={onCode} />}
                </Actions>
                {source ? <ThesisField label='Sheet Markdown' value={sheet.body} onChange={body => update({ ...sheet, body }, false, 'body')} enabled={enabled} host={host} multiline /> : <MarkdownView source={sheet.body} />}
            </View></GlassCard>
            {timetable && <TimetableSheet sheet={sheet} host={host} enabled={enabled} guard={guard} onChange={update} />}
            {plan && parsed.length > 0 && <PlanSheet data={parsed[0].data} host={host} enabled={enabled} guard={guard} onChange={data => update({ ...sheet, body: replaceTableAt(sheet.body, parsed[0], data) }, false, 'plan')} />}
            {parsed.length > 0 && <GlassCard><View style={{ gap: 12 }}>
                <ThesisText heading>Table editor</ThesisText>
                <Actions>{parsed.map((_, index) => <PillButton key={index} label={`Table ${index + 1}`} onPress={() => { onContext(); setTable(index) }} />)}</Actions>
                <TableEditor key={`${sheet.id}:${tableIndex}`} data={parsed[tableIndex].data} enabled={enabled} host={host} guard={guard} onChange={(data, structural) => update({ ...sheet, body: replaceTableAt(sheet.body, parsed[tableIndex], data) }, structural, `table:${tableIndex}`)} />
                <PillButton key={host} label='Delete selected table' disabled={!enabled} tone='danger' onPress={() => { if (guard()) update({ ...sheet, body: sheet.body.slice(0, parsed[tableIndex].start) + sheet.body.slice(parsed[tableIndex].end) }, true) }} />
            </View></GlassCard>}
            {sheet.settings?.insertTable !== false && <GlassCard><View style={{ gap: 10 }}>
                <ThesisText heading>Insert table</ThesisText>
                <ThesisField label='Rows (1–100)' value={rows} onChange={v => { if (guard()) setRows(v) }} enabled={enabled} numeric host={host} />
                <ThesisField label='Columns (1–20)' value={columns} onChange={v => { if (guard()) setColumns(v) }} enabled={enabled} numeric host={host} />
                <PillButton key={host} label='Insert table' onPress={insertTable} disabled={!enabled} />
            </View></GlassCard>}
            <GlassCard><View style={{ gap: 10 }}>
                <ThesisText heading>Pages and features</ThesisText>
                <ThesisField label='Page name' value={sheet.name} host={host} enabled={enabled} onChange={name => { if (name.length <= 100) update({ ...sheet, name }, false, 'name') }} />
                <Actions key={host}>{(['insertTable', 'history', 'codeReview'] as const).map(key => {
                    const on = sheet.settings?.[key] ?? (key === 'codeReview' ? codeEnabled : true)
                    return <PillButton key={key} label={`${on ? '✓ ' : ''}${key === 'insertTable' ? 'Table insertion' : key === 'history' ? 'History' : 'Code review'}`} disabled={!enabled} onPress={() => update({ ...sheet, settings: { ...sheet.settings, [key]: !on } }, true)} />
                })}</Actions>
                <ThesisField label='New page name' value={newName} onChange={v => { if (guard()) setNewName(v) }} enabled={enabled} host={host} />
                <PillButton key={`new:${host}`} label='Add page' disabled={!enabled} onPress={create} />
                <ThesisField label={`Type ${sheet.name} to delete this page`} value={deleteName} onChange={v => { if (guard()) setDeleteName(v) }} enabled={enabled} host={host} />
                <PillButton key={`delete:${host}`} label='Delete this page' tone='danger' disabled={!enabled || sheets.length <= 1 || deleteName !== sheet.name} onPress={remove} />
                <ThesisText muted>Deleting a page keeps earlier shared versions. Undo can restore an unsaved deletion.</ThesisText>
                <InlineNotice message={error} />
            </View></GlassCard>
        </View>
    )
}
