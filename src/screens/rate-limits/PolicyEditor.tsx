import { useState } from 'react'
import { Text, View } from 'react-native'
import { GlassCard, InlineNotice, PillButton } from '../../components/ui'
import { useAppTheme } from '../../theme/context'
import { policyPayload, rateScopes, type RateOverride, type RatePolicy, type RateRoute } from '../../lib/rate-limits'
import { fieldNumber, newRateId, numberText, RateField, RateRouteFields, RateText, RateToggle } from './RateLimitFields'

export function PolicyEditor({ policy, routes, disabled, onSave, onDraftChange }: {
    policy: RatePolicy; routes: RateRoute[]; disabled: boolean; onSave: (value: RatePolicy) => void; onDraftChange: () => void
}) {
    const theme = useAppTheme()
    const [draft, setDraftValue] = useState<RatePolicy>(() => JSON.parse(JSON.stringify(policy)) as RatePolicy)
    const [selected, setSelected] = useState<string | null>(null)
    const [error, setError] = useState('')
    const setDraft: typeof setDraftValue = (value) => { onDraftChange(); setDraftValue(value) }
    const override = draft.overrides.find((item) => item.id === selected)
    const update = (patch: Partial<RateOverride>) => setDraft((value) => ({ ...value,
        overrides: value.overrides.map((item) => item.id === selected ? { ...item, ...patch } : item)
    }))
    function save() {
        try { policyPayload(draft); setError(''); onSave(draft) }
        catch (cause) { setError(cause instanceof Error ? cause.message : 'Check the policy fields.') }
    }
    return <>
        <GlassCard style={{ gap: 12 }}>
            <Text style={{ color: theme.text, fontSize: 19, fontWeight: '700' }}>Global policy</Text>
            <RateText>These limits apply across Hanasand, regardless of the selected workspace. Save replaces the complete policy.</RateText>
            <RateText>Loaded policy updated: {policy.updatedAt || 'Unavailable'} · By {policy.updatedBy || 'Unavailable'}</RateText>
            <RateToggle label='Enable rate limiting' value={draft.enabled} disabled={disabled} onChange={(enabled) => setDraft({ ...draft, enabled })} />
            {rateScopes.map((scope) => <View key={scope} style={{ gap: 8 }}>
                <Text style={{ color: theme.text, fontWeight: '700' }}>{scope} defaults</Text>
                <RateField label={`${scope} window (milliseconds)`} numeric disabled={disabled} value={numberText(draft.defaults[scope].windowMs)}
                    onChange={(value) => setDraft({ ...draft, defaults: { ...draft.defaults, [scope]: { ...draft.defaults[scope], windowMs: fieldNumber(value) } } })} />
                <RateField label={`${scope} maximum requests`} numeric disabled={disabled} value={numberText(draft.defaults[scope].maxRequests)}
                    onChange={(value) => setDraft({ ...draft, defaults: { ...draft.defaults, [scope]: { ...draft.defaults[scope], maxRequests: fieldNumber(value) } } })} />
            </View>)}
            <RateText>Refresh keeps the draft below. Use the loaded policy to discard draft changes.</RateText>
            <PillButton label='Discard draft and use refreshed policy' onPress={() => {
                setDraft(JSON.parse(JSON.stringify(policy)) as RatePolicy); setSelected(null); setError('')
            }} />
            <InlineNotice message={error} />
            <PillButton label='Review and save policy' tone='accent' disabled={disabled} onPress={save} />
        </GlassCard>
        <GlassCard style={{ gap: 12 }}>
            <Text style={{ color: theme.text, fontSize: 19, fontWeight: '700' }}>Route overrides ({draft.overrides.length})</Text>
            {draft.overrides.map((item) => <PillButton key={item.id} label={`${item.enabled ? 'Enabled' : 'Disabled'} · ${item.scope} · ${item.method} ${item.route}`}
                onPress={() => setSelected(item.id)} tone={item.id === selected ? 'accent' : 'default'} small />)}
            <PillButton label='Add override' disabled={disabled} onPress={() => {
                const item: RateOverride = { id: newRateId(), enabled: true, method: 'GET', route: '/api/', scope: 'authenticated', windowMs: 60000, maxRequests: 60 }
                setDraft({ ...draft, overrides: [...draft.overrides, item] }); setSelected(item.id)
            }} />
            {override && <View style={{ gap: 12 }}>
                <RateToggle label='Override enabled' value={override.enabled} disabled={disabled} onChange={(enabled) => update({ enabled })} />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {rateScopes.map((scope) => <PillButton key={scope} label={scope} small disabled={disabled} tone={scope === override.scope ? 'accent' : 'default'} onPress={() => update({ scope })} />)}
                </View>
                <RateRouteFields {...override} routes={routes} disabled={disabled} onChange={update} />
                <RateField label='Override window (milliseconds)' value={numberText(override.windowMs)} numeric disabled={disabled} onChange={(value) => update({ windowMs: fieldNumber(value) })} />
                <RateField label='Override maximum requests' value={numberText(override.maxRequests)} numeric disabled={disabled} onChange={(value) => update({ maxRequests: fieldNumber(value) })} />
                <PillButton label='Remove override from draft' tone='danger' disabled={disabled} onPress={() => {
                    setDraft({ ...draft, overrides: draft.overrides.filter((item) => item.id !== selected) }); setSelected(null)
                }} />
                <RateText>Override changes take effect only when you save the complete policy.</RateText>
            </View>}
        </GlassCard>
    </>
}
