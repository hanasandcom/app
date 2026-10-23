import { useMemo, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { GlassCard, PillButton } from './ui'
import { useAppTheme } from '../theme/context'
import { jsonChunks, object, referencedSchemas, resolveReference, securityLabel, text, type ApiDocument, type ReferenceOperation } from '../lib/api-reference'
import { responseExamples } from '../data/api-reference-data'

export function ApiReferenceJson({ value }: { value: unknown }) {
    const theme = useAppTheme()
    const pages = useMemo(() => jsonChunks(value), [value])
    const [page, setPage] = useState(0)
    const current = Math.min(page, pages.length - 1)
    return <View style={{ gap: 10 }}>
        <Text style={{ color: theme.textMuted }}>JSON page {current + 1} of {pages.length} · Select text to copy</Text>
        <ScrollView horizontal>
            <Text selectable style={{ color: theme.text, fontFamily: 'monospace', fontSize: 12, lineHeight: 18 }}>{pages[current]}</Text>
        </ScrollView>
        {pages.length > 1 && <View style={{ flexDirection: 'row', gap: 8 }}>
            <PillButton small label='Previous JSON page' disabled={current === 0} onPress={() => setPage(current - 1)} />
            <PillButton small label='Next JSON page' disabled={current === pages.length - 1} onPress={() => setPage(current + 1)} />
        </View>}
    </View>
}
function ReferenceValue({ document, value }: { document: ApiDocument; value: unknown }) {
    const theme = useAppTheme()
    const resolved = resolveReference(document, value)
    const [selected, setSelected] = useState('')
    const references = referencedSchemas(resolved.value).filter((reference) => reference !== resolved.reference)
    return <View style={{ gap: 6 }}>
        {!!resolved.reference && <Text selectable style={{ color: theme.textMuted }}>{resolved.reference}{resolved.resolved ? '' : ' · Unresolved; external references are not fetched.'}</Text>}
        <ApiReferenceJson value={resolved.value} />
        {references.map((reference) => <PillButton key={reference} small label={`View reference ${reference}`} onPress={() => setSelected(selected === reference ? '' : reference)} />)}
        {!!selected && <View style={{ gap: 6 }}>
            <Text selectable style={{ color: theme.textMuted }}>{selected}{resolveReference(document, { $ref: selected }).resolved ? '' : ' · Unresolved; no external document was fetched.'}</Text>
            <ApiReferenceJson key={selected} value={resolveReference(document, { $ref: selected }).value} />
        </View>}
    </View>
}
export function ApiReferenceOperation({ document, row, application = false }: {
    document: ApiDocument; row: ReferenceOperation; application?: boolean
}) {
    const theme = useAppTheme()
    const [expanded, setExpanded] = useState(false)
    const operation = row.operation
    const body = resolveReference(document, operation.requestBody).value
    const responses = object(operation.responses) ? Object.entries(operation.responses) : []
    const example = responseExamples[`${row.method} ${row.path}`]
    const security = application ? undefined : operation.security ?? document.security
    const schemes = object(document.components) && object(document.components.securitySchemes) ? document.components.securitySchemes : {}
    return <GlassCard style={{ gap: 10 }}>
        <Pressable accessibilityRole='button' accessibilityState={{ expanded }} accessibilityLabel={`${row.method} ${row.path}`} onPress={() => setExpanded(!expanded)} style={{ gap: 6, minHeight: 44 }}>
            <Text selectable style={{ color: theme.accentAlt, fontWeight: '700' }}>{row.method} {row.path}</Text>
            <Text style={{ color: theme.text, fontWeight: '600' }}>{text(operation.summary) || text(operation.operationId) || 'Operation'}</Text>
            <Text style={{ color: theme.textMuted }}>{expanded ? 'Hide details' : 'Show details'}</Text>
        </Pressable>
        {expanded && <View style={{ gap: 12 }}>
            <Text style={{ color: theme.textMuted }}>{application ? 'Application authentication applies; this snapshot does not specify every access rule.' : `Security: ${securityLabel(document, operation)}`}</Text>
            {!!text(operation.description) && <Text selectable style={{ color: theme.text }}>{text(operation.description)}</Text>}
            {Array.isArray(security) && security.flatMap((item) => object(item) ? Object.keys(item) : []).filter((name, index, all) => all.indexOf(name) === index).map((name) =>
                <View key={name} style={{ gap: 6 }}><Text style={{ color: theme.textMuted }}>Security scheme: {name}</Text><ReferenceValue document={document} value={schemes[name] ?? { unavailable: name }} /></View>)}
            {Array.isArray(operation.parameters) && operation.parameters.length > 0 && <View style={{ gap: 6 }}>
                <Text style={{ color: theme.text, fontWeight: '600' }}>Parameters</Text>
                {operation.parameters.map((parameter, index) => <ReferenceValue key={index} document={document} value={parameter} />)}
            </View>}
            <Text style={{ color: theme.text, fontWeight: '600' }}>Request body {object(body) ? body.required === true ? '· Required' : '· Optional' : ''}</Text>
            {object(body) ? <>
                {!!text(body.description) && <Text style={{ color: theme.text }}>{text(body.description)}</Text>}
                {object(body.content) ? Object.entries(body.content).map(([media, content]) => <View key={media} style={{ gap: 6 }}>
                    <Text style={{ color: theme.textMuted }}>{media}</Text>
                    <ReferenceValue document={document} value={object(content) ? content.schema ?? content : content} />
                </View>) : <ReferenceValue document={document} value={operation.requestBody} />}
            </> : <Text style={{ color: theme.textMuted }}>No request body.</Text>}
            <Text style={{ color: theme.text, fontWeight: '600' }}>Responses</Text>
            {responses.length === 0 && <Text style={{ color: theme.textMuted }}>Response schema not specified in this documentation snapshot.</Text>}
            {responses.map(([status, value]) => {
                const response = resolveReference(document, value).value
                return <View key={status} style={{ gap: 6 }}>
                    <Text style={{ color: theme.accentAlt }}>{status}{object(response) && text(response.description) ? ` · ${text(response.description)}` : ''}</Text>
                    <ReferenceValue document={document} value={value} />
                </View>
            })}
            {example && <View style={{ gap: 6 }}>
                <Text style={{ color: theme.text, fontWeight: '600' }}>Fictional example · HTTP {example.status}</Text>
                <Text style={{ color: theme.textMuted }}>Selected fields from the website guide. Names, addresses and credentials are illustrative.</Text>
                <ApiReferenceJson value={example.body} />
            </View>}
        </View>}
    </GlassCard>
}
