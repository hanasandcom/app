import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, AppState, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import type { AppSettings } from '../types'
import {
    canManageApiKeys,
    createOrganizationApiKey,
    isActiveOrganization,
    loadOrganizationApiKeys,
    loadToolOrganizations,
    mayRevealCreatedApiKey,
    OrganizationToolError,
    organizationToolScope,
    revokeOrganizationApiKey,
    type OrganizationApiKey,
    type ToolOrganization
} from '../lib/organization-tools'
import { GlassCard, InlineNotice, LabeledInput, PillButton, Screen } from '../components/ui'
import { useAppTheme } from '../theme/context'

export function OrganizationApiKeysScreen({ settings }: { settings: AppSettings }) {
    return <AccountApiKeys key={organizationToolScope(settings)} settings={settings} />
}
function AccountApiKeys({ settings }: { settings: AppSettings }) {
    const theme = useAppTheme()
    const [organizations, setOrganizations] = useState<ToolOrganization[]>([])
    const [organizationId, setOrganizationId] = useState(settings.selectedOrganizationId || '')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(true)
    const [revision, setRevision] = useState(0)
    useEffect(() => {
        const controller = new AbortController()
        let current = true
        setLoading(true)
        setError('')
        void loadToolOrganizations(settings, controller.signal)
            .then((value) => {
                if (current) {
                    setOrganizations(value)
                    setOrganizationId((id) => (value.some((item) => item.id === id) ? id : ''))
                }
            })
            .catch((cause) => {
                if (current && !controller.signal.aborted) setError(message(cause))
            })
            .finally(() => {
                if (current) setLoading(false)
            })
        return () => {
            current = false
            controller.abort()
        }
    }, [revision])
    const organization = organizations.find((item) => item.id === organizationId)
    return (
        <Screen title='API Keys' subtitle='Organization API access'>
            <GlassCard style={{ gap: 12 }}>
                <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>Organization</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {organizations.map((item) => (
                        <PillButton
                            key={item.id}
                            label={item.name}
                            small
                            tone={item.id === organizationId ? 'accent' : 'default'}
                            onPress={() => setOrganizationId(item.id)}
                        />
                    ))}
                </View>
                <PillButton
                    small
                    label={loading ? 'Loading…' : 'Refresh organizations'}
                    disabled={loading}
                    onPress={() => setRevision((value) => value + 1)}
                />
                <InlineNotice message={error} />
                {!loading && !error && !organization && (
                    <Text style={{ color: theme.textMuted }}>Select an organization to manage its keys.</Text>
                )}
            </GlassCard>
            {organization && (
                <OrganizationKeys
                    key={`${organization.id}:${organization.role}:${organization.status}`}
                    settings={settings}
                    organization={organization}
                />
            )}
        </Screen>
    )
}
function OrganizationKeys({
    settings,
    organization
}: {
    settings: AppSettings
    organization: ToolOrganization
}) {
    const theme = useAppTheme()
    const [keys, setKeys] = useState<OrganizationApiKey[]>([])
    const [selectedId, setSelectedId] = useState('')
    const [name, setName] = useState('')
    const [secret, setSecret] = useState<string | null>(null)
    const [busy, setBusy] = useState('')
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [uncertainCreation, setUncertainCreation] = useState(false)
    const active = useRef(true)
    const foreground = useRef(AppState.currentState === 'active')
    const focused = useRef(true)
    const request = useRef<AbortController | null>(null)
    const selected = keys.find((item) => item.id === selectedId)
    const allowed = canManageApiKeys(organization) && !settings.impersonationToken
    useFocusEffect(
        useCallback(() => {
            focused.current = true
            return () => {
                focused.current = false
                setSecret(null)
            }
        }, [])
    )
    useEffect(() => {
        const listener = AppState.addEventListener('change', (state) => {
            foreground.current = state === 'active'
            if (!foreground.current) setSecret(null)
        })
        active.current = true
        if (allowed) void load()
        return () => {
            active.current = false
            request.current?.abort()
            listener.remove()
        }
    }, [])
    async function load() {
        request.current?.abort()
        const controller = new AbortController()
        request.current = controller
        setBusy('load')
        setError('')
        setSecret(null)
        try {
            const value = await loadOrganizationApiKeys(settings, organization, controller.signal)
            if (!active.current) return
            setKeys(value)
            setUncertainCreation(false)
            setSelectedId((id) => (value.some((item) => item.id === id) ? id : ''))
        } catch (cause) {
            if (active.current && !controller.signal.aborted) setError(message(cause))
        } finally {
            if (active.current) setBusy('')
        }
    }
    async function create() {
        if (
            busy ||
            uncertainCreation ||
            !mayRevealCreatedApiKey(active.current, foreground.current, focused.current)
        )
            return
        const controller = new AbortController()
        request.current = controller
        setBusy('create')
        setError('')
        setNotice('')
        setSecret(null)
        try {
            const result = await createOrganizationApiKey(settings, organization, name, controller.signal)
            if (!active.current) return
            setKeys((items) => [result.apiKey, ...items])
            setSelectedId(result.apiKey.id)
            setName('')
            // Keep the one-time secret only in this mounted, foreground screen.
            if (mayRevealCreatedApiKey(active.current, foreground.current, focused.current))
                setSecret(result.secret)
            else
                setNotice(
                    'Key created while this screen was hidden. Revoke it and create a replacement if you could not save the full key.'
                )
        } catch (cause) {
            if (!active.current) return
            setError(message(cause))
            if (!(cause instanceof OrganizationToolError) || cause.status >= 500) setUncertainCreation(true)
        } finally {
            if (active.current) setBusy('')
        }
    }
    async function revoke(item: OrganizationApiKey) {
        if (busy || !mayRevealCreatedApiKey(active.current, foreground.current, focused.current)) return
        const controller = new AbortController()
        request.current = controller
        setBusy(item.id)
        setError('')
        setSecret(null)
        try {
            const value = await revokeOrganizationApiKey(settings, organization, item.id, controller.signal)
            if (active.current) {
                setKeys((items) => items.map((key) => (key.id === value.id ? value : key)))
                setNotice(`${value.name} revoked.`)
            }
        } catch (cause) {
            if (active.current) setError(message(cause))
        } finally {
            if (active.current) setBusy('')
        }
    }
    if (!allowed)
        return (
            <GlassCard>
                <Text style={{ color: theme.textMuted }}>
                    {settings.impersonationToken
                        ? 'Return to your own account to manage API keys.'
                        : 'Organization owners and administrators manage API keys.'}
                </Text>
            </GlassCard>
        )
    return (
        <>
            <GlassCard style={{ gap: 12 }}>
                <Text style={{ color: theme.text, fontWeight: '700', fontSize: 17 }}>
                    {organization.name} · API keys
                </Text>
                <Text style={{ color: theme.textMuted }}>
                    Keys expire after 90 days. The server assigns the organization’s public API scopes.
                </Text>
                <PillButton
                    label={busy === 'load' ? 'Loading…' : 'Refresh keys'}
                    small
                    disabled={!!busy}
                    onPress={() => void load()}
                />
                <InlineNotice message={error} />
                <InlineNotice message={notice} tone='info' />
                {uncertainCreation && (
                    <Text style={{ color: theme.textMuted }}>
                        Refresh the list before creating another key; the previous request may have succeeded.
                    </Text>
                )}
                {isActiveOrganization(organization) ? (
                    <>
                        <LabeledInput label='New key name' value={name} onChangeText={setName} />
                        <PillButton
                            label='Create API key'
                            tone='accent'
                            disabled={
                                !!busy ||
                                uncertainCreation ||
                                name.trim().length < 2 ||
                                name.trim().length > 80 ||
                                !!secret
                            }
                            onPress={() =>
                                Alert.alert(
                                    'Create organization API key?',
                                    `Create “${name.trim()}” for ${organization.name}? It expires in 90 days and the full key is shown once.`,
                                    [
                                        { text: 'Cancel', style: 'cancel' },
                                        { text: 'Create', onPress: () => void create() }
                                    ]
                                )
                            }
                        />
                    </>
                ) : (
                    <Text style={{ color: theme.textMuted }}>
                        Reactivate this organization to create keys. Existing keys can still be revoked.
                    </Text>
                )}
            </GlassCard>
            {secret && (
                <GlassCard style={{ gap: 12 }}>
                    <Text style={{ color: theme.text, fontWeight: '700' }}>Save your new key now</Text>
                    <Text style={{ color: theme.textMuted }}>
                        Select the key to copy it. It is not stored by this app and is hidden when you leave
                        or background this screen.
                    </Text>
                    <Text selectable style={{ color: theme.text, fontFamily: 'monospace' }}>
                        {secret}
                    </Text>
                    <PillButton label='Done · I saved the key' onPress={() => setSecret(null)} />
                </GlassCard>
            )}
            {keys.map((item) => (
                <GlassCard key={item.id} style={{ gap: 8 }}>
                    <Text style={{ color: theme.text, fontWeight: '700' }}>{item.name}</Text>
                    <Text style={{ color: theme.textMuted }}>
                        {item.keyPrefix ? `hsk_${item.keyPrefix}_••••••••` : 'Prefix unavailable'} ·{' '}
                        {!item.enabled
                            ? 'Revoked'
                            : item.expiresAt && Date.parse(item.expiresAt) <= Date.now()
                                ? 'Expired'
                                : 'Active'}
                    </Text>
                    <Text style={{ color: theme.textMuted }}>
                        Expires {date(item.expiresAt)} · Last used {date(item.lastUsedAt)}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                        <PillButton
                            label={selectedId === item.id ? 'Hide details' : 'Details'}
                            small
                            onPress={() => setSelectedId((id) => (id === item.id ? '' : item.id))}
                        />
                        {item.enabled && (
                            <PillButton
                                label='Revoke'
                                small
                                tone='danger'
                                disabled={!!busy}
                                onPress={() =>
                                    Alert.alert(
                                        'Revoke API key?',
                                        `Revoke “${item.name}” for ${organization.name}? Clients using it will stop working.`,
                                        [
                                            { text: 'Cancel', style: 'cancel' },
                                            {
                                                text: 'Revoke',
                                                style: 'destructive',
                                                onPress: () => void revoke(item)
                                            }
                                        ]
                                    )
                                }
                            />
                        )}
                    </View>
                    {selected?.id === item.id && (
                        <>
                            <Text selectable style={{ color: theme.textMuted }}>
                                ID {item.id} · Created {date(item.createdAt)}
                            </Text>
                            {item.scopes.map((scope, index) => (
                                <Text
                                    key={`${scope.method}:${scope.route}:${index}`}
                                    style={{ color: theme.textMuted }}
                                >
                                    {scope.method} {scope.route} · {scope.enabled ? 'Enabled' : 'Disabled'}
                                </Text>
                            ))}
                        </>
                    )}
                </GlassCard>
            ))}
            {!keys.length && !busy && !error && (
                <GlassCard>
                    <Text style={{ color: theme.textMuted }}>No API keys in this organization.</Text>
                </GlassCard>
            )}
        </>
    )
}
function date(value: string) {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : 'Never'
}
function message(error: unknown) {
    return error instanceof Error ? error.message : 'The organization request failed.'
}
