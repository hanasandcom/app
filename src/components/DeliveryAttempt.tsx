import { useState } from 'react'
import { Text, View } from 'react-native'
import { GlassCard, PillButton, SectionTitle } from './ui'
import { useAppTheme } from '../theme/context'
import type { DeliveryAttempt as Attempt } from '../lib/delivery-history'

export function DeliveryAttempt({ attempt, disabled, onRetry }: { attempt: Attempt; disabled: boolean; onRetry: () => void }) {
    const theme = useAppTheme()
    const [expanded, setExpanded] = useState(false)
    const meta = { color: theme.textMuted, fontSize: 13, lineHeight: 20 }
    return <GlassCard style={{ gap: 10 }}>
        <SectionTitle eyebrow={attempt.dryRun ? 'Dry run' : 'Delivery attempt'} title={attempt.status || 'Unknown status'} body={date(attempt.attemptedAt)} />
        <Text style={meta}>HTTP: {attempt.httpStatus ?? (attempt.dryRun ? 'Dry run' : 'Not recorded')} · Attempt: {attempt.attemptCount ?? 'Not recorded'}</Text>
        {!!attempt.error && <Text style={{ ...meta, color: theme.text }}>{attempt.error}</Text>}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <PillButton small label={expanded ? 'Hide attempt details' : 'Attempt details'} onPress={() => setExpanded(value => !value)} />
            <PillButton small label='Retry delivery' disabled={disabled || !attempt.canRetry} onPress={onRetry} />
        </View>
        {expanded && <View style={{ gap: 5 }}>
            <Text selectable style={meta}>Delivery: {attempt.id}</Text>
            <Text style={meta}>Destination: {attempt.destinationId ? 'Saved destination' : 'Redacted destination'}</Text>
            <Text style={meta}>Next retry: {attempt.nextRetryAt ? date(attempt.nextRetryAt) : 'Not scheduled'}</Text>
            {!!attempt.errorClass && <Text style={meta}>Failure class: {attempt.errorClass}</Text>}
            <Text selectable style={meta}>Request: {attempt.requestId || 'Not recorded'}</Text>
            <Text selectable style={meta}>Audit: {attempt.auditEventId || 'Not recorded'}</Text>
            <Text style={meta}>Alert deduplication: {attempt.dedupeKey ? 'Linked' : 'Not recorded'}</Text>
            <Text style={meta}>Payload hash: {attempt.payloadHash ? 'Recorded' : 'Not recorded'}</Text>
        </View>}
    </GlassCard>
}
function date(value: string) {
    return Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Time not recorded'
}
