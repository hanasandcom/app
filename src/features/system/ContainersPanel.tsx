import { useState } from 'react'
import { View } from 'react-native'
import { GlassCard, InlineNotice, PillButton } from '../../components/ui'
import { bytes, isProtectedLogsContainerName, measured, type Container, type RuntimeLogs, type Telemetry } from './model'
import { SystemActions, SystemText } from './ui'
export function ContainersPanel({ snapshot, selected, logs, logsBusy, logsError, host, canWrite, onSelect, onRestart, onLogs, onOpenLogs }: {
    snapshot: Telemetry; selected: string; logs: RuntimeLogs | null; logsBusy: boolean; logsError: string; host: number; canWrite: boolean
    onSelect: (id: string) => void; onRestart: (value: Container) => void; onLogs: () => void; onOpenLogs: (service?: string) => void
}) {
    const [limit, setLimit] = useState(30), [logLimit, setLogLimit] = useState(24)
    const rows = snapshot.containers.filter(c => !['exited', 'dead', 'removing'].includes(c.state.toLowerCase()))
    const selectedContainer = rows.find(c => c.id === selected)
    return <View style={{ gap: 14 }}>
        <GlassCard>
            <View style={{ gap: 10 }}>
                <SystemText heading>Docker containers · {rows.length} active inventory rows</SystemText>
                <SystemText>Source: {snapshot.source || 'Not reported'} · Sample: {snapshot.dockerAt || 'Not recorded'}</SystemText>
                {!!snapshot.dockerReason && <InlineNotice message={snapshot.dockerReason} />}
                {!rows.length && <SystemText>{snapshot.dockerReason ? 'Inventory unavailable; an empty response does not prove no containers exist.' : 'No active containers returned.'}</SystemText>}
                {rows.slice(0, limit).map(c => <View key={`${host}:${c.id}`} style={{ gap: 6 }}>
                    <SystemText>{c.name} · {c.health} · {c.state}{ '\n' }CPU {measured(c.cpu, '%')} · Memory {bytes(c.memory)}</SystemText>
                    <PillButton label={`Inspect ${c.name}`} onPress={() => { setLogLimit(24); onSelect(c.id) }} />
                </View>)}
                {rows.length > limit && <PillButton label='Show more containers' onPress={() => setLimit(n => n + 30)} />}
                <PillButton label='Open Logs' onPress={() => onOpenLogs()} />
            </View>
        </GlassCard>
        {selectedContainer && <GlassCard>
            <View style={{ gap: 10 }}>
                <SystemText heading>{selectedContainer.name}</SystemText>
                <SystemText>Image {selectedContainer.image || 'Not reported'}{ '\n' }ID {selectedContainer.id}{ '\n' }Health {selectedContainer.health} · {selectedContainer.state}</SystemText>
                <SystemText>CPU {measured(selectedContainer.cpu, '%')}{ '\n' }Memory {bytes(selectedContainer.memory)} / {bytes(selectedContainer.memoryLimit)} ({measured(selectedContainer.memoryPercent, '%')}){ '\n' }Uptime {measured(selectedContainer.uptime, ' seconds')} · Restarts {measured(selectedContainer.restarts)}{ '\n' }Created {selectedContainer.createdAt || 'Unavailable'}{ '\n' }Stats updated {selectedContainer.statsAt || 'Unavailable'}</SystemText>
                {!!selectedContainer.reason && <InlineNotice message={selectedContainer.reason} />}
                <SystemText>Ports: {selectedContainer.ports.length ? selectedContainer.ports.map(p => `${p.ip || '*'}:${p.publicPort ?? 'private'} → ${p.privatePort}/${p.type}`).join('\n') : 'None reported'}</SystemText>
                <SystemText>Select the container name above to copy it.</SystemText>
                <SystemActions key={`${host}:${selectedContainer.id}`}>
                    {!isProtectedLogsContainerName(selectedContainer.name) && <PillButton label='Review restart' disabled={!canWrite} onPress={() => onRestart(selectedContainer)} />}
                    <PillButton label={logsBusy ? 'Loading runtime logs…' : 'Refresh runtime logs'} disabled={logsBusy} onPress={onLogs} />
                    <PillButton label='Open filtered Logs' onPress={() => onOpenLogs(selectedContainer.name)} />
                </SystemActions>
                {!!logsError && <InlineNotice message={logsError} />}
                {logs && <>
                    <SystemText heading>Recent runtime logs</SystemText>
                    <SystemText>Core runtime endpoint · {logs.source || 'Source not reported'}{ '\n' }Sample {logs.generatedAt}{ '\n' }Docker runtime {logs.runtime ? 'available' : 'unavailable'} · Native logs {logs.native ? 'available' : 'unavailable'}</SystemText>
                    {!!logs.reason && <InlineNotice message={logs.reason} />}
                    {!logs.logs.length && <SystemText>{logs.runtime || logs.native ? 'No recent log entries returned.' : 'Runtime log sources are unavailable.'}</SystemText>}
                    {logs.logs.slice(0, logLimit).map((log, index) => <SystemText key={`${log.id}:${index}`}>{log.createdAt || 'Time unavailable'} · {log.level} · {log.source}{ '\n' }{log.message}</SystemText>)}
                    {logs.logs.length > logLimit && <PillButton label={`Show remaining runtime entries (${logs.logs.length - logLimit})`} onPress={() => setLogLimit(120)} />}
                    <SystemText>At most 120 recent entries. The full Logs workflow may use the separate ingested Logs service.</SystemText>
                </>}
            </View>
        </GlassCard>}
    </View>
}
