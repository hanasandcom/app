import { useEffect, useRef, useState } from 'react'
import { Linking, Text, View } from 'react-native'
import type { AppSettings } from '../types'
import { accountToolKey, createAccountBillingPortal, loadAccountSubscription } from '../lib/account-system-tools'
import { GlassCard, InlineNotice, PillButton, Screen } from '../components/ui'
import { useAppTheme } from '../theme/context'

const label = (value: string) => value.split(/[-_]/).map(part => part[0]?.toUpperCase() + part.slice(1)).join(' ')
const date = (value: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Not reported'
export function SubscriptionScreen({ settings }: { settings: AppSettings }) { return <AccountSubscription key={accountToolKey(settings)} settings={settings} /> }
function AccountSubscription({ settings }: { settings: AppSettings }) {
    const theme = useAppTheme()
    const [data, setData] = useState<Awaited<ReturnType<typeof loadAccountSubscription>> | null>(null)
    const [loading, setLoading] = useState(false)
    const [opening, setOpening] = useState(false)
    const [error, setError] = useState('')
    const [revision, setRevision] = useState(0)
    const active = useRef(true)
    const portalRequest = useRef<AbortController | null>(null)
    useEffect(() => { active.current = true; return () => { active.current = false; portalRequest.current?.abort() } }, [])
    useEffect(() => {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 15000)
        let current = true
        setLoading(true); setError(''); setData(null)
        void loadAccountSubscription(settings, controller.signal).then(value => { if (current) setData(value) })
            .catch(cause => { if (current) setError(controller.signal.aborted ? 'Subscription loading timed out. Refresh to try again.' : message(cause)) })
            .finally(() => { if (current) setLoading(false); clearTimeout(timeout) })
        return () => { current = false; controller.abort(); clearTimeout(timeout) }
    }, [revision])
    async function openPortal() {
        if (opening) return
        const controller = new AbortController()
        portalRequest.current = controller
        const timeout = setTimeout(() => controller.abort(), 15000)
        setOpening(true); setError('')
        try {
            const url = await createAccountBillingPortal(settings, controller.signal)
            if (!active.current || controller.signal.aborted) return
            await Linking.openURL(url).catch(() => { throw new Error('Unable to open secure billing management.') })
        } catch (cause) { if (active.current) setError(controller.signal.aborted ? 'Billing management timed out. Try again.' : message(cause)) }
        finally { if (active.current) setOpening(false); clearTimeout(timeout) }
    }
    const text = { color: theme.textMuted, fontSize: 14, lineHeight: 21 }
    const heading = { color: theme.text, fontSize: 18, fontWeight: '700' as const }
    const subscription = data?.subscription
    const quotaNames: Record<string, string> = { searchesPerDay: 'Daily searches', watchTerms: 'Watch terms', monitoredTargets: 'Monitored targets' }
    return <Screen title='Subscription' subtitle='Account billing'>
        <PillButton small label={loading ? 'Loading…' : 'Refresh'} disabled={loading || opening} onPress={() => setRevision(value => value + 1)} />
        {!!error && <InlineNotice message={error} />}
        {loading && <Text style={text}>Loading subscription and allowances…</Text>}
        {data && <>
            <GlassCard style={{ gap: 12 }}>
                <Text accessibilityRole='header' style={heading}>{subscription ? label(subscription.planId) : 'No subscription reported'}</Text>
                {subscription && <><Text style={text}>Status: {label(subscription.status)}</Text><Text style={text}>Current period ends: {date(subscription.currentPeriodEnd)}</Text>{subscription.cancelAtPeriodEnd && <InlineNotice message='This subscription is scheduled to cancel at the end of the current period.' />}</>}
                <Text style={text}>Payments, invoices and subscription changes are managed securely by Stripe.</Text>
                <PillButton label={opening ? 'Opening…' : 'Manage billing'} tone='accent' disabled={opening || !!settings.impersonationToken} onPress={() => void openPortal()} />
                {!!settings.impersonationToken && <Text style={text}>Return to your own account to manage billing.</Text>}
            </GlassCard>
            <GlassCard style={{ gap: 14 }}>
                <Text accessibilityRole='header' style={heading}>Active access</Text>
                {!data.entitlements.length && <Text style={text}>No active plan access was reported.</Text>}
                {data.entitlements.map((item, index) => <View key={`${item.planId}:${index}`} style={{ gap: 6 }}><Text style={{ color: theme.text, fontWeight: '600' }}>{label(item.planId)}</Text>{item.features.map(feature => <Text key={feature} style={text}>{label(feature)}</Text>)}</View>)}
            </GlassCard>
            <GlassCard style={{ gap: 14 }}>
                <Text accessibilityRole='header' style={heading}>Allowances</Text>
                {!data.quotas.length && <Text style={text}>Allowances were not reported.</Text>}
                {data.quotas.map(quota => <View key={quota.key} style={{ gap: 6 }}><Text style={{ color: theme.text, fontWeight: '600' }}>{quotaNames[quota.key] || label(quota.key)}</Text><Text style={text}>{quota.limit === null ? 'No active allowance reported' : `${quota.used === null ? 'Unknown' : quota.used.toLocaleString()} used of ${quota.limit.toLocaleString()}`}{quota.remaining !== null ? ` · ${quota.remaining.toLocaleString()} remaining` : ''}</Text>{!!quota.resetsAt && <Text style={text}>Resets {date(quota.resetsAt)}</Text>}</View>)}
            </GlassCard>
        </>}
    </Screen>
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : 'Unable to load billing information.' }
