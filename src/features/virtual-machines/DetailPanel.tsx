import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { GlassCard, InlineNotice, PillButton } from '../../components/ui'
import { TerminalSurface } from '../terminal/TerminalSurface'
import type { AppSettings } from '../../types'
import type { VmEditorMemory } from './editor-memory'
import { acceptsVmResult } from './action'
import { StoredDetailsPanel } from './StoredDetailsPanel'
import type { VmWorkspace } from './useWorkspace'
import type { VmServices } from './services'
import { VmField } from './Field'
import { VmRow, VmText, VmValue } from './ui'
import { MetricsPanel } from './MetricsPanel'
import { CreatePanel } from './CreatePanel'
export function DetailPanel({ workspace: w, settings, services, onOpenCheckout }: {
    workspace: VmWorkspace; settings: AppSettings; services: VmServices; onOpenCheckout: (url: string) => void | Promise<void>
}) {
    const editorMemory = useRef<VmEditorMemory>({}).current
    const [tab, setTab] = useState<'overview' | 'details' | 'metrics' | 'services' | 'access' | 'setup'>('overview')
    const [serviceName, setServiceName] = useState(''), [port, setPort] = useState(''), [serviceType, setServiceType] = useState<'http' | 'tls' | 'minecraft-java'>('http')
    const [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('')
    const g = w.ops.generation, vm = w.snapshot.vm?.value, management = w.snapshot.management?.value
    const canManage = w.writable && management?.canManage === true && !vm?.deleted_at
    const canAdmin = w.writable && w.snapshot.platform?.value.canEdit === true
    useEffect(() => w.ops.onClearPrivate(() => setPassword('')), [w.ops])
    const edit = (run: () => void) => { if (w.writable && w.ops.edit(g)) run() }
    if (!vm) return <GlassCard><VmText>{w.ops.reading ? `Loading ${w.selected}…` : 'Selected VM details are unavailable. Refresh current access to view this machine.'}</VmText></GlassCard>
    const target = vm.name
    return <>
        <GlassCard>
            <VmText strong>{target}</VmText>
            <VmText>{vm.status || 'Status unavailable'} · {vm.organization_name || vm.organization_id || 'Personal'}</VmText>
            <VmValue label='Status checked' value={vm.status_checked_at} />
            {vm.status_reason && <VmText>{vm.status_reason}</VmText>}
            {vm.deleted_at && <InlineNotice message={`Scheduled for deletion ${vm.delete_after || '(date unavailable)'}. Restore retains the record; it may not recreate a missing guest. ${vm.deletion_error || ''}`} />}
            {vm.deletion_restore?.instanceMissing === true && <InlineNotice message='The restored record has no guest instance. Resume setup explicitly if eligible.' />}
            <VmRow>{(['overview', 'details', 'metrics', 'services', 'access', 'setup'] as const).map(value => <PillButton key={value} label={`${tab === value ? '✓ ' : ''}${value}`} small disabled={w.ops.writing || w.ops.reading} onPress={() => { if (w.ops.context(g)) { setTab(value); w.publish() } }} />)}</VmRow>
        </GlassCard>
        <View key={`detail-controls:${g}:${target}`} style={{ gap: 12 }}>
            {tab === 'overview' && <GlassCard>
                <VmValue label='Owner' value={vm.owner} /><VmValue label='Created by' value={vm.created_by} />
                <VmValue label='Primary host' value={vm.primary_host} /><VmValue label='Standby host' value={vm.failover_host} />
                <VmValue label='CPU limit' value={vm.limits_cpu} /><VmValue label='Memory limit' value={vm.limits_memory} />
                <VmValue label='IPv4' value={vm.device_eth0_ipv4_address} /><VmValue label='Image' value={vm.config_image_description} />
                <VmValue label='Last checked' value={vm.last_checked} />
                <VmRow>{(['start', 'stop', 'restart'] as const).map(action => <PillButton key={action} label={`Review ${action}`} disabled={!canManage} onPress={() => w.request(g, 'power', target, `${action} ${target}?`, 'This sends one host power request. Review current state afterward; acceptance does not establish completion.', async (op, grant) => {
                    const receipt = await services.power(settings, grant.vm!, grant.management!, action, op.signal)
                    return `Power request returned HTTP ${receipt.status}. Refresh to observe host state.`
                })} />)}</VmRow>
                <PillButton label='Review opening console' disabled={!canManage} onPress={() => w.openConsole(g)} />
                <VmText>Failover entitlement: {vm.failover_premium === true ? 'Included' : vm.failover_premium === false ? 'Not included' : 'Unavailable'} · Enabled: {vm.failover_enabled === null ? 'Unavailable' : vm.failover_enabled ? 'Yes' : 'No'}</VmText>
                <PillButton label={vm.failover_enabled ? 'Review disabling failover' : 'Review enabling failover'} disabled={!canManage || vm.failover_enabled === null || !vm.failover_enabled && vm.failover_premium !== true} onPress={() => w.request(g, 'host_features', target, 'Change failover setting?', `Set failover ${vm.failover_enabled ? 'off' : 'on'} for ${target}.`, async (op, grant) => {
                    await services.setFailoverEnabled(settings, grant.vm!, grant.management!, !vm.failover_enabled, op.signal); return 'Failover setting receipt received. Refresh host state.'
                })} />
                <PillButton label='Review failover switch' disabled={!canManage || vm.failover_enabled !== true || vm.failover_premium !== true || !vm.failover_host} onPress={() => w.request(g, 'failover', target, 'Switch failover host?', `Request a queued switch to current standby ${vm.failover_host}.`, async (op, grant) => {
                    const receipt = await services.failover(settings, grant.vm!, grant.management!, op.token, op.signal)
                    return `${receipt.message} (202 accepted; not completion). Refresh current host state.`
                })} />
                {w.snapshot.products?.value.plans.map(plan => <PillButton key={plan.id} label={`Review ${plan.name} · ${plan.priceNok} ${plan.currency}/${plan.interval}`} disabled={!w.writable || !w.snapshot.products?.value.containers.some(row => row.name === target && row.failover_premium === false)} onPress={() => w.request(g, 'checkout', target, 'Open Stripe checkout?', `${plan.name} · ${plan.priceNok} ${plan.currency}/${plan.interval}. A checkout session will be created. Returning does not establish entitlement.`, async (op, grant) => {
                    const receipt = await services.createCheckout(settings, target, grant.products!, op.signal)
                    if (!acceptsVmResult(w.ops, op, settings)) return 'Checkout receipt discarded after access changed.'
                    await onOpenCheckout(receipt.url)
                    return 'Checkout opened. Refresh products and VM state after returning.'
                })} />)}
                {!w.snapshot.products && <VmText>Product prices and checkout eligibility are unavailable.</VmText>}
            </GlassCard>}
            {tab === 'details' && <GlassCard>
                <StoredDetailsPanel details={w.snapshot.details} current={() => w.ops.idle(g)} />
                <PillButton label='Review collecting current host details' disabled={!w.writable || !!vm.deleted_at} onPress={() => w.request(g, 'collect', target, 'Collect and save host details?', 'This explicitly contacts the host and persists fresh hardware, image and network details.', async (op, grant) => {
                    await services.collectDetails(settings, grant.vm!, op.signal); return 'Host detail collection receipt received. Refresh stored details.'
                })} />
            </GlassCard>}
            {tab === 'metrics' && <MetricsPanel metrics={w.snapshot.metrics} current={() => w.ops.idle(g)} />}
            {tab === 'services' && <GlassCard>
                <VmText strong>Public services</VmText>
                {!management ? <VmText>Services and management permission unavailable.</VmText> : management.services.length === 0 ? <VmText>No public services configured.</VmText> : management.services.map(service => <GlassCard key={service.id}>
                    <VmText strong>{service.name}</VmText><VmText>{service.type} · {service.port} · {service.hostname}</VmText>
                    <PillButton label='Review removal' disabled={!canManage} tone='danger' onPress={() => w.request(g, 'service_remove', target, 'Remove public service?', `${service.hostname} will stop routing to port ${service.port}.`, async (op, grant) => {
                        await services.removePublicService(settings, grant.vm!, grant.management!, service.id, op.signal); return 'Public service removed. Refresh the current service list.'
                    })} />
                </GlassCard>)}
                <VmField label='Public service name' value={serviceName} enabled={canManage} onChange={value => edit(() => setServiceName(value))} max={41} />
                <VmField label='Guest port (1–65535)' value={port} enabled={canManage} onChange={value => edit(() => setPort(value))} max={5} />
                <VmRow>{(['http', 'tls', 'minecraft-java'] as const).map(type => <PillButton key={type} label={`${serviceType === type ? '✓ ' : ''}${type}`} small disabled={!canManage} onPress={() => edit(() => setServiceType(type))} />)}</VmRow>
                <PillButton label='Review public service' disabled={!canManage || !serviceName || !port} onPress={() => w.request(g, 'service_add', target, 'Publish public service?', `${serviceName} · ${serviceType} → guest port ${port}. This exposes this service publicly.`, async (op, grant) => {
                    const receipt = await services.addPublicService(settings, grant.vm!, grant.management!, { name: serviceName, type: serviceType, port: Number(port) }, op.signal)
                    return `Public service created: ${receipt.hostname}. Refresh current routes.`
                })} />
            </GlassCard>}
            {tab === 'access' && <GlassCard>
                <VmText strong>Access and credentials</VmText><VmText>Editors: {vm.access_users.join(', ') || 'None listed'}</VmText>
                <PillButton label='Review SSH certificate synchronization' disabled={!w.writable || !!vm.deleted_at} onPress={() => w.request(g, 'ssh_sync', target, 'Synchronize SSH access?', 'This writes saved public SSH certificates to the guest. It is not a read-only connection lookup.', async (op, grant) => {
                    const receipt = await services.syncConnection(settings, grant.vm!, op.signal)
                    w.setConnection(op, `${receipt.sshCommand || `${receipt.username}@${receipt.vmIp}`} · ${receipt.certificateCount} certificates`)
                    return 'SSH synchronization receipt received.'
                })} />
                <VmField label='Current account password' value={password} secret enabled={w.writable && !vm.deleted_at} onChange={value => edit(() => setPassword(value))} max={1024} />
                <VmText>Password access is checked separately by the server. Revealing it records an audit event and sends a security email.</VmText>
                <PillButton label='Review password reveal' disabled={!w.writable || !password || !!vm.deleted_at} onPress={() => w.request(g, 'sudo', target, 'Reveal guest sudo password?', 'Your current password and credential eligibility will be checked. The result is cleared when leaving or refreshing this screen.', async (op, grant) => {
                    const receipt = await services.revealSudoPassword(settings, grant.vm!, password, op.signal)
                    w.setSecret(op, receipt.password); return 'Password receipt verified. Clear it when finished.'
                })} />
                {vm.can_assign_organization === true && !vm.organization_id && <>
                    <VmText>Assign this VM to an organization</VmText>
                    {w.snapshot.organizations === null && <VmText>Organization membership unavailable.</VmText>}
                    {w.snapshot.organizations?.filter(org => org.status === 'active' && ['owner', 'admin'].includes(org.role)).map(org => <PillButton key={org.id} label={`Review assignment to ${org.name}`} disabled={!w.writable} onPress={() => w.request(g, 'assign', target, 'Assign organization?', `Assign ${target} to ${org.name}. Its access scope changes.`, async (op, grant) => {
                        const current = await services.organizations(settings, op.signal)
                        if (!w.ops.operationCurrent(op) || !current.some(row => row.id === org.id && row.status === 'active' && ['owner', 'admin'].includes(row.role))) throw new Error('Organization authority changed.')
                        const receipt = await services.assignOrganization(settings, grant.vm!, org.id, op.signal)
                        return `Assigned to ${receipt.organization.name}. Select the organization and refresh to observe access.`
                    })} />)}
                </>}
            </GlassCard>}
            {tab === 'setup' && <>
                <GlassCard>
                    <VmText strong>Retention and deletion</VmText>
                    <VmText>Deleting quarantines the VM and retains it for 30 days. Restoration may leave a missing guest instance; inspect the returned record.</VmText>
                    {vm.deleted_at ? <PillButton label='Review restoration' disabled={!canAdmin} onPress={() => w.request(g, 'restore', target, 'Restore VM record?', `Restore ${target} within its retention period. This does not guarantee the guest exists or is running.`, async (op, grant) => {
                        const receipt = await services.changeDeletion(settings, grant.vm!, grant.platform!, 'restore', undefined, op.signal)
                        return `${receipt.message}${receipt.vm.deletion_restore?.instanceMissing ? ' Guest instance is missing; separate setup is required.' : ''}`
                    })} /> : <>
                        <VmField label={`Type ${target} to schedule deletion`} value={confirmation} enabled={canAdmin} onChange={value => edit(() => setConfirmation(value))} />
                        <PillButton label='Review scheduled deletion' disabled={!canAdmin || confirmation !== target} tone='danger' onPress={() => w.request(g, 'delete', target, 'Schedule VM deletion?', `${target} will be stopped and quarantined, then deleted after retention.`, async (op, grant) => {
                            const receipt = await services.changeDeletion(settings, grant.vm!, grant.platform!, 'delete', confirmation, op.signal); return receipt.message
                        })} />
                    </>}
                </GlassCard>
            </>}
        </View>
        {tab === 'setup' && <>
            {w.snapshot.details && w.snapshot.details.value === null && !vm.deleted_at && (vm.owner === settings.userId || w.snapshot.platform?.value.canEdit === true)
                ? <CreatePanel workspace={w} settings={settings} services={services} resume={target} memory={editorMemory} />
                : <InlineNotice message='Resuming setup requires a successful details read showing no stored VM details and current creation authority. Restore a deleted record first.' />}
        </>}
        {(w.secret || w.connection) && <GlassCard>
            {w.secret && <VmText strong>Sudo password: {w.secret}</VmText>}{w.connection && <VmText>{w.connection}</VmText>}
            <PillButton label='Clear private connection details' onPress={w.dismissPrivate} />
        </GlassCard>}
        {w.channel && <GlassCard>
            <VmText strong>Console · {target}</VmText>
            <TerminalSurface key={w.channel.id} channel={w.channel} active={w.visible} onFailure={() => { w.channel?.close(); w.dismissPrivate() }} />
            <PillButton label='Close console' onPress={w.dismissPrivate} />
        </GlassCard>}
        {(w.boot || w.bootStatus) && <GlassCard>
            <VmText strong>Boot log · retained tail (up to 32,768 characters)</VmText><VmText>{w.bootStatus}</VmText><VmText>{w.boot}</VmText>
        </GlassCard>}
    </>
}
