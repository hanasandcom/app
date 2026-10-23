import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, AppState, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import type { AppSettings } from '../types'
import { GlassCard, InlineNotice, PillButton, Screen } from '../components/ui'
import { useAppTheme } from '../theme/context'
import { loadToolOrganizations, type ToolOrganization } from '../lib/organization-tools'
import {
    canWriteRates, deleteRateKey, loadRateConfiguration, loadRateKeys, loadRateOwners, rateAccountScope,
    saveRateKey, saveRatePolicy, validRateConfirmation, mayRevealRateSecret, type RateConfiguration, type RateKey,
    type RateKeyDraft, type RateOwner, type RatePolicy
} from '../lib/rate-limits'
import { ApiKeyEditor } from './rate-limits/ApiKeyEditor'
import { PolicyEditor } from './rate-limits/PolicyEditor'
import { RateField, RateText } from './rate-limits/RateLimitFields'

export function RateLimitsScreen({ settings }: { settings: AppSettings }) {
    return <AccountRates key={rateAccountScope(settings)} settings={settings} />
}
function AccountRates({ settings }: { settings: AppSettings }) {
    const theme = useAppTheme()
    const [configuration, setConfiguration] = useState<RateConfiguration | null>(null)
    const [keys, setKeys] = useState<RateKey[]>([])
    const [owners, setOwners] = useState<RateOwner[]>([])
    const [organizations, setOrganizations] = useState<ToolOrganization[]>([])
    const [tab, setTab] = useState<'keys' | 'policy'>('keys')
    const [selected, setSelected] = useState<string | null>(null)
    const [search, setSearch] = useState('')
    const [secret, setSecret] = useState<string | null>(null)
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [busy, setBusy] = useState(false)
    const [locked, setLocked] = useState(true)
    const [policyVersion, setPolicyVersion] = useState(0)
    const [keyVersion, setKeyVersion] = useState(0)
    const epoch = useRef(0), active = useRef(true), focused = useRef(true)
    const foreground = useRef(AppState.currentState === 'active'), running = useRef(false)
    const request = useRef<AbortController | null>(null)
    const writable = canWriteRates(settings, organizations) && !locked
    const allowed = useRef(writable)
    allowed.current = writable
    const visible = () => active.current && focused.current && foreground.current
    const message = (cause: unknown) => cause instanceof Error ? cause.message : 'The operation failed. Refresh before trying again.'
    useFocusEffect(useCallback(() => {
        focused.current = true
        return () => { focused.current = false; epoch.current++; setSecret(null) }
    }, []))
    useEffect(() => { epoch.current++; setSecret(null) }, [settings.selectedOrganizationId])
    useEffect(() => {
        active.current = true
        const listener = AppState.addEventListener('change', (state) => {
            foreground.current = state === 'active'
            if (!foreground.current) { epoch.current++; setSecret(null) }
        })
        void load()
        return () => { active.current = false; epoch.current++; request.current?.abort(); listener.remove() }
    }, [])
    async function load() {
        if (running.current) return
        running.current = true; setBusy(true); setSecret(null); setOwners([]); setError(''); setNotice(''); setLocked(true); epoch.current++
        const controller = new AbortController(); request.current = controller
        try {
            const [config, keyList, memberships] = await Promise.all([
                loadRateConfiguration(settings, controller.signal), loadRateKeys(settings, controller.signal), loadToolOrganizations(settings, controller.signal)
            ])
            if (!active.current) return
            setConfiguration(config); setKeys(keyList); setOrganizations(memberships); setLocked(false)
            // Owner lookup is required only for writers and never persisted.
            if (canWriteRates(settings, memberships)) {
                try { const value = await loadRateOwners(settings, controller.signal); if (active.current) setOwners(value) }
                catch (cause) { if (active.current) setNotice(`Owner lookup unavailable: ${message(cause)} Existing owners are preserved.`) }
            }
        } catch (cause) { if (active.current) setError(message(cause)) }
        finally { running.current = false; if (active.current) setBusy(false) }
    }
    function confirm(title: string, detail: string, action: () => Promise<void>) {
        const confirmation = ++epoch.current
        if (!validRateConfirmation(confirmation, epoch.current, allowed.current, running.current, visible())) return
        Alert.alert(title, detail, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Confirm', style: 'destructive', onPress: () => {
                if (validRateConfirmation(confirmation, epoch.current, allowed.current, running.current, visible())) void mutate(action)
            } }
        ])
    }
    async function mutate(action: () => Promise<void>) {
        if (running.current || !allowed.current || !visible()) return
        epoch.current++; running.current = true; setBusy(true); setSecret(null); setError(''); setNotice('')
        const controller = new AbortController(); request.current = controller
        try { await action() }
        catch (cause) {
            if (active.current) {
                setLocked(true)
                setError(`${message(cause)} The outcome may be uncertain. Refresh before another write; your draft is retained.`)
            }
        } finally { running.current = false; if (active.current) setBusy(false) }
    }
    function savePolicy(policy: RatePolicy) {
        confirm('Save global policy?', 'This replaces the complete policy for all new requests. Another administrator may have changed it. No automatic retry will run.', async () => {
            const value = await saveRatePolicy(settings, organizations, policy, request.current!.signal)
            if (!active.current) return
            setConfiguration((current) => current ? { ...current, settings: value } : current)
            setPolicyVersion((value) => value + 1); setNotice('Global policy saved.')
        })
    }
    function saveKey(draft: RateKeyDraft, id?: string) {
        confirm(id ? 'Save API key?' : 'Create API key?', id ? 'Replace this key’s details and scopes? Disabling it stops access.' : 'Create this key now? Its full secret will be shown once. Do not repeat creation after an uncertain response.', async () => {
            const secretEpoch = epoch.current
            const result = await saveRateKey(settings, organizations, draft, request.current!.signal, id)
            if (!active.current) return
            setKeys((items) => id ? items.map((item) => item.id === id ? result.apiKey : item) : [result.apiKey, ...items])
            if (epoch.current === secretEpoch) { setSelected(result.apiKey.id); setKeyVersion((value) => value + 1) }
            const reveal = mayRevealRateSecret(secretEpoch, epoch.current, foreground.current, focused.current, active.current)
            if (result.secret && reveal) setSecret(result.secret)
            setNotice(result.secret && !reveal ? 'Key created while hidden. Delete it and create a replacement if you could not save its secret.' : id ? 'Key saved.' : 'Key created. Save its one-time secret now.')
        })
    }
    function removeKey(key: RateKey) {
        confirm('Delete API key permanently?', `Delete “${key.name}” (${key.keyPrefix})? Access using this key will stop. This cannot be undone.`, async () => {
            await deleteRateKey(settings, organizations, key.id, request.current!.signal)
            if (!active.current) return
            setKeys((items) => items.filter((item) => item.id !== key.id)); setSelected(null); setNotice('API key deleted.')
        })
    }
    function changeTab(value: 'keys' | 'policy') { epoch.current++; setSecret(null); setTab(value) }
    const matching = keys.filter((item) => `${item.name} ${item.ownerId} ${item.keyPrefix} ${item.tier} ${item.description}`.toLowerCase().includes(search.toLowerCase()))
    return <Screen title='Rate Limits' subtitle='Global API policy and client keys'>
        <GlassCard style={{ gap: 12 }}>
            <RateText>This administration area applies to Hanasand globally.</RateText>
            <View style={{ flexDirection: 'row', gap: 8 }}>
                <PillButton label='Keys' tone={tab === 'keys' ? 'accent' : 'default'} onPress={() => changeTab('keys')} />
                <PillButton label='Policy' tone={tab === 'policy' ? 'accent' : 'default'} onPress={() => changeTab('policy')} />
                <PillButton label={busy ? 'Working…' : 'Refresh'} disabled={busy} onPress={() => void load()} />
            </View>
            <InlineNotice message={error} />
            <InlineNotice message={notice} tone='info' />
            {!busy && !writable && <RateText>{locked ? 'Writes are locked until a successful refresh.' : 'Read-only. Changes require an active Hanasand owner, admin or editor account without impersonation.'}</RateText>}
            {secret && <View style={{ gap: 8 }}>
                <Text style={{ color: theme.text, fontWeight: '700' }}>One-time API key secret</Text>
                <Text selectable style={{ color: theme.text }}>{secret}</Text>
                <RateText>This secret disappears when you leave this screen or background the app.</RateText>
                <PillButton label='Hide secret' onPress={() => setSecret(null)} />
            </View>}
        </GlassCard>
        {configuration && <View style={{ display: tab === 'policy' ? 'flex' : 'none', gap: 16 }}><PolicyEditor key={policyVersion} policy={configuration.settings} routes={configuration.routes}
            disabled={busy || !writable} onSave={savePolicy} onDraftChange={() => { epoch.current++ }} /></View>}
        {configuration && <View style={{ display: tab === 'keys' ? 'flex' : 'none', gap: 16 }}>{(selected !== null && selected !== '' && !keys.some((item) => item.id === selected) ? <GlassCard style={{ gap: 12 }}>
            <RateText>This key is no longer in the current list. Your previous draft has not been submitted again.</RateText>
            <PillButton label='Back to keys' onPress={() => { epoch.current++; setSelected(null) }} />
        </GlassCard> : selected !== null ? <ApiKeyEditor key={`${selected}:${keyVersion}`}
            apiKey={keys.find((item) => item.id === selected) || null} routes={configuration.routes} tiers={configuration.tierPresets}
            owners={owners} disabled={busy || !writable} onDraftChange={() => { epoch.current++ }} onSave={saveKey} onDelete={removeKey} onClose={() => { epoch.current++; setSelected(null); setSecret(null) }} /> : <GlassCard style={{ gap: 12 }}>
            <RateField label='Search client keys' value={search} onChange={setSearch} />
            <PillButton label='Create client key' disabled={busy || !writable} onPress={() => { epoch.current++; setSelected(''); setSecret(null) }} />
            <RateText>{matching.length} matching keys · {keys.length} loaded</RateText>
            {matching.map((item) => <PillButton key={item.id} label={`${item.name} · ${item.enabled ? 'Enabled' : 'Disabled'} · ${item.keyPrefix}`}
                onPress={() => { epoch.current++; setSelected(item.id); setSecret(null) }} />)}
            {!matching.length && <RateText>No matching keys.</RateText>}
        </GlassCard>)}</View>}
    </Screen>
}
