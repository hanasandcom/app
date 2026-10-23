import { useRef, useState } from 'react'
import { Alert, ScrollView, Text, TextInput, View, type TextInputProps } from 'react-native'
import { GlassCard, PillButton, SectionTitle } from './ui'
import { useAppTheme } from '../theme/context'
import { databaseCell, type SqlResult } from '../lib/database-operations'

export function DatabaseInput({ label, ...props }: TextInputProps & { label: string }) {
    const theme = useAppTheme()
    return <View style={{ gap: 6 }}><Text style={{ color: theme.textMuted }}>{label}</Text><TextInput {...props} accessibilityLabel={label} autoCorrect={false} autoCapitalize='none' spellCheck={false} autoComplete='off' placeholderTextColor={theme.textSoft} style={{ color: theme.text, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.surfaceBorderSoft, backgroundColor: theme.ambientNeutral }} /></View>
}
export function DatabaseRows({ rows, fields }: { rows: Record<string, unknown>[]; fields: string[] }) {
    const theme = useAppTheme()
    return <ScrollView horizontal accessibilityLabel='Database results'><View style={{ gap: 8 }}>{rows.map((row, index) => <View key={index} style={{ flexDirection: 'row', gap: 12 }}>{fields.map(field => <View key={field} style={{ width: 180, gap: 5 }}><Text style={{ color: theme.textMuted, fontWeight: '600' }}>{field}</Text><Text selectable style={{ color: theme.text }}>{databaseCell(row[field])}</Text></View>)}</View>)}{!rows.length && <Text style={{ color: theme.textMuted }}>No rows returned.</Text>}</View></ScrollView>
}
export function DatabaseQuery({ disabled, readDisabled, reviewEpoch, onRun, onInspect }: { disabled: boolean; readDisabled: boolean; reviewEpoch: number; onRun: (sql: string, epoch: number) => Promise<SqlResult | null>; onInspect: (schema: string, table: string, limit: number, epoch: number) => Promise<SqlResult | null> }) {
    const theme = useAppTheme(), [sql, setSql] = useState(''), [result, setResult] = useState<SqlResult | null>(null)
    const [schema, setSchema] = useState('public'), [table, setTable] = useState(''), [limit, setLimit] = useState('50')
    const latest = useRef({ sql, disabled, reviewEpoch, schema, table, limit }); latest.current = { sql, disabled, reviewEpoch, schema, table, limit }
    function review() {
        if (disabled || !sql.trim()) return
        const snapshot = { ...latest.current }
        Alert.alert('Execute SQL on Core?', `Target: configured Core database. The inventory selection does not change this target. SQL can modify or delete data.\n\n${snapshot.sql}`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Execute statement', style: 'destructive', onPress: () => {
            if (latest.current.disabled || latest.current.sql !== snapshot.sql || latest.current.reviewEpoch !== snapshot.reviewEpoch) return
            void onRun(snapshot.sql, snapshot.reviewEpoch).then(value => { if (latest.current.reviewEpoch === snapshot.reviewEpoch && value) setResult(value) })
        } }])
    }
    return <GlassCard style={{ gap: 12 }}><SectionTitle title='Core table rows' eyebrow='Fixed Core target' body='These schema and table names refer to the configured Core database. Inventory selection does not change this target.' /><DatabaseInput label='Core schema' value={schema} onChangeText={setSchema} editable={!readDisabled} /><DatabaseInput label='Core table' value={table} onChangeText={setTable} editable={!readDisabled} /><DatabaseInput label='Core row limit (1–500)' value={limit} onChangeText={setLimit} keyboardType='number-pad' editable={!readDisabled} /><PillButton label='Inspect Core table rows' disabled={readDisabled || !table} onPress={() => { const current = reviewEpoch, selection = { schema, table, limit }; void onInspect(schema, table, Number(limit), current).then(value => { if (latest.current.reviewEpoch === current && latest.current.schema === selection.schema && latest.current.table === selection.table && latest.current.limit === selection.limit && value) setResult(value) }) }} /><SectionTitle title='SQL editor' eyebrow='Fixed Core target' body='Every statement runs against the configured Core database, not the inventory database selected above. Statements can change data; SELECT text is not treated as a safety guarantee.' /><DatabaseInput label='SQL statement' value={sql} multiline editable={!disabled} onChangeText={setSql} /><PillButton label='Review SQL statement' disabled={disabled || !sql.trim()} onPress={review} />{result && <><Text style={{ color: theme.textMuted }}>{result.rowCount} returned rows</Text><DatabaseRows rows={result.rows} fields={result.fields} /></>}</GlassCard>
}
