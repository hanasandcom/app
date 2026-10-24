import { useMemo, useState } from 'react'
import { View } from 'react-native'
import type { AppSettings } from '../types'
import { GlassCard, InlineNotice, PillButton, Screen } from '../components/ui'
import { vmServices, type VmServices } from '../features/virtual-machines/services'
import { useVmWorkspace } from '../features/virtual-machines/useWorkspace'
import { vmScope, ownAccount } from '../features/virtual-machines/transport'
import { CreatePanel } from '../features/virtual-machines/CreatePanel'
import { DetailPanel } from '../features/virtual-machines/DetailPanel'
import { defaultVmFilter, filterVms } from '../features/virtual-machines/inventory'
import { VmField } from '../features/virtual-machines/Field'
import { VmRow, VmText } from '../features/virtual-machines/ui'
export type VirtualMachinesScreenProps = { settings: AppSettings; onOpenCheckout: (url: string) => void | Promise<void>; services?: VmServices }
export function VirtualMachinesScreen(props: VirtualMachinesScreenProps) { return <VmWorkspaceScreen key={vmScope(props.settings)} {...props} /> }
function VmWorkspaceScreen({ settings, onOpenCheckout, services: injected }: VirtualMachinesScreenProps) {
    const services = useMemo(() => injected || vmServices, [injected])
    const w = useVmWorkspace(settings, services)
    const [mode, setMode] = useState<'inventory' | 'create'>('inventory'), [filter, setFilter] = useState(defaultVmFilter), [limit, setLimit] = useState(30), [showMoreFilters, setShowMoreFilters] = useState(false)
    const g = w.ops.generation, rows = w.snapshot.inventory?.value
    const filtered = rows ? filterVms(rows, filter) : []
    const input = (change: () => void) => { if (w.ops.idle(g)) change() }
    return <Screen title='Virtual machines' subtitle={settings.selectedOrganizationId && settings.selectedOrganizationId !== 'personal' ? 'Organization workspace' : 'Personal workspace'}>
        <View key={`workspace-controls:${g}`} style={{ gap: 12 }}>
            <VmRow>
                <PillButton label={w.ops.reading ? 'Refreshing…' : 'Refresh current state'} disabled={!w.visible || w.ops.reading || w.ops.writing} onPress={() => { void w.refresh(g, true) }} />
                <PillButton label='Inventory' disabled={!w.ops.idle(g)} onPress={() => { if (w.ops.context(g)) { setMode('inventory'); w.publish() } }} />
                <PillButton label='Create VM' disabled={!w.writable} onPress={() => { if (w.ops.context(g)) { setMode('create'); w.publish() } }} />
            </VmRow>
            {w.ops.writing && <InlineNotice message='An operation is in progress. Leaving interrupts observation, so its outcome may need manual reconciliation.' />}
            {!ownAccount(settings) && <InlineNotice message='VM actions and credentials are unavailable while impersonating. Read access remains subject to the server.' />}
            {!!w.error && <InlineNotice message={w.error} tone='error' />}
            {!!w.message && <InlineNotice message={w.message} />}
            {w.snapshot.errors.map((error, index) => <InlineNotice key={index} message={error} tone='error' />)}
            {w.ops.unknown && <GlassCard>
                <VmText strong>Review an uncertain operation</VmText>
                <VmText>{w.ops.unknown.kind.replaceAll('_', ' ')} · {w.ops.unknown.target}. No automatic retry was made. Refresh reads its exact current target and authority. Acknowledging only permits a new reviewed action; it does not establish the prior outcome.</VmText>
                <PillButton label='Acknowledge reviewed current state' disabled={!w.ops.canAcknowledge} onPress={() => { const token = w.ops.unknown?.token; if (token && w.ops.acknowledge(g, token)) w.publish() }} />
            </GlassCard>}
            {mode === 'inventory' && <GlassCard>
                <VmText strong>Owned and accessible inventory</VmText>
                <VmField label='Search VM names' value={filter.query} onChange={query => input(() => { setFilter(value => ({ ...value, query })); setLimit(30) })} />
                <VmRow>{['', 'running', 'stopped'].map(status => <PillButton key={status} small label={`${filter.status === status ? '✓ ' : ''}${status || 'Any power state'}`} onPress={() => input(() => setFilter(v => ({ ...v, status })))} />)}</VmRow>
                <PillButton small label={`${showMoreFilters ? 'Hide' : 'More'} filters${[filter.lifecycle !== 'all', !!filter.editor, !!filter.cpu, !!filter.memory].filter(Boolean).length ? ` · ${[filter.lifecycle !== 'all', !!filter.editor, !!filter.cpu, !!filter.memory].filter(Boolean).length} active` : ''}`} onPress={() => setShowMoreFilters(value => !value)} />
                {showMoreFilters && <View style={{ gap: 10 }}>
                    <VmText>Lifecycle, editor access, and minimum resources</VmText>
                    <VmRow>{(['all', 'active', 'deleted'] as const).map(lifecycle => <PillButton key={lifecycle} label={`${filter.lifecycle === lifecycle ? '✓ ' : ''}${lifecycle}`} small onPress={() => input(() => { setFilter(v => ({ ...v, lifecycle })); setLimit(30) })} />)}</VmRow>
                    <VmRow>{['with', 'without', ''].map(editor => <PillButton key={editor} small label={editor === 'with' ? 'Has editors' : editor === 'without' ? 'No editors' : 'Any editors'} onPress={() => input(() => setFilter(v => ({ ...v, editor })))} />)}</VmRow>
                    <VmField label='Editor ID, with, or without' value={filter.editor} onChange={editor => input(() => { setFilter(value => ({ ...value, editor })); setLimit(30) })} />
                    <VmField label='Minimum CPU cores' value={filter.cpu} onChange={cpu => input(() => { setFilter(v => ({ ...v, cpu })); setLimit(30) })} max={5} />
                    <VmField label='Minimum memory (GiB)' value={filter.memory} onChange={memory => input(() => { setFilter(v => ({ ...v, memory })); setLimit(30) })} max={8} />
                </View>}
                {!rows ? <VmText>Inventory unavailable.</VmText> : <>
                    <VmText>{filtered.length} matching / {rows.length} loaded VMs{w.snapshot.reads.inventory ? '' : ' · partial inventory; actions remain locked until a complete refresh'}.</VmText>
                    {!filtered.length && <VmText>No loaded VMs match these filters.</VmText>}
                    <View>
                        {filtered.slice(0, limit).map(vm => <GlassCard key={vm.name} style={{ marginBottom: 12 }}>
                            <View style={{ gap: 12 }}>
                                <VmText strong>{vm.name}</VmText><VmText>{vm.deleted_at ? 'Scheduled deletion' : vm.status || 'Status unavailable'} · {vm.limits_cpu || '?'} CPU · {vm.limits_memory || 'Memory unavailable'}</VmText>
                                <VmText>{vm.organization_name || vm.organization_id || 'Personal'} · Owner {vm.owner}</VmText>
                                <PillButton label={`Open ${vm.name}`} disabled={!w.ops.idle(g)} onPress={() => w.select(g, vm.name)} />
                            </View>
                        </GlassCard>)}
                    </View>
                    {limit < filtered.length && <PillButton label='Show more loaded VMs' onPress={() => input(() => setLimit(n => n + 30))} />}
                </>}
                <PillButton label='Review stop all VMs' disabled={!w.writable || w.snapshot.platform?.value.canEdit !== true} tone='danger' onPress={() => w.request(g, 'stop_all', 'all-vms', 'Schedule all VM shutdowns?', 'This queues shutdowns for all VMs in 20 minutes. It is a global action, not limited by this list or workspace filter.', async (op, grant) => {
                    const receipt = await services.stopAll(settings, grant.platform!, op.signal)
                    return `${receipt.message} · ${receipt.vms.length} VMs in the receipt. Shutdown is queued, not completed.`
                })} />
            </GlassCard>}
        </View>
        {mode === 'create' && <CreatePanel workspace={w} settings={settings} services={services} />}
        {mode === 'inventory' && !!w.selected && <DetailPanel key={w.selected} workspace={w} settings={settings} services={services} onOpenCheckout={onOpenCheckout} />}
    </Screen>
}
