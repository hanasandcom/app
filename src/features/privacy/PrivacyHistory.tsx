import { Text, View } from 'react-native'
import { GlassCard, PillButton } from '../../components/ui'
import { useAppTheme } from '../../theme/context'
import { metric, text, type PrivacyRow } from './model'

export function PrivacyText({ children, title = false }: { children: React.ReactNode; title?: boolean }) {
    const theme = useAppTheme()
    return <Text selectable style={{ color: title ? theme.text : theme.textMuted, fontSize: title ? 17 : 14, fontWeight: title ? '600' : '400', lineHeight: title ? 23 : 21 }}>{children}</Text>
}
export const countLabel = (value: unknown) => metric(value) === null ? 'Unavailable' : String(metric(value))
const labels: Record<string, string> = {
    id: 'ID', run_id: 'Run', request_id: 'Request ID', request_type: 'Request', trigger_type: 'Trigger', status: 'Status',
    retention_days: 'Retention days', cutoff_at: 'Cutoff', selected_count: 'Selected', deleted_count: 'Deleted', redacted_count: 'Redacted',
    protected_count: 'Protected', failed_count: 'Failed', retried_count: 'Retried', attempt_count: 'Attempts', retry_count: 'Retries',
    next_retry_at: 'Next retry', requested_by: 'Requested by', requested_at: 'Requested', created_at: 'Created', started_at: 'Started',
    updated_at: 'Updated', completed_at: 'Completed', processed_at: 'Processed', source_service: 'Service', record_type: 'Record type',
    record_id: 'Record ID', action: 'Action', reason: 'Reason', error: 'Error', privacy_request_id: 'Privacy request',
}
export function PrivacyHistory({ rows, kind, onOpen }: { rows: PrivacyRow[]; kind: 'runs' | 'requests' | 'items'; onOpen: (row: PrivacyRow) => void }) {
    return <View style={{ gap: 10 }}>
        <PrivacyText>{kind === 'items' ? 'Records on this page' : `Latest ${kind === 'runs' ? '20 retention runs' : '20 privacy requests'}`}</PrivacyText>
        {!rows.length && <PrivacyText>{kind === 'items' ? 'No processed records on this page.' : `No ${kind} returned.`}</PrivacyText>}
        {rows.map((item, index) => <GlassCard key={`${text(item.id) || text(item.record_id)}-${index}`}>
            <PrivacyText title>{text(item.request_type) || text(item.trigger_type) || text(item.record_type) || 'Record'} · {text(item.status) || 'Unknown'}</PrivacyText>
            <PrivacyText>{text(item.created_at) || text(item.requested_at) || text(item.processed_at) || 'Time unavailable'}</PrivacyText>
            {kind === 'runs' && <PrivacyText>Deleted {countLabel(item.deleted_count)} · Redacted {countLabel(item.redacted_count)} · Protected {countLabel(item.protected_count)}</PrivacyText>}
            <PillButton label='View details' onPress={() => onOpen(item)} />
        </GlassCard>)}
    </View>
}
export function PrivacyRecordDetail({ item, onBack }: { item: PrivacyRow; onBack: () => void }) {
    const result = item.result && typeof item.result === 'object' ? item.result as PrivacyRow : {}
    return <GlassCard>
        <PillButton label='Back to history' onPress={onBack} />
        <PrivacyText title>Privacy record</PrivacyText>
        {Object.entries(labels).filter(([key]) => item[key] !== null && item[key] !== undefined).map(([key, label]) => <PrivacyText key={key}>{label}: {String(item[key])}</PrivacyText>)}
        {['checksum', 'exportedAt', 'cutoffAt', 'mode', 'retryable', 'deadLetter', 'hasMore'].filter(key => result[key] !== undefined).map(key => <PrivacyText key={key}>{key}: {String(result[key])}</PrivacyText>)}
        <PrivacyText>Failed runs may retry automatically. A dead-letter run has exhausted its automatic attempts. Protected records remain retained.</PrivacyText>
    </GlassCard>
}
