import { useState } from 'react'
import { Text, View } from 'react-native'
import { GlassCard, InlineNotice, PillButton } from '../../components/ui'
import { useAppTheme } from '../../theme/context'
import { keyPayload, ratePeriods, type KeyScope, type RateKey, type RateKeyDraft, type RateOwner, type RateRoute, type RateTier } from '../../lib/rate-limits'
import { fieldNumber, newRateId, numberText, RateField, RateRouteFields, RateText, RateToggle } from './RateLimitFields'

export function ApiKeyEditor({ apiKey, routes, tiers, owners, disabled, onSave, onDelete, onClose, onDraftChange }: {
    apiKey: RateKey | null; routes: RateRoute[]; tiers: RateTier[]; owners: RateOwner[]; disabled: boolean
    onSave: (draft: RateKeyDraft, id?: string) => void; onDelete: (key: RateKey) => void; onClose: () => void; onDraftChange: () => void
}) {
    const theme = useAppTheme()
    const [draft, setDraftValue] = useState<RateKeyDraft>(() => apiKey ? JSON.parse(JSON.stringify(apiKey)) as RateKeyDraft : {
        ownerId: '', name: '', tier: tiers[0]?.id || 'custom', description: '', enabled: true, expiresAt: '', scopes: []
    })
    const [query, setQuery] = useState('')
    const [selectedScope, setSelectedScope] = useState<string | null>(null)
    const [error, setError] = useState('')
    const setDraft: typeof setDraftValue = (value) => { onDraftChange(); setDraftValue(value) }
    const matching = owners.filter((owner) => `${owner.name} ${owner.email} ${owner.id}`.toLowerCase().includes(query.toLowerCase()))
    const tier = tiers.find((item) => item.id === draft.tier)
    const scope = draft.scopes.find((item) => item.id === selectedScope)
    const patchScope = (patch: Partial<KeyScope>) => setDraft({ ...draft, scopes: draft.scopes.map((item) => item.id === selectedScope ? { ...item, ...patch } : item) })
    function save() {
        try { const payload = keyPayload(draft); setError(''); onSave(payload, apiKey?.id) }
        catch (cause) { setError(cause instanceof Error ? cause.message : 'Check the key fields.') }
    }
    return <>
        <GlassCard style={{ gap: 12 }}>
            <PillButton small label='Back to keys' onPress={onClose} />
            <Text style={{ color: theme.text, fontSize: 19, fontWeight: '700' }}>{apiKey ? 'Edit API key' : 'Create API key'}</Text>
            {apiKey && <>
                <RateText>Prefix: {apiKey.keyPrefix} · Organization: {apiKey.organizationId || 'Personal'}</RateText>
                <RateText>Created {apiKey.createdAt || 'Unavailable'} · Last used {apiKey.lastUsedAt || 'Never recorded'}</RateText>
                <RateText>Loaded key saved {apiKey.updatedAt || 'Unavailable'}. Save replaces all editable fields and scopes.</RateText>
            </>}
            <RateText>Refresh keeps this draft. Leaving the editor discards unsaved changes.</RateText>
            {apiKey && <PillButton label='Discard draft and use refreshed key' onPress={() => {
                setDraft(JSON.parse(JSON.stringify(apiKey)) as RateKeyDraft); setSelectedScope(null); setError('')
            }} />}
            <RateField label='Key name' value={draft.name} onChange={(name) => setDraft({ ...draft, name })} disabled={disabled} />
            <RateField label='Description' value={draft.description} onChange={(description) => setDraft({ ...draft, description })} disabled={disabled} />
            <RateText>Owner: {owners.find((owner) => owner.id === draft.ownerId)?.name || draft.ownerId || 'Choose an account'}</RateText>
            {!disabled && <>
                <RateField label='Find owner account' value={query} onChange={setQuery} placeholder='Name, email or ID' />
                <RateText>{matching.length} owners. Showing up to 12; search to narrow.</RateText>
                {matching.slice(0, 12).map((owner) => <PillButton key={owner.id} small label={`${owner.name}${owner.email ? ` · ${owner.email}` : ''}`}
                    tone={draft.ownerId === owner.id ? 'accent' : 'default'} onPress={() => setDraft({ ...draft, ownerId: owner.id })} />)}
            </>}
            <RateField label='Expiry (ISO date or timestamp)' value={draft.expiresAt} onChange={(expiresAt) => setDraft({ ...draft, expiresAt })} placeholder='2027-12-31T23:59:59.999Z' disabled={disabled} />
            <RateToggle label='Key enabled' value={draft.enabled} onChange={(enabled) => setDraft({ ...draft, enabled })} disabled={disabled} />
            <Text style={{ color: theme.text, fontWeight: '700' }}>Tier</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {tiers.map((item) => <PillButton key={item.id} small label={item.label} disabled={disabled} tone={draft.tier === item.id ? 'accent' : 'default'} onPress={() => setDraft({ ...draft, tier: item.id })} />)}
            </View>
            {tier && <RateText>{tier.description}</RateText>}
            <PillButton label='Apply tier limits to every draft scope' disabled={disabled || !tier || !draft.scopes.length}
                onPress={() => tier && setDraft({ ...draft, scopes: draft.scopes.map((item) => ({ ...item, limits: { ...tier.defaultLimits } })) })} />
            <InlineNotice message={error} />
            <PillButton label={apiKey ? 'Review and save key' : 'Review and create key'} tone='accent' disabled={disabled} onPress={save} />
            {apiKey && <PillButton label='Delete key permanently' tone='danger' disabled={disabled} onPress={() => onDelete(apiKey)} />}
        </GlassCard>
        <GlassCard style={{ gap: 12 }}>
            <Text style={{ color: theme.text, fontSize: 19, fontWeight: '700' }}>Route scopes ({draft.scopes.length})</Text>
            <RateText>Blank period limits mean no limit for that period. Choose at least one route.</RateText>
            {draft.scopes.map((item) => <PillButton small key={item.id} label={`${item.enabled ? 'Enabled' : 'Disabled'} · ${item.method} ${item.route}`}
                tone={item.id === selectedScope ? 'accent' : 'default'} onPress={() => setSelectedScope(item.id)} />)}
            <PillButton label='Add route scope' disabled={disabled} onPress={() => {
                const item: KeyScope = { id: newRateId(), method: 'GET', route: '/api/', enabled: true,
                    limits: tier ? { ...tier.defaultLimits } : { perSecond: null, perMinute: null, perHour: null, perDay: null } }
                setDraft({ ...draft, scopes: [...draft.scopes, item] }); setSelectedScope(item.id)
            }} />
            {scope && <View style={{ gap: 12 }}>
                <RateToggle label='Scope enabled' value={scope.enabled} disabled={disabled} onChange={(enabled) => patchScope({ enabled })} />
                <RateRouteFields {...scope} routes={routes} disabled={disabled} onChange={patchScope} />
                {ratePeriods.map((period) => <RateField key={period} label={`Maximum requests ${period.replace('per', 'per ')}`} value={numberText(scope.limits[period])}
                    numeric disabled={disabled} placeholder='No limit' onChange={(value) => patchScope({ limits: { ...scope.limits, [period]: value.trim() ? fieldNumber(value) : null } })} />)}
                <PillButton label='Remove scope from draft' tone='danger' disabled={disabled} onPress={() => {
                    setDraft({ ...draft, scopes: draft.scopes.filter((item) => item.id !== selectedScope) }); setSelectedScope(null)
                }} />
            </View>}
        </GlassCard>
    </>
}
