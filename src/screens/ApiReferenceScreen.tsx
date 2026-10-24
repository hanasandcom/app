import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, Pressable, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import type { AppSettings } from '../types'
import { GlassCard, InlineNotice, LabeledInput, PillButton, Screen, StatChip } from '../components/ui'
import { ApiReferenceJson, ApiReferenceOperation } from '../components/ApiReferenceOperation'
import { useAppTheme } from '../theme/context'
import { applicationEndpoints } from '../data/api-reference-data'
import { loadOpenApi, object, operations, operationMatches, referenceScope, ReferenceRequests, text, type ApiDocument } from '../lib/api-reference'

type Props = { settings: AppSettings; mode: 'reference' | 'json'; onOpenJson: () => void; onOpenGuide: () => void; transport?: typeof fetch }
type Section = 'Public API' | 'Application API' | 'Schemas'
export function ApiReferenceScreen(props: Props) {
    return <Reference key={referenceScope(props.settings, props.mode)} {...props} />
}
function Reference({ settings, mode, onOpenJson, onOpenGuide, transport }: Props) {
    const theme = useAppTheme()
    const [document, setDocument] = useState<ApiDocument | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [query, setQuery] = useState('')
    const [section, setSection] = useState<Section>('Public API')
    const [shown, setShown] = useState(30)
    const [schema, setSchema] = useState('')
    const requests = useRef(new ReferenceRequests())
    const mounted = useRef(true), focused = useRef(false), foreground = useRef(AppState.currentState === 'active')
    const running = useRef(false)
    const visible = () => mounted.current && focused.current && foreground.current
    function hide() { requests.current.invalidate(); running.current = false; setBusy(false) }
    async function refresh() {
        if (!visible() || running.current) return
        const operation = requests.current.start()
        running.current = true; setBusy(true); setError(''); setDocument(null)
        try {
            const result = await loadOpenApi(settings.siteBaseUrl, operation.controller.signal, transport)
            if (requests.current.canApply(operation, visible())) setDocument(result)
        } catch (cause) {
            if (requests.current.canApply(operation, visible())) setError(cause instanceof Error ? cause.message : 'API documentation is unavailable. Refresh to retry.')
        } finally {
            if (requests.current.canApply(operation, visible())) { running.current = false; setBusy(false) }
        }
    }
    useFocusEffect(useCallback(() => {
        mounted.current = true; focused.current = true
        if (foreground.current) void refresh()
        return () => { focused.current = false; hide() }
    }, []))
    useEffect(() => {
        mounted.current = true
        const subscription = AppState.addEventListener('change', (state) => {
            const returning = !foreground.current && state === 'active'
            foreground.current = state === 'active'
            if (!foreground.current) hide()
            else if (returning && focused.current) void refresh()
        })
        return () => { mounted.current = false; requests.current.invalidate(); subscription.remove() }
    }, [])
    const publicOperations = useMemo(() => document ? operations(document) : [], [document])
    const appOperations = useMemo(() => applicationEndpoints.map(({ method, path, ...operation }) => ({ method, path, operation })), [])
    const schemas = document && object(document.components) && object(document.components.schemas) ? document.components.schemas : {}
    const needle = query.trim().toLowerCase()
    const rows = (section === 'Application API' ? appOperations : publicOperations).filter((row) => operationMatches(row, query))
    const schemaRows = Object.entries(schemas).filter(([name, value]) => `${name} ${JSON.stringify(value)}`.toLowerCase().includes(needle)).sort(([a], [b]) => a.localeCompare(b))
    const servers = document && Array.isArray(document.servers) ? document.servers.filter(object) : []
    const label = { color: theme.textMuted }
    function search(next: string) { setQuery(next); setShown(30); setSchema('') }
    return <Screen title={mode === 'json' ? 'OpenAPI JSON' : 'API reference'} subtitle='API documentation'>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <PillButton label={busy ? 'Loading documentation…' : 'Refresh documentation'} disabled={busy} onPress={() => void refresh()} />
            {mode === 'reference' && <PillButton label='OpenAPI JSON' onPress={onOpenJson} />}
            <PillButton label='Public guide · Website' onPress={onOpenGuide} />
        </View>
        <InlineNotice message={error} />
        {document && <>
            <GlassCard style={{ gap: 10 }}>
                <Text selectable style={{ color: theme.text, fontWeight: '700', fontSize: 20 }}>{document.info.title}</Text>
                {!!document.info.description && <Text selectable style={label}>{document.info.description}</Text>}
                <Text selectable style={label}>Base URL: {text(servers[0]?.url) || 'Not declared in the contract'}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    <StatChip label='Version' value={document.info.version} />
                    <StatChip label='Operations' value={String(publicOperations.length)} />
                    <StatChip label='Schemas' value={String(Object.keys(schemas).length)} />
                </View>
            </GlassCard>
            {mode === 'json' ? <GlassCard><ApiReferenceJson value={document} /></GlassCard> : <>
                <LabeledInput label='Search endpoints and schemas' value={query} onChangeText={search} autoCapitalize='none' autoCorrect={false} placeholder='Path, method, description or schema' />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {(['Public API', 'Application API', 'Schemas'] as Section[]).map((item) => <PillButton key={item} small label={item} tone={section === item ? 'accent' : 'default'} onPress={() => { setSection(item); setShown(30); setSchema('') }} />)}
                </View>
                {section === 'Application API' && <InlineNotice tone='info' message='Application API reference. Examples use fictional data.' />}
                <Text style={label}>{section === 'Schemas' ? schemaRows.length : rows.length} matching {section === 'Schemas' ? 'schemas' : 'operations'} · showing up to {shown}</Text>
                {section !== 'Schemas' && rows.slice(0, shown).map((row) => <ApiReferenceOperation key={`${section}:${row.method}:${row.path}`} document={document} row={row} application={section === 'Application API'} />)}
                {section === 'Schemas' && schemaRows.slice(0, shown).map(([name, value]) => <GlassCard key={name} style={{ gap: 10 }}>
                    <Pressable accessibilityRole='button' accessibilityState={{ expanded: schema === name }} onPress={() => setSchema(schema === name ? '' : name)} style={{ minHeight: 44, justifyContent: 'center' }}>
                        <Text style={{ color: theme.text, fontWeight: '600' }}>{name} · {schema === name ? 'Hide schema' : 'Show schema'}</Text>
                    </Pressable>
                    {schema === name && <ApiReferenceJson value={value} />}
                </GlassCard>)}
                {(section === 'Schemas' ? schemaRows.length : rows.length) === 0 && <InlineNotice tone='info' message='No matching documentation entries.' />}
                {(section === 'Schemas' ? schemaRows.length : rows.length) > shown && <PillButton label='Show 30 more entries' onPress={() => setShown(shown + 30)} />}
            </>}
        </>}
        {!document && !busy && !error && <InlineNotice tone='info' message='Refresh to load the public API contract.' />}
    </Screen>
}
