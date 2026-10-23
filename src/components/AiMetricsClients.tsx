import { useState } from 'react'
import { Text, View } from 'react-native'
import { GlassCard, PillButton, SectionTitle } from './ui'
import { useAppTheme } from '../theme/context'
import { aiPercent, aiValue, type AiMetricsClient, type AiSensor } from '../lib/ai-metrics'

export function AiMetricsText({ children }: { children: React.ReactNode }) {
    const theme = useAppTheme()
    return <Text selectable style={{ color: theme.textMuted, lineHeight: 20 }}>{children}</Text>
}
function Sensors({ title, sensors }: { title: string; sensors: AiSensor[] | null }) {
    return <View style={{ gap: 8 }}>
        <AiMetricsText>{title}: {sensors === null ? 'Unavailable' : `${sensors.length} sensors`}</AiMetricsText>
        {sensors?.map((sensor, index) => <View key={`${sensor.name}:${index}`} style={{ gap: 3 }}>
            <AiMetricsText>{sensor.name || `${title} ${index + 1}`} · {aiPercent(sensor.load)}</AiMetricsText>
            {title === 'GPU' && <AiMetricsText>
                Memory {aiValue(sensor.memoryUsedMb, ' MB')} / {aiValue(sensor.memoryTotalMb, ' MB')}
                {'\n'}Power {aiValue(sensor.powerDrawWatts, ' W')} · Temperature {aiValue(sensor.temperatureC, '°C')}
            </AiMetricsText>}
        </View>)}
    </View>
}
export function AiMetricsClients({ clients, selected, disabled, onTest }: {
    clients: AiMetricsClient[]; selected: string; disabled: boolean; onTest: (name: string) => void
}) {
    const [expanded, setExpanded] = useState('')
    return <View style={{ gap: 14 }}>
        {!clients.length && <AiMetricsText>No connected model clients are reported. This does not establish inference health.</AiMetricsText>}
        {clients.map(client => <GlassCard key={client.name} style={{ gap: 12 }}>
            <SectionTitle eyebrow={client.model.status || 'Status unavailable'} title={client.displayName || client.name} body={[client.modelId, client.profile].filter(Boolean).join(' · ')} />
            <AiMetricsText>
                Throughput {aiValue(client.model.tps, ' TPS')} · Tokens {aiValue(client.model.currentTokens, '', 0)} / {aiValue(client.model.maximumTokens, '', 0)}
                {'\n'}Context {aiValue(client.model.contextTokens, '', 0)} / {aiValue(client.model.contextMaximum, '', 0)}
                {'\n'}Power {aiValue(client.watts, ' W')} · Monthly GPU energy {aiValue(client.monthlyKwh, ' kWh', 2)}
            </AiMetricsText>
            <AiMetricsText>Monthly energy is the model client's reported monthly GPU reading, not a whole-host bill or a forecast. Sample: {client.sampledAt || 'Unavailable'}</AiMetricsText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <PillButton small label={expanded === client.name ? 'Hide client details' : 'View client details'} onPress={() => setExpanded(expanded === client.name ? '' : client.name)} />
                <PillButton small label={`Test ${client.name}`} tone={selected === client.name ? 'accent' : 'default'} disabled={disabled} onPress={() => onTest(client.name)} />
            </View>
            {expanded === client.name && <View style={{ gap: 14 }}>
                <AiMetricsText>Client identifier: {client.name}{'\n'}Model sample: {client.model.lastUpdated || 'Unavailable'}{'\n'}Prompt tokens: {aiValue(client.model.promptTokens, '', 0)} · Generated: {aiValue(client.model.generatedTokens, '', 0)}</AiMetricsText>
                {!!client.model.lastError && <AiMetricsText>Model reported: {client.model.lastError}</AiMetricsText>}
                <Sensors title='RAM' sensors={client.ram} />
                <Sensors title='CPU' sensors={client.cpu} />
                <Sensors title='GPU' sensors={client.gpu} />
                <AiMetricsText>Model lanes: {client.lanes === null ? 'Unavailable' : client.lanes.length}</AiMetricsText>
                {client.lanes?.map(lane => <View key={lane.id} style={{ gap: 4 }}>
                    <AiMetricsText>{lane.label} · {lane.tier || 'Tier unavailable'} · {lane.model || lane.gpuName || 'Model unavailable'}</AiMetricsText>
                    <AiMetricsText>Active {aiValue(lane.active, '', 0)} · Queued {aiValue(lane.queued, '', 0)} · Available {aiValue(lane.available, '', 0)} / {aiValue(lane.maximum, '', 0)}</AiMetricsText>
                    <AiMetricsText>Context limit {aiValue(lane.context, '', 0)} · Memory {aiValue(lane.memoryUsedMb, ' MB')} / {aiValue(lane.memoryTotalMb, ' MB')}{'\n'}Power {aiValue(lane.watts, ' W')} · Temperature {aiValue(lane.temperatureC, '°C')}</AiMetricsText>
                </View>)}
            </View>}
        </GlassCard>)}
    </View>
}
