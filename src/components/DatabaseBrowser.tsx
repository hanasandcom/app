import { useEffect, useRef, useState } from 'react'
import { Text, View } from 'react-native'
import type { AppSettings } from '../types'
import { browseDatabase, databaseBytes, type DatabaseInstance, type DatabaseItem, type DatabasePage } from '../lib/database-operations'
import { GlassCard, InlineNotice, PillButton, SectionTitle } from './ui'
import { DatabaseInput, DatabaseRows } from './DatabaseQuery'
import { useAppTheme } from '../theme/context'

export function DatabaseBrowser({ settings, instances, stale, signal }: { settings: AppSettings; instances: DatabaseInstance[]; stale: boolean; signal: AbortSignal }) {
    const theme = useAppTheme(), [selection, setSelection] = useState<{ instance: string; database: string } | null>(null)
    const [items, setItems] = useState<DatabaseItem[]>([]), [item, setItem] = useState<DatabaseItem | null>(null), [page, setPage] = useState<DatabasePage | null>(null)
    const [search, setSearch] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [count, setCount] = useState<number | null>(null)
    const epoch = useRef(0), pending = useRef<AbortController | null>(null)
    const row = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 }
    useEffect(() => { const cancel = () => { epoch.current++; pending.current?.abort(); setPage(null); setItems([]); setItem(null); setSelection(null) }; signal.addEventListener('abort', cancel); return () => { signal.removeEventListener('abort', cancel); pending.current?.abort(); epoch.current++ } }, [signal])
    async function load(selected: { instance: string; database: string }, table: DatabaseItem | null, mode: 'contents' | 'rows' | 'count', cursor?: string) {
        if (stale || signal.aborted) return
        const current = ++epoch.current; pending.current?.abort(); const controller = new AbortController(); pending.current = controller
        const cancel = () => controller.abort(); signal.addEventListener('abort', cancel, { once: true }); setBusy(true); setError('')
        try {
            const value = await browseDatabase(settings, { ...selected, mode, ...(table ? { schema: table.schema, table: table.name } : {}), ...(cursor ? { cursor } : {}) }, controller.signal)
            if (controller.signal.aborted || signal.aborted || current !== epoch.current) return
            if (mode === 'count') setCount(value.totalRows ?? null)
            else if (mode === 'contents') { setItems(previous => cursor ? [...previous, ...(value.items || [])] : value.items || []); setPage(value) }
            else setPage(previous => cursor ? { ...value, rows: [...(previous?.rows || []), ...(value.rows || [])], fields: [...new Set([...(previous?.fields || []), ...(value.fields || [])])] } : value)
        } catch { if (!controller.signal.aborted && current === epoch.current) setError('Database preview unavailable. Refresh the inventory and try again.') }
        finally { signal.removeEventListener('abort', cancel); if (current === epoch.current) setBusy(false) }
    }
    return <GlassCard style={{ gap: 12 }}><SectionTitle title='Database inventory' eyebrow='Read-only browser' body={stale ? 'Inventory is stale. Refresh before opening previews.' : 'Select an instance and database, then a table, collection or key.'} />
        {instances.map(instance => <View key={instance.id} style={{ gap: 8 }}><Text style={{ color: theme.text }}>{instance.id} · {instance.engine} · {instance.status}</Text><View style={row}>{instance.databases.map(database => <PillButton key={database.name} small label={`${database.name} · ${databaseBytes(database.sizeBytes)}`} disabled={busy || stale || signal.aborted} tone={selection?.instance === instance.id && selection.database === database.name ? 'accent' : 'default'} onPress={() => { const next = { instance: instance.id, database: database.name }; setSelection(next); setItem(null); setPage(null); setCount(null); void load(next, null, 'contents') }} />)}</View></View>)}
        <InlineNotice message={error} />{selection && <><Text style={{ color: theme.textMuted }}>Browsing {selection.instance} / {selection.database}</Text><DatabaseInput label='Search loaded tables or keys' value={search} onChangeText={setSearch} />
            <View style={row}>{items.filter(value => `${value.schema}.${value.name}`.toLowerCase().includes(search.toLowerCase())).map(value => <PillButton key={`${value.schema}.${value.name}`} small label={`${value.schema ? `${value.schema}.` : ''}${value.name}${value.type ? ` (${value.type})` : ''}`} disabled={busy} tone={item === value ? 'accent' : 'default'} onPress={() => { setItem(value); setPage(null); setCount(null); void load(selection, value, 'rows') }} />)}</View>
            {item && <><Text style={{ color: theme.text }}>{item.name} · {databaseBytes(item.sizeBytes)}{count !== null ? ` · ${count} rows` : ''}</Text><PillButton small label='Count rows' disabled={busy} onPress={() => void load(selection, item, 'count')} />{page?.rows && <DatabaseRows rows={page.rows} fields={page.fields || item.columns || []} />}</>}
            {page?.nextCursor && <PillButton label={item ? 'Load more rows' : 'Load more keys'} disabled={busy} onPress={() => void load(selection, item, item ? 'rows' : 'contents', page.nextCursor!)} />}</>}
        {busy && <Text style={{ color: theme.textMuted }}>Loading preview…</Text>}
    </GlassCard>
}
