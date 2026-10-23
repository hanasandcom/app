import { useState } from 'react'
import { Text, TextInput, View } from 'react-native'
import Svg, { Polyline } from 'react-native-svg'
import { GlassCard, PillButton, SectionTitle } from './ui'
import { useAppTheme } from '../theme/context'
import { loadPresets, type LoadDraft, type LoadQuota, type LoadSummary, type LoadTest } from '../lib/load-tests'

function Copy({ children }: { children: React.ReactNode }) {
    const theme = useAppTheme()
    return <Text selectable style={{ color: theme.textMuted, lineHeight: 21 }}>{children}</Text>
}
const number = (value: number | null | undefined, suffix = '') => value == null ? 'Unavailable' : `${value.toLocaleString()}${suffix}`
const date = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Unavailable'
function Input({ label, value, onChange, disabled, numeric = false, nativeKey }: { label: string; value: string; onChange: (v: string) => void; disabled: boolean; numeric?: boolean; nativeKey: number }) {
    const theme = useAppTheme()
    return <View style={{ gap: 5 }}>
        <Copy>{label}</Copy>
        <TextInput key={nativeKey} accessibilityLabel={label} value={value} editable={!disabled} onChangeText={onChange}
            maxLength={numeric ? 6 : 2000} autoCapitalize='none' autoCorrect={false} spellCheck={false} autoComplete='off'
            keyboardType={numeric ? 'number-pad' : 'url'} textContentType={numeric ? 'none' : 'URL'}
            style={{ color: theme.text, borderColor: theme.surfaceBorderSoft, borderWidth: 1, borderRadius: 10, padding: 12 }} />
    </View>
}
export function LoadTestLaunch({ draft, onDraft, disabled, hostRevision, quota, onReview }: {
    draft: LoadDraft; onDraft: (value: LoadDraft, structural?: boolean) => void; disabled: boolean; hostRevision: number; quota: LoadQuota | null; onReview: () => void
}) {
    return <GlassCard style={{ gap: 12 }}>
        <SectionTitle title='Check an endpoint' eyebrow='Generate real HTTP traffic' body='Only test services you own or have permission to load test.' />
        <Copy>{quota ? `${quota.plan} · ${quota.remaining} of ${quota.limit} runs remaining · ${quota.used} used${quota.resetsAt ? `\nResets ${date(quota.resetsAt)}` : '\nLifetime allowance'}` : 'Server allowance unavailable. Refresh before creating a check.'}</Copy>
        <Input nativeKey={hostRevision} label='Endpoint URL' value={draft.url} disabled={disabled} onChange={url => onDraft({ ...draft, url })} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {loadPresets.map(preset => <PillButton key={`${preset.name}:${hostRevision}`} small label={preset.name} disabled={disabled}
                onPress={() => onDraft({ ...draft, timeout: preset.timeout, stages: preset.stages.map(stage => ({ ...stage })) }, true)} />)}
        </View>
        <Input nativeKey={hostRevision} label='Request timeout · seconds (1–120)' value={draft.timeout ? String(draft.timeout) : ''} numeric disabled={disabled} onChange={value => onDraft({ ...draft, timeout: Number(value) })} />
        <Copy>Custom traffic · up to 8 stages, 100 users and 600 seconds total</Copy>
        {draft.stages.map((stage, index) => <View key={index} style={{ gap: 8 }}>
            <Copy>Stage {index + 1}</Copy>
            <Input nativeKey={hostRevision} label={`Stage ${index + 1} duration in seconds`} value={String(stage.duration.endsWith('s') ? stage.duration.slice(0, -1) : stage.duration.endsWith('m') ? Number(stage.duration.slice(0, -1)) * 60 : stage.duration)} numeric disabled={disabled}
                onChange={value => onDraft({ ...draft, stages: draft.stages.map((item, i) => i === index ? { ...item, duration: `${value}s` } : item) })} />
            <Input nativeKey={hostRevision} label={`Stage ${index + 1} users (0–100)`} value={Number.isFinite(stage.target) ? String(stage.target) : ''} numeric disabled={disabled}
                onChange={value => onDraft({ ...draft, stages: draft.stages.map((item, i) => i === index ? { ...item, target: value === '' ? Number.NaN : Number(value) } : item) })} />
            <PillButton key={`remove:${hostRevision}`} small label={`Remove stage ${index + 1}`} disabled={disabled || draft.stages.length <= 1}
                onPress={() => onDraft({ ...draft, stages: draft.stages.filter((_, i) => i !== index) }, true)} />
        </View>)}
        <PillButton key={`add:${hostRevision}`} label='Add custom stage' disabled={disabled || draft.stages.length >= 8}
            onPress={() => onDraft({ ...draft, stages: [...draft.stages, { duration: '10s', target: 1 }] }, true)} />
        <PillButton label='Review and start check' disabled={disabled || !quota || quota.remaining <= 0 || !draft.url.trim()} tone='accent' onPress={onReview} />
    </GlassCard>
}
export function LoadTestHistory({ rows, lane, onLane, onSelect, query, onQuery, onLookup, disabled, hostRevision }: {
    rows: LoadTest[] | null; lane: 'mine' | 'recent'; onLane: (value: 'mine' | 'recent') => void; onSelect: (id: string) => void
    query: string; onQuery: (value: string) => void; onLookup: () => void; disabled: boolean; hostRevision: number
}) {
    const [page, setPage] = useState(0), current = Math.min(page, Math.max(0, Math.ceil((rows?.length || 0) / 10) - 1))
    return <GlassCard style={{ gap: 12 }}>
        <SectionTitle title='Result history' eyebrow='Account Mine · public Global' body='Latest 50 checks in each view. Open another check using its scan ID.' />
        <View style={{ flexDirection: 'row', gap: 8 }}>
            <PillButton label='My checks' tone={lane === 'mine' ? 'accent' : 'default'} disabled={disabled} onPress={() => { setPage(0); onLane('mine') }} />
            <PillButton label='Global checks' tone={lane === 'recent' ? 'accent' : 'default'} disabled={disabled} onPress={() => { setPage(0); onLane('recent') }} />
        </View>
        <Input nativeKey={hostRevision} label='Find a scan by ID' value={query} disabled={disabled} onChange={onQuery} />
        <PillButton label='Open scan ID' disabled={disabled || !query.trim()} onPress={onLookup} />
        {rows === null ? <Copy>History is unavailable.</Copy> : <>
            <Copy>{rows.filter(item => item.status === 'queued').length} queued · {rows.filter(item => item.status === 'running').length} running · {rows.filter(item => ['failed', 'error'].includes(item.status)).length} failed in this loaded lane</Copy>
            {rows.slice(current * 10, current * 10 + 10).map(item => <View key={item.id} style={{ gap: 5 }}>
                <Copy>{item.url}{'\n'}{item.status} · {date(item.createdAt)}{'\n'}p95 {number(item.summary.duration.p95, ' ms')} · Previous p95 {number(item.previous?.duration.p95, ' ms')}{item.p95Delta !== null ? ` · previous minus latest ${number(item.p95Delta, ' ms')}` : ''}</Copy>
                <PillButton small label={`Open result ${item.id}`} disabled={disabled} onPress={() => onSelect(item.id)} />
            </View>)}
            {!rows.length && <Copy>No checks returned in this lane.</Copy>}
            <View style={{ flexDirection: 'row', gap: 8 }}>
                <PillButton small label='Previous results' disabled={disabled || !current} onPress={() => setPage(current - 1)} />
                <PillButton small label='Next results' disabled={disabled || (current + 1) * 10 >= rows.length} onPress={() => setPage(current + 1)} />
            </View>
            <Copy>Loaded result page {current + 1} of {Math.max(1, Math.ceil(rows.length / 10))}</Copy>
        </>}
    </GlassCard>
}
function Summary({ value, title }: { value: LoadSummary; title: string }) {
    const theme = useAppTheme(), [page, setPage] = useState(0)
    const samples = value.series.flatMap(series => series.points.map(point => ({ ...point, name: series.name })))
    const current = Math.min(page, Math.max(0, Math.ceil(samples.length / 25) - 1))
    return <View style={{ gap: 10 }}>
        <Copy>{title}{'\n'}Requests {number(value.requests)} · Checks {number(value.checks)} · Failures {number(value.failures)}{'\n'}Failure rate {value.failureRate === null ? 'Unavailable' : `${(value.failureRate * 100).toFixed(2)}%`}{'\n'}{Object.entries(value.duration).map(([key, numberValue]) => `${key}: ${number(numberValue, ' ms')}`).join(' · ')}</Copy>
        {value.series.map(series => {
            const keys = [...new Set(series.points.flatMap(point => Object.keys(point.values)))]
            return <View key={series.name} style={{ gap: 5 }}>
                <Copy>{series.name === 'rps' ? 'Requests per second' : series.name === 'latency' ? 'Latency · milliseconds' : 'Errors · count'} · chronological samples · up to 300 retained</Copy>
                <Svg width='100%' height={100} viewBox='0 0 300 100' accessibilityLabel={`${series.name} chart. Numeric samples follow.`}>
                    {keys.map((key, index) => {
                        const values = series.points.flatMap((point, i) => Object.hasOwn(point.values, key) ? [{ value: point.values[key], index: i }] : []), max = Math.max(1, ...series.points.flatMap(point => Object.values(point.values)))
                        return <Polyline key={key} points={values.map(point => `${point.index * 300 / Math.max(1, series.points.length - 1)},${95 - point.value / max * 90}`).join(' ')} fill='none' stroke={index ? theme.textMuted : theme.text} strokeWidth={2} />
                    })}
                </Svg>
            </View>
        })}
        {!samples.length && <Copy>No time-series samples supplied. Aggregate results are shown when available.</Copy>}
        {samples.slice(current * 25, current * 25 + 25).map((sample, index) => <Copy key={index}>{sample.name} · {sample.time}: {Object.entries(sample.values).map(([key, value]) => `${key} ${value}`).join(' · ')}</Copy>)}
        {!!samples.length && <View style={{ flexDirection: 'row', gap: 8 }}>
            <PillButton small label='Previous samples' disabled={!current} onPress={() => setPage(current - 1)} />
            <PillButton small label='Next samples' disabled={(current + 1) * 25 >= samples.length} onPress={() => setPage(current + 1)} />
        </View>}
    </View>
}
export function LoadTestReport({ test, disabled, busy, liveStatus, participants, onBack, onRerun, onJoin, onStop, onShare }: {
    test: LoadTest; disabled: boolean; busy: boolean; liveStatus: string; participants: number | null
    onBack: () => void; onRerun: () => void; onJoin: () => void; onStop: () => void; onShare: () => void
}) {
    const [output, setOutput] = useState<'logs' | 'errors'>('logs'), [page, setPage] = useState(0)
    const rows = test[output], current = Math.min(page, Math.max(0, Math.ceil(rows.length / 20) - 1))
    return <>
        <GlassCard style={{ gap: 12 }}>
            <PillButton small label='Back to checks' disabled={busy} onPress={onBack} />
            <SectionTitle title={test.status} eyebrow='Selected result' body={test.url} />
            <Copy>Scan {test.id}{'\n'}Queue position {number(test.queuePosition)} · Run {number(test.runNumber)}{'\n'}Created {date(test.createdAt)}{'\n'}Started {date(test.startedAt)}{'\n'}Finished {date(test.finishedAt)}{'\n'}Timeout {number(test.timeout, ' s')} · Duration {number(test.durationMs, ' ms')} · Exit {number(test.exitCode)}{'\n'}Stored visits {number(test.visits)}{'\n'}Stages: {test.stages.length ? test.stages.map(stage => `${stage.duration} → ${stage.target} users`).join(', ') : 'Legacy/default configuration'}</Copy>
            <Copy>{liveStatus} · Viewers {number(participants)}</Copy>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <PillButton label='Review public live join' disabled={disabled || liveStatus.startsWith('Live') || liveStatus.startsWith('Connecting')} onPress={onJoin} />
                <PillButton label='Stop listening' onPress={onStop} />
                <PillButton label='Share result link' onPress={onShare} />
                <PillButton label='Review rerun' disabled={disabled || ['queued', 'running'].includes(test.status)} onPress={onRerun} />
            </View>
            <Copy>Stopping listening does not stop a run. Reruns repeat the saved traffic configuration.</Copy>
        </GlassCard>
        <GlassCard style={{ gap: 12 }}>
            <Summary value={test.summary} title='Latest run metrics' />
            {test.previous && <Summary value={test.previous} title='Previous run for this endpoint' />}
            <Copy>Previous p95 minus latest: {number(test.p95Delta, ' ms')}. Positive means lower latest latency.</Copy>
        </GlassCard>
        <GlassCard style={{ gap: 12 }}>
            <SectionTitle title='Run evidence' eyebrow='Bounded in-memory output' body='Latest 500 entries per stream, at most 128K characters each; individual entries limited to 8K characters.' />
            {test.outputLimited && <Copy>Some output was omitted to keep this report within memory limits.</Copy>}
            <View style={{ flexDirection: 'row', gap: 8 }}>
                <PillButton label={`Logs (${test.logs.length})`} onPress={() => { setOutput('logs'); setPage(0) }} />
                <PillButton label={`Errors (${test.errors.length})`} onPress={() => { setOutput('errors'); setPage(0) }} />
            </View>
            {rows.slice(current * 20, current * 20 + 20).map((line, index) => <Copy key={index}>{line}</Copy>)}
            {!rows.length && <Copy>No {output} supplied.</Copy>}
            <View style={{ flexDirection: 'row', gap: 8 }}>
                <PillButton small label='Previous output' disabled={!current} onPress={() => setPage(current - 1)} />
                <PillButton small label='Next output' disabled={(current + 1) * 20 >= rows.length} onPress={() => setPage(current + 1)} />
            </View>
        </GlassCard>
    </>
}
