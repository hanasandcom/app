import { useState } from 'react'
import { Text, View } from 'react-native'
import type { FindingEvidence as Evidence } from '../lib/findings'
import { GlassCard, PillButton, SectionTitle } from './ui'
import { useAppTheme } from '../theme/context'

export function FindingEvidence({ items }: { items: Evidence[] }) {
    const theme = useAppTheme(), [page, setPage] = useState(0)
    const current = Math.min(page, Math.max(0, Math.ceil(items.length / 10) - 1))
    const meta = { color: theme.textMuted, fontSize: 13, lineHeight: 20 }
    if (!items.length) return <Text style={meta}>No retained evidence is attached to this finding.</Text>
    return <View style={{ gap: 12 }}>
        <Text style={meta}>{items.length} retained evidence records</Text>
        {items.slice(current * 10, (current + 1) * 10).map(item => <GlassCard key={item.id} style={{ gap: 8 }}>
            <SectionTitle eyebrow={label(item.captureMode) || 'Capture mode not recorded'} title={item.sourceName} />
            <Text style={meta}>Observed: {time(item.observedAt)}</Text>
            <Text style={meta}>Published: {time(item.publishedAt)}</Text>
            <Text style={meta}>Collected: {time(item.collectedAt)}</Text>
            {!!item.redactionState && <Text style={meta}>{label(item.redactionState)}</Text>}
            <Text selectable style={{ color: theme.text, fontSize: 14, lineHeight: 22 }}>{item.excerpt}</Text>
            <Text selectable style={meta}>Capture: {item.captureId || 'Not recorded'}</Text>
            <Text selectable style={meta}>Content hash: {item.contentHash || 'Not recorded'}</Text>
        </GlassCard>)}
        {items.length > 10 && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <PillButton small label='Previous evidence' disabled={current === 0} onPress={() => setPage(current - 1)} />
            <PillButton small label='Next evidence' disabled={(current + 1) * 10 >= items.length} onPress={() => setPage(current + 1)} />
            <Text style={meta}>{current * 10 + 1}–{Math.min((current + 1) * 10, items.length)} of {items.length}</Text>
        </View>}
    </View>
}
export function time(value: string) {
    return value && Number.isFinite(Date.parse(value)) ? `${new Date(value).toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})` : 'Not recorded'
}
function label(value: string) { return value.replaceAll('_', ' ') }
