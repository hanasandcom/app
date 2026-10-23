import { useState } from 'react'
import { GlassCard, PillButton } from '../../components/ui'
import { detailFields, type Scoped, type VmDetails } from './model'
import { VmRow, VmText, VmValue } from './ui'
export function StoredDetailsPanel({ details, current }: { details: Scoped<VmDetails | null> | null; current: () => boolean }) {
    const [group, setGroup] = useState('Summary')
    const value = details?.value
    const summary = ['name', 'status', 'status_checked_at', 'primary_host', 'last_checked']
    const select = (field: string) => {
        if (group === 'Summary') return summary.includes(field)
        const image = field.includes('image') || field === 'volatile_base_image'
        const hardware = ['type', 'architecture', 'config_architecture', 'limits_cpu', 'limits_memory'].includes(field)
        const network = field.startsWith('device_') || field === 'volatile_eth0_hwaddr'
        return group === 'Image' ? image : group === 'Hardware' ? hardware : group === 'Network' ? network : !image && !hardware && !network
    }
    return <GlassCard>
        <VmText strong>Stored hardware, image and network details</VmText>
        {!details ? <VmText>Details unavailable.</VmText> : !value ? <VmText>No stored details were returned.</VmText> : <>
            <VmRow>{['Summary', 'Hardware', 'Network', 'Image', 'System'].map(label => <PillButton key={label} small label={`${label === group ? '✓ ' : ''}${label}`} onPress={() => { if (current()) setGroup(label) }} />)}</VmRow>
            {detailFields.filter(select).map(key => <VmValue key={key} label={key.replaceAll('_', ' ')} value={value[key]} />)}
            {group === 'System' && <><VmValue label='Profiles' value={value.profiles.join(', ')} /><VmValue label='Ephemeral' value={String(value.ephemeral ?? 'Unavailable')} /><VmValue label='Stateful' value={String(value.stateful ?? 'Unavailable')} /></>}
        </>}
    </GlassCard>
}
