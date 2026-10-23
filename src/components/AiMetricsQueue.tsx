import { View } from 'react-native'
import { GlassCard, SectionTitle } from './ui'
import { AiMetricsText } from './AiMetricsClients'
import { aiSum, aiValue, type AiMetricsEconomics } from '../lib/ai-metrics'

export function AiMetricsQueue({ economics }: { economics: AiMetricsEconomics }) {
    const queue = economics.queue.filter(row => row.status === 'queued' || row.status === 'running')
    return <GlassCard style={{ gap: 12 }}>
        <SectionTitle title='Response time and queued work' eyebrow={`${aiValue(economics.windowDays, '', 0)} day window`} />
        <AiMetricsText>{economics.sampleCount === 0 ? 'No completed response-time samples.' : `First useful output: ${aiValue(economics.firstOutputP50, ' ms', 0)} typical / ${aiValue(economics.firstOutputP95, ' ms', 0)} p95`}{'\n'}Samples: {aiValue(economics.sampleCount, '', 0)}</AiMetricsText>
        <AiMetricsText>Active and queued work: {queue.length ? aiValue(aiSum(queue.map(row => row.count)), ' runs', 0) : '0 reported runs'}</AiMetricsText>
        {queue.map((row, index) => <View key={`${row.lane}:${row.model}:${row.kind}:${row.status}:${index}`} style={{ gap: 4 }}>
            <AiMetricsText>{row.lane || 'Lane unavailable'} · {row.model || 'Model unavailable'}</AiMetricsText>
            <AiMetricsText>{row.kind || 'Kind unavailable'} · {row.status} · {aiValue(row.count, ' runs', 0)}</AiMetricsText>
        </View>)}
    </GlassCard>
}
