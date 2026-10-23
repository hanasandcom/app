import { useEffect, useRef, useState } from 'react'
import { Alert, AppState, Platform, Text, TextInput, View, type ScrollView, type TextInputProps } from 'react-native'
import { useIsFocused } from '@react-navigation/native'
import type { AppSettings } from '../types'
import { GlassCard, InlineNotice, PillButton, Screen, SectionTitle } from '../components/ui'
import { useAppTheme } from '../theme/context'
import { filterIntegrations, integrationsScope, IntegrationError, loadIntegrations, removeIntegration, saveIntegration, testIntegration, type Integration, type IntegrationDraft, type IntegrationsPage } from '../lib/integrations'

export function IntegrationsScreen({ settings }: { settings: AppSettings }) {
    return <WorkspaceIntegrations key={integrationsScope(settings)} settings={settings} />
}
function WorkspaceIntegrations({ settings }: { settings: AppSettings }) {
    const theme = useAppTheme(), focused = useIsFocused()
    const live = useRef(true), active = useRef(false), reviewRequired = useRef(false), saving = useRef(false), epoch = useRef(0), read = useRef<AbortController | null>(null), scroll = useRef<ScrollView>(null)
    const [page, setPage] = useState<IntegrationsPage | null>(null)
    const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0)
    const [error, setError] = useState(''), [notice, setNotice] = useState(''), [warning, setWarning] = useState(''), [mustRefresh, setMustRefresh] = useState(false)
    const [query, setQuery] = useState(''), [kind, setKind] = useState(''), [status, setStatus] = useState('')
    const [draft, setDraft] = useState<IntegrationDraft | null>(null)
    const row = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 }
    const meta = { color: theme.textMuted, fontSize: 13, lineHeight: 19 }
    useEffect(() => { live.current = true; return () => { live.current = false; epoch.current++; read.current?.abort() } }, [])
    useEffect(() => {
        const subscription = AppState.addEventListener('change', state => {
            if (state !== 'active') { active.current = false; reviewRequired.current = true; epoch.current++; read.current?.abort(); setDraft(null); setPage(null); setMustRefresh(true) }
            else setRevision(value => value + 1)
        })
        return () => subscription.remove()
    }, [])
    useEffect(() => {
        if (!focused) { active.current = false; setDraft(null); epoch.current++; return }
        active.current = true
        const current = ++epoch.current, controller = new AbortController(); read.current = controller
        setLoading(true); setError('')
        void loadIntegrations(settings, controller.signal).then(value => {
            if (current !== epoch.current || controller.signal.aborted) return
            setPage(value); reviewRequired.current = false; setMustRefresh(false)
        }).catch(cause => { if (current === epoch.current && !controller.signal.aborted) { setError(message(cause)); setPage(null) } })
            .finally(() => { if (current === epoch.current && !controller.signal.aborted) setLoading(false) })
        return () => { active.current = false; controller.abort(); epoch.current++ }
        // Account/workspace/service/session changes remount this component.
    }, [focused, revision])
    const readOnly = !page?.canManage || busy || loading || mustRefresh
    function top() { scroll.current?.scrollTo({ y: 0, animated: false }) }
    function edit(destination?: Integration) {
        if (saving.current || reviewRequired.current || !active.current || readOnly || destination && !destination.canEdit) return
        setDraft(destination ? { id: destination.id, name: destination.name, kind: destination.kind, url: '' } : { name: '', kind: 'discord', url: '' })
        setError(''); setNotice(''); top()
    }
    async function perform(action: 'save' | 'remove' | 'test', destination?: Integration) {
        if (saving.current || reviewRequired.current || readOnly || !page || !live.current || !active.current) return
        saving.current = true; const current = epoch.current
        setBusy(true); setError(''); setNotice(''); setWarning('')
        try {
            if (action === 'save' && draft) { await saveIntegration(settings, page, draft); if (current !== epoch.current) return; setDraft(null); setNotice('Destination saved.') }
            else if (action === 'remove' && destination) { await removeIntegration(settings, page, destination.id); if (current !== epoch.current) return; setNotice('Destination archived.') }
            else if (action === 'test' && destination) { const result = await testIntegration(settings, page, destination.id); if (current !== epoch.current) return; if (result.delivered) setNotice(result.message); else setWarning(result.message) }
            if (live.current) setRevision(value => value + 1)
        } catch (cause) {
            if (!live.current || current !== epoch.current) return
            setError(message(cause))
            if (!(cause instanceof IntegrationError) || cause.uncertain || cause.status === 409) { reviewRequired.current = true; setMustRefresh(true) }
        } finally {
            saving.current = false
            if (live.current) { setBusy(false); if (current !== epoch.current) { reviewRequired.current = true; setMustRefresh(true) }; top() }
        }
    }
    function confirm(action: 'remove' | 'test', destination: Integration) {
        if (readOnly || saving.current || reviewRequired.current || !active.current) return
        const confirmedEpoch = epoch.current
        Alert.alert(action === 'test' ? 'Test destination?' : 'Remove destination?', action === 'test' ? 'This sends an example message to the configured destination.' : 'This archives the destination.', [
            { text: 'Cancel', style: 'cancel' },
            { text: action === 'test' ? 'Send example message' : 'Archive destination', style: action === 'remove' ? 'destructive' : 'default', onPress: () => { if (confirmedEpoch === epoch.current && active.current) void perform(action, destination) } },
        ])
    }
    const visible = filterIntegrations(page?.items || [], query, kind, status)
    const personal = !settings.selectedOrganizationId || settings.selectedOrganizationId === 'personal' || settings.selectedOrganizationId === settings.userId
    return <Screen title='Integrations' subtitle={personal ? 'Personal destinations' : 'Organization destinations'} scrollViewRef={scroll}
        right={<PillButton small label='Refresh' disabled={busy || loading} onPress={() => { setRevision(value => value + 1); top() }} />}>
        <InlineNotice message={error} /><InlineNotice message={warning} /><InlineNotice message={notice} tone='success' />
        {mustRefresh && <InlineNotice message='Refresh and review the current destinations before trying again. The previous change may have been saved.' />}
        {loading && <Text accessibilityRole='progressbar' style={meta}>Loading destinations…</Text>}
        {!loading && page?.lifecycleUnavailable && <Text style={meta}>Destinations are shown read-only because workspace lifecycle could not be verified. Refresh to try again.</Text>}
        {!loading && page?.lifecycleBlocked && <Text style={meta}>This workspace lifecycle blocks destination changes.</Text>}
        {!!page && !page.canManage && !page.lifecycleBlocked && !page.lifecycleUnavailable && <Text style={meta}>Destination management is unavailable for this account or workspace.</Text>}
        {draft ? <GlassCard style={{ gap: 12 }}>
            <SectionTitle eyebrow='Destination' title={draft.id ? 'Edit destination' : 'New destination'} body='Leave the URL blank when editing to keep the current URL.' />
            <Input label='Name' value={draft.name} maxLength={120} editable={!readOnly} onChangeText={name => { if (!saving.current && !reviewRequired.current) setDraft(value => value && { ...value, name }) }} />
            <View style={row}>{(['discord', 'webhook'] as const).map(value => <PillButton key={value} label={value === 'discord' ? 'Discord' : 'Webhook'} tone={draft.kind === value ? 'accent' : 'default'} disabled={readOnly} onPress={() => { if (!saving.current && !reviewRequired.current) setDraft(current => current && { ...current, kind: value }) }} />)}</View>
            <Input label='Webhook URL' value={draft.url} maxLength={2048} keyboardType='url' spellCheck={false} autoComplete={Platform.OS === 'android' ? 'off' : undefined} autoCapitalize='none' autoCorrect={false} textContentType={Platform.OS === 'ios' ? 'URL' : undefined} placeholder={draft.id ? 'Leave blank to keep current URL' : 'https://…'} editable={!readOnly} onChangeText={url => { if (!saving.current && !reviewRequired.current) setDraft(value => value && { ...value, url }) }} />
            <View style={row}><PillButton label='Save destination' tone='accent' disabled={readOnly || !draft.name.trim()} onPress={() => void perform('save')} /><PillButton label='Cancel' disabled={busy} onPress={() => { if (!saving.current) { setDraft(null); setError(''); top() } }} /></View>
        </GlassCard> : <>
            <View style={row}><PillButton label='Add destination' disabled={readOnly} onPress={() => edit()} /></View>
            <Input label='Search destinations' value={query} onChangeText={setQuery} autoCapitalize='none' autoCorrect={false} />
            <View style={row}>{['', 'discord', 'webhook'].map(value => <PillButton key={value} small label={value || 'All types'} tone={kind === value ? 'accent' : 'default'} onPress={() => setKind(value)} />)}</View>
            <View style={row}>{['', 'active', 'paused'].map(value => <PillButton key={value} small label={value || 'All statuses'} tone={status === value ? 'accent' : 'default'} onPress={() => setStatus(value)} />)}</View>
            {!loading && page && !visible.length && <Text style={meta}>{page.items.some(item => item.status !== 'archived') ? 'No destinations match these filters.' : 'No delivery destinations yet.'}</Text>}
            {visible.map(destination => <GlassCard key={destination.id} style={{ gap: 10 }}>
                <SectionTitle eyebrow='Destination' title={destination.name} body={`${destination.kind === 'discord' ? 'Discord' : 'Webhook'} · ${destination.status}`} />
                <Text style={meta}>{destination.endpointHint || 'Configured destination'}</Text>
                <Text style={meta}>Last test: {destination.lastTestStatus || 'Not recorded'}{destination.lastTestedAt ? ` · ${new Date(destination.lastTestedAt).toLocaleString()}` : ''}</Text>
                {destination.testBlockers.map(reason => <Text key={reason} style={meta}>{reason}</Text>)}
                <View style={row}><PillButton small label='Edit' disabled={readOnly || !destination.canEdit} onPress={() => edit(destination)} /><PillButton small label='Test' disabled={readOnly || !destination.canTest} onPress={() => confirm('test', destination)} /><PillButton small label='Remove' tone='danger' disabled={readOnly || !destination.canRemove} onPress={() => confirm('remove', destination)} /></View>
            </GlassCard>)}
        </>}
    </Screen>
}
function Input({ label, ...props }: TextInputProps & { label: string }) {
    const theme = useAppTheme()
    return <View style={{ gap: 8 }}><Text style={{ color: theme.textMuted, fontSize: 13 }}>{label}</Text><TextInput {...props} accessibilityLabel={label}
        placeholderTextColor={theme.textSoft} style={{ color: theme.text, backgroundColor: theme.ambientNeutral, borderColor: theme.surfaceBorderSoft, borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 15 }} /></View>
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : 'Integrations are unavailable. Refresh to try again.' }
