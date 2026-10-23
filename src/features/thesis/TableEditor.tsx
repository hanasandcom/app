import { useRef, useState } from 'react'
import { Pressable, ScrollView, Share, View } from 'react-native'
import { PillButton } from '../../components/ui'
import { useAppTheme } from '../../theme/context'
import { cellValue, columnName, reshape, type TableData } from './workspace'
import { Actions, ThesisField, ThesisText } from './ui'
import { thesisActionKey } from './policy'

export function TableEditor({ data, onChange, enabled, host, guard, readGuard }: { data: TableData; onChange: (value: TableData, structural?: boolean) => void; enabled: boolean; host: number; guard: () => boolean; readGuard: () => boolean }) {
    const theme = useAppTheme()
    const [selected, select] = useState({ row: 0, col: 0 })
    const [range, setRange] = useState('A1:B2')
    const [limit, setLimit] = useState(30)
    const row = Math.min(selected.row, data.cells.length - 1), col = Math.min(selected.col, data.cells[0].length - 1)
    const context = thesisActionKey(host, row, col)
    const current = useRef({ data, guard, enabled, context }); current.current = { data, guard, enabled, context }
    const address = `${columnName(col)}${row + 1}`
    function change(value: string) {
        if (current.current.context !== context || !current.current.enabled || !guard()) return
        const cells = current.current.data.cells.map(line => [...line]); cells[row][col] = value
        onChange({ ...current.current.data, cells })
    }
    function structure(axis: 'row' | 'column', at: number, remove = false) {
        if (current.current.context !== context || !current.current.enabled || !guard()) return
        if (remove && (axis === 'row' ? at === 0 || data.cells.length < 2 : data.cells[0].length < 2)) return
        if (!remove && (axis === 'row' ? data.cells.length >= 10000 : data.cells[0].length >= 100)) return
        onChange(reshape(data, axis, at, remove), true)
    }
    function shareRange() {
        if (!readGuard() || current.current.context !== context) return
        const match = /^([A-Z]+)([1-9]\d*):([A-Z]+)([1-9]\d*)$/i.exec(range.trim())
        if (!match) return
        const column = (value: string) => [...value.toUpperCase()].reduce((sum, c) => sum * 26 + c.charCodeAt(0) - 64, 0) - 1
        const r1 = Number(match[2]) - 1, r2 = Number(match[4]) - 1, c1 = column(match[1]), c2 = column(match[3])
        if (Math.max(r1, r2) >= data.cells.length || Math.max(c1, c2) >= data.cells[0].length) return
        const lines = data.cells.slice(Math.min(r1, r2), Math.max(r1, r2) + 1).map((line, r) => line.slice(Math.min(c1, c2), Math.max(c1, c2) + 1).map((_, c) => cellValue(data.cells, Math.min(r1, r2) + r, Math.min(c1, c2) + c)).join('\t'))
        void Share.share({ title: 'Thesis cells', message: lines.join('\n') })
    }
    return (
        <View style={{ gap: 12 }}>

            <ScrollView horizontal>
                <View>{data.cells.slice(0, limit).map((line, r) => <View key={`${host}:${r}`} style={{ flexDirection: 'row' }}>{line.map((_, c) => <Pressable
                    key={c}
                    accessibilityRole='button'
                    accessibilityLabel={`Select ${columnName(c)}${r + 1}`}
                    onPress={() => select({ row: r, col: c })}
                    style={{ width: data.widths[c] || 180, minHeight: data.heights[r] || 48, padding: 10, borderWidth: 1, borderColor: row === r && col === c ? theme.accent : theme.surfaceBorder }}
                >
                    <ThesisText>{cellValue(data.cells, r, c)}</ThesisText>
                </Pressable>)}</View>)}</View>
            </ScrollView>

            {data.cells.length > limit && <PillButton label='Show more rows' onPress={() => setLimit(v => v + 30)} />}

            <ThesisField
                key={`${address}:${host}`}
                label={`Cell ${address}`}
                value={data.cells[row][col]}
                onChange={change}
                enabled={enabled}
                multiline
                host={host}
            />

            <Actions key={`navigate:${context}`}>

                <PillButton
                    label='Previous cell'
                    onPress={() => select({ row: col ? row : Math.max(0, row - 1), col: col ? col - 1 : data.cells[0].length - 1 })}
                />

                <PillButton
                    label='Next cell'
                    onPress={() => select({ row: col + 1 < data.cells[0].length ? row : Math.min(data.cells.length - 1, row + 1), col: (col + 1) % data.cells[0].length })}
                />
            </Actions>

            <Actions key={`structure:${context}`}>

                <PillButton label='Row above' disabled={!enabled} onPress={() => structure('row', Math.max(1, row))} />

                <PillButton label='Row below' disabled={!enabled} onPress={() => structure('row', row + 1)} />

                <PillButton label='Delete row' disabled={!enabled || row === 0} onPress={() => structure('row', row, true)} />

                <PillButton label='Column left' disabled={!enabled} onPress={() => structure('column', col)} />

                <PillButton label='Column right' disabled={!enabled} onPress={() => structure('column', col + 1)} />

                <PillButton
                    label='Delete column'
                    disabled={!enabled || data.cells[0].length === 1}
                    onPress={() => structure('column', col, true)}
                />
            </Actions>

            <ThesisField
                label={`Column ${columnName(col)} width (40–1200)`}
                value={String(data.widths[col] || 180)}
                enabled={enabled}
                host={host}
                numeric
                onChange={value => { if (!guard() || !Number.isFinite(Number(value))) return; const widths = [...data.widths]; widths[col] = Math.max(40, Math.min(1200, Number(value))); onChange({ ...data, widths }) }}
            />

            <ThesisField
                label={`Row ${row + 1} height (40–1200)`}
                value={String(data.heights[row] || 48)}
                enabled={enabled}
                host={host}
                numeric
                onChange={value => { if (!guard() || !Number.isFinite(Number(value))) return; const heights = [...data.heights]; heights[row] = Math.max(40, Math.min(1200, Number(value))); onChange({ ...data, heights }) }}
            />

            <ThesisField label='Cell range to share' value={range} onChange={setRange} />

            <PillButton key={`share:${context}`} label='Share selected cells' onPress={shareRange} />
        </View>
    )
}
