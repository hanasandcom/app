import { useState } from 'react'
import { View } from 'react-native'
import { GlassCard, InlineNotice, PillButton } from '../../components/ui'
import type { AppSettings } from '../../types'
import type { Services } from './api'
import { acceptsAccountResult } from './actions'
import { ServiceAccountError, accountDetails, endpointId } from './model'
import type { ServiceAccount } from './model'
import type { AccountsWorkspace } from './useAccounts'
import { AccountField, AccountRow, AccountText } from './ui'
export function AccountEditor({ settings, services, workspace: w, account, target }: { settings: AppSettings; services: Services; workspace: AccountsWorkspace; account?: ServiceAccount; target?: string }) {
    const [name, setName] = useState(account?.name || ''), [description, setDescription] = useState(account?.description || '')
    const [selected, setSelected] = useState<string[]>([]), [error, setError] = useState(''), [scopeQuery, setScopeQuery] = useState('')
    const g = w.controller.generation, editable = w.writable && (!target || account?.active === true)
    const edit = (run: () => void) => { if (w.controller.edit(g)) { run(); setError('') } }
    const save = () => {
        if (!editable) return
        try {
            const input = accountDetails(name, description), scopes = w.directory?.endpoints.filter(endpoint => selected.includes(endpointId(endpoint))) || []
            if (!target && (!scopes.length || scopes.length !== selected.length)) { setError('Choose current supported endpoints.'); return }
            w.request(g, target ? 'update' : 'create', target || 'new-service-account',
                target ? `Update ${account!.name} (${target}) to ${input.name}. Endpoint grants remain unchanged.` : `Create ${input.name} with ${scopes.length} selected endpoint grants. A new credential will be displayed once.`, async (op, grant) => {
                    if (target) { await services.updateAccount(settings, grant.access, target, input, op.signal); return 'Service account updated. Refresh its current details.' }
                    const receipt = await services.createAccount(settings, grant.access, grant.directory, { ...input, scopes }, op.signal)
                    if (acceptsAccountResult(settings, w.controller, op)) {
                        w.acceptSecret(op, receipt.secret); setName(''); setDescription(''); setSelected([])
                    }
                    return `Created ${input.name} (${receipt.id}). Save the key now; it cannot be recovered later.`
                })
        } catch (cause) { setError(cause instanceof ServiceAccountError ? cause.message : 'Review the service account fields.') }
    }
    if (target && !account) return <InlineNotice message='Selected account details are unavailable. Its draft is retained until current data can be read.' />
    return <GlassCard><View key={`account-editor:${g}:${account?.id || 'create'}`} style={{ gap: 12 }}>
        <AccountText strong>{account ? `Edit ${account.name}` : 'Create service account'}</AccountText>
        {error && <InlineNotice message={error} tone='error' />}
        <AccountField label='Service account name' value={name} onChange={value => edit(() => setName(value))} enabled={editable} max={100} />
        <AccountField label='Description (optional)' value={description} onChange={value => edit(() => setDescription(value))} enabled={editable} max={2000} multiline />
        {!target && <>
            <AccountText strong>Allowed endpoints · {selected.length} selected</AccountText>
            <AccountField label='Filter supported endpoints' value={scopeQuery} enabled={editable} max={300} onChange={value => edit(() => setScopeQuery(value))} />
            {w.directory?.endpoints.filter(endpoint => `${endpoint.method} ${endpoint.route} ${endpoint.label}`.toLowerCase().includes(scopeQuery.toLowerCase())).map(endpoint => {
                const id = endpointId(endpoint)
                return <PillButton key={id} label={`${selected.includes(id) ? '✓ ' : ''}${endpoint.label || id} · ${id}`} disabled={!editable} onPress={() => edit(() => setSelected(current => current.includes(id) ? current.filter(v => v !== id) : [...current, id]))} />
            })}
            <PillButton label='Clear selected scopes' disabled={!editable || !selected.length} onPress={() => edit(() => setSelected([]))} />
            <AccountText>Only selected method and route pairs are granted. No wildcard or extra scope is added.</AccountText>
        </>}
        <AccountRow><PillButton label={target ? 'Review update' : 'Review creation'} disabled={!editable || !name.trim() || !target && !selected.length} tone='accent' onPress={save} /></AccountRow>
    </View></GlassCard>
}
