import { useState } from 'react'
import { View } from 'react-native'
import Svg, { Polyline, Circle } from 'react-native-svg'
import { GlassCard, PillButton, StatChip } from '../../components/ui'
import { useAppTheme } from '../../theme/context'
import { metricFields, type Scoped, type VmMetric } from './model'
import { metricSegments } from './metrics'
import { VmRow, VmText, VmValue } from './ui'
export function MetricsPanel({ metrics, current }: { metrics: Scoped<VmMetric[]> | null; current: () => boolean }) {
    const theme = useAppTheme(), [selected, setSelected] = useState<number | null>(null), [limit, setLimit] = useState(20)
    const rows = metrics?.value, latest = rows?.[0]
    const measured = (v: number | null | undefined, unit: string) => v === null || v === undefined ? 'Unavailable' : `${v.toFixed(1)} ${unit}`
    const segments = metricSegments([...(rows || [])].reverse(), 'cpu_usage_percent')
    return <GlassCard>
        <VmText strong>Metrics</VmText>
        {!rows ? <VmText>Metrics unavailable.</VmText> : !rows.length ? <VmText>No metric samples were returned.</VmText> : <>
            <VmText>Latest sample · {latest?.created_at || 'Timestamp unavailable'}</VmText>
            <VmRow><StatChip label='CPU' value={measured(latest?.cpu_usage_percent, '%')} /><StatChip label='RAM used' value={measured(latest?.ram_used_mb, 'MiB')} /></VmRow>
            <VmRow><StatChip label='Disk used' value={measured(latest?.disk_used_mb, 'MiB')} /><StatChip label='Network in / out' value={`${measured(latest?.net_in_kbps, 'kbps')} / ${measured(latest?.net_out_kbps, 'kbps')}`} /></VmRow>
            <VmText>CPU history · oldest → newest · {rows.length} loaded samples. Gaps indicate unavailable measurements.</VmText>
            <View accessibilityLabel='CPU metric history' style={{ height: 100 }}>
                <Svg width='100%' height='100%' viewBox='-2 -10 284 100'>
                    {segments.map((points, index) => points.includes(' ') ? <Polyline key={index} points={points} fill='none' stroke={theme.accent} strokeWidth={2} /> : <Circle key={index} cx={Number(points.split(',')[0])} cy={Number(points.split(',')[1])} r={2} fill={theme.accent} />)}
                </Svg>
            </View>
            <VmText strong>Inspect a sample</VmText>
            <VmRow>{rows.slice(0, limit).map((sample, index) => <PillButton key={`${sample.id}:${index}`} small label={`${selected === index ? '✓ ' : ''}${sample.created_at || `Sample ${index + 1}`} · ${measured(sample.cpu_usage_percent, '%')}`} onPress={() => { if (current()) setSelected(value => value === index ? null : index) }} />)}</VmRow>
            {limit < rows.length && <PillButton label='Show more loaded samples' onPress={() => { if (current()) setLimit(n => n + 20) }} />}
            {selected !== null && rows[selected] && <GlassCard>
                <VmText strong>{rows[selected].created_at || 'Timestamp unavailable'}</VmText>
                {metricFields.map(field => <VmValue key={field} label={field.replaceAll('_', ' ')} value={rows[selected][field]} />)}
                <VmValue label='Power state' value={rows[selected].power_state} />
                <VmValue label='Powered on at' value={rows[selected].powered_on_at} /><VmValue label='Powered off at' value={rows[selected].powered_off_at} />
            </GlassCard>}
        </>}
    </GlassCard>
}
