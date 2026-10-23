import { useMemo, useState } from 'react'
import { View } from 'react-native'
import type { AppSettings } from '../types'
import { GlassCard, InlineNotice, PillButton, Screen } from '../components/ui'
import { serviceAccountServices, type Services } from '../features/service-accounts/api'
import { accountRows, own, sessionScope } from '../features/service-accounts/model'
import { useAccounts } from '../features/service-accounts/useAccounts'
import { AccountEditor } from '../features/service-accounts/AccountEditor'
import { AccountField, AccountRow, AccountText } from '../features/service-accounts/ui'
export type ServiceAccountsScreenProps = { settings: AppSettings; services?: Services }
export function ServiceAccountsScreen(props: ServiceAccountsScreenProps) { return <AccountWorkspace key={sessionScope(props.settings)} {...props} /> }
function AccountWorkspace({ settings, services: injected }: ServiceAccountsScreenProps) {
    const services = useMemo(() => injected || serviceAccountServices, [injected]), w = useAccounts(settings, services)
    const [query, setQuery] = useState(''), [order, setOrder] = useState<'asc' | 'desc'>('asc'), [revoked, setRevoked] = useState(false)
    const [selected, setSelected] = useState(''), [creating, setCreating] = useState(false), [limit, setLimit] = useState(30)
    const g = w.controller.generation, current = w.directory?.accounts.find(account => account.id === selected)
    const visible = w.directory ? accountRows(w.directory, query, order, revoked) : []
    const change = (run: () => void) => { if (w.controller.idle(g)) run() }
    const navigate = (id: string, create = false) => { if (w.controller.navigate(g)) { setSelected(id); setCreating(create); w.clearPrivate(); w.publish() } }
    return <Screen title='Service accounts' subtitle='Hanasand administration · global accounts'>
        <View key={`account-controls:${g}`} style={{ gap: 12 }}>
            <AccountRow>
                <PillButton label={w.controller.reading ? 'Refreshing…' : 'Refresh current accounts'} disabled={!w.visible || !w.controller.idle(g)} onPress={() => { void w.refresh(g, true) }} />
                <PillButton label='Add service account' disabled={!w.writable} onPress={() => navigate('', true)} />
            </AccountRow>
            {!!w.error && <InlineNotice message={w.error} tone='error' />}{!!w.message && <InlineNotice message={w.message} />}
            {!own(settings) && <InlineNotice message='Changing service accounts is unavailable during impersonation.' />}
            {w.access?.canRead && !w.access.canWrite && <InlineNotice message='Read-only access. Current Hanasand owner, admin or editor access is required for changes.' />}
            {w.controller.writing && <InlineNotice message='A reviewed operation is in progress. Leaving may require manual outcome reconciliation.' />}
            {w.controller.unknown && <GlassCard>
                <AccountText strong>Uncertain {w.controller.unknown.action}</AccountText>
                <AccountText>{w.controller.unknown.action === 'create' ? 'Creation may have succeeded. Review the complete list before creating another account. A lost once-only key cannot be recovered; revoke an unwanted account explicitly.' : `Review ${w.controller.unknown.target}, its active state and retained key history.`} Refresh explicitly; no automatic retry has been made. Acknowledging permits a new reviewed action and does not establish the earlier outcome.</AccountText>
                <PillButton label='Acknowledge reviewed current accounts' disabled={!w.controller.canAcknowledge} onPress={() => { const token = w.controller.unknown?.token; if (token && w.controller.acknowledge(g, token)) w.publish() }} />
            </GlassCard>}
            <GlassCard>
                <AccountField label='Search accounts and endpoint scopes' value={query} onChange={value => change(() => { setQuery(value); setLimit(30) })} enabled={w.controller.idle(g)} max={300} />
                <AccountRow>
                    <PillButton small label={order === 'asc' ? 'Name A–Z' : 'Name Z–A'} onPress={() => change(() => setOrder(value => value === 'asc' ? 'desc' : 'asc'))} />
                    <PillButton small label={revoked ? '✓ Include revoked history' : 'Include revoked history'} onPress={() => change(() => { setRevoked(value => !value); setLimit(30) })} />
                </AccountRow>
                {!w.directory ? <AccountText>Account inventory unavailable.</AccountText> : <>
                    <AccountText>{visible.length} matching / {w.directory.accounts.filter(a => revoked || a.active).length} {revoked ? 'retained' : 'active'} accounts. All account records are loaded; display pages are local.</AccountText>
                    {!visible.length && <AccountText>No service accounts match this view.</AccountText>}
                    {visible.slice(0, limit).map(account => <PillButton key={account.id} label={`${selected === account.id ? '✓ ' : ''}${account.name} · ${account.active ? 'Active' : 'Revoked'}`} disabled={!w.controller.idle(g)} onPress={() => navigate(account.id)} />)}
                    {limit < visible.length && <PillButton label='Show more loaded accounts' onPress={() => change(() => setLimit(n => n + 30))} />}
                </>}
            </GlassCard>
            {current && <GlassCard>
                <AccountText strong>{current.name}</AccountText><AccountText>{current.id} · {current.active ? 'Active' : 'Revoked'}</AccountText>
                <AccountText>{current.description || 'No description'}</AccountText><AccountText>Created: {current.createdAt || 'Unavailable'}</AccountText>
                {current.keys.map(key => <GlassCard key={key.id}>
                    <AccountText strong>Key prefix {key.prefix} · {key.enabled ? 'Enabled' : 'Disabled'}</AccountText>
                    <AccountText>Created: {key.createdAt || 'Unavailable'} · Last used: {key.lastUsedAt || 'Never'}</AccountText>
                    {key.scopes.map(scope => <AccountText key={`${scope.method} ${scope.route}`}>{scope.method} {scope.route}{!scope.enabled ? ' · Disabled scope' : ''}{scope.label ? ` · ${scope.label}` : ''}</AccountText>)}
                </GlassCard>)}
                {current.active && <PillButton label='Review revocation' tone='danger' disabled={!w.writable} onPress={() => w.request(g, 'revoke', current.id, `Revoke ${current.name} (${current.id})? All its API keys and sessions will be revoked. Usage history is retained.`, async (op, grant) => (await services.revokeAccount(settings, grant.access, current.id, op.signal)).message)} />}
            </GlassCard>}
        </View>
        {creating && <AccountEditor key='create' settings={settings} services={services} workspace={w} />}
        {!!selected && <AccountEditor key={selected} settings={settings} services={services} workspace={w} account={current} target={selected} />}
        {!!selected && !current && <InlineNotice message='The selected account is unavailable in the current list. Refresh before changing it.' />}
        {!!w.secret && <GlassCard key={`once-key:${g}`}>
            <AccountText strong>Save this key now</AccountText><AccountText>This key is shown once. Store it securely before refreshing or changing selection. It also clears when leaving or backgrounding. Send it in the X-API-Key request header.</AccountText>
            <AccountText>{w.secret}</AccountText>
            <PillButton label='Dismiss key' onPress={() => { if (w.controller.idle(g)) w.clearPrivate() }} />
        </GlassCard>}
    </Screen>
}
