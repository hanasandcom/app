import { useRef, useState, type SetStateAction } from 'react'
import { Linking, View } from 'react-native'
import { GlassCard, InlineNotice, PillButton } from '../../components/ui'
import { operatingSystems, resourcePlans, setupServices, minecraftTypes, createPayload, type CreateVmInput, type SetupPlan } from './setup'
import type { VmWorkspace } from './useWorkspace'
import type { VmServices } from './services'
import type { AppSettings } from '../../types'
import { editorValue, saveEditorValue, type VmEditorMemory, type VmEditorState } from './editor-memory'
import { acceptsVmResult } from './action'
import { canCreateVm } from './authority'
import { applyVmPlan, clearVmSuggestion, withWebsiteField } from './draft'
import { VmField } from './Field'
import { VmRow, VmText } from './ui'
export function CreatePanel({ workspace: w, settings, services, resume, memory }: { workspace: VmWorkspace; settings: AppSettings; services: VmServices; resume?: string; memory?: VmEditorMemory }) {
    const [draft, setDraft] = useEditorState(memory, 'draft', { name: resume || '', os: 'ubuntu-24.04', resources: resourcePlans[0], services: [], organization_id: settings.selectedOrganizationId === 'personal' ? null : settings.selectedOrganizationId || null })
    const [suggestedKey, setSuggestedKey] = useEditorState(memory, 'suggestedKey', ''), [prompt, setPrompt] = useEditorState(memory, 'prompt', ''), [packages, setPackages] = useEditorState(memory, 'packages', ''), [summary, setSummary] = useEditorState(memory, 'summary', ''), [error, setError] = useEditorState(memory, 'error', ''), [confirmation, setConfirmation] = useEditorState(memory, 'confirmation', '')
    const g = w.ops.generation
    const active = w.writable && canCreateVm(settings, w.snapshot.organizations)
    const edit = (run: () => void) => { if (active && w.ops.edit(g)) { run(); setError('') } }
    const patch = (next: Partial<CreateVmInput>) => edit(() => setDraft(value => ({ ...value, ...next })))
    const applyPlan = (plan: SetupPlan) => {
        setSummary(plan.summary); setPackages(plan.packages.join(', ')); setSuggestedKey(`${draft.os}:${prompt.trim()}`)
        setDraft(value => applyVmPlan(value, plan))
    }
    const create = () => {
        if (!active) return
        if (prompt.trim().length >= 5 && suggestedKey !== `${draft.os}:${prompt.trim()}` && !draft.services.length && !packages.trim()) { setError('Generate a setup for this description or clear it to create a blank VM.'); return }
        try {
            const input = createPayload({ ...draft, custom_apt_packages: packages.split(',').map(p => p.trim()).filter(Boolean) })
            if (resume && confirmation !== resume) { setError('Type the exact VM name to confirm resuming its setup.'); return }
            w.request(g, resume ? 'reprovision' : 'create', input.name, resume ? 'Resume VM setup?' : 'Create virtual machine?',
                `${input.name} · ${input.os} · ${input.resources.cpu} CPU / ${input.resources.memory} RAM / ${input.resources.disk} disk. ${input.services.join(', ') || 'Base system'}. The server queues provisioning; this does not mean it is running.`, async op => {
                    const receipt = await services.createVm(settings, input, op.signal)
                    return `${receipt.vm.name}: creation accepted (201). Refresh to observe provisioning and host state.`
                })
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Review VM setup fields.') }
    }
    return <GlassCard><View key={`create:${g}`} style={{ gap: 12 }}>
        <VmText strong>{resume ? `Resume setup: ${resume}` : 'Create virtual machine'}</VmText>
        {!active && <InlineNotice message='Creating or planning requires your own account and current organization owner or admin access. Refresh permissions before continuing.' />}
        {error && <InlineNotice message={error} tone='error' />}
        <VmField label='VM name' value={draft.name} enabled={!!active && !resume} onChange={name => patch({ name })} max={63} />
        <VmText>Operating system</VmText>
        <VmRow>{operatingSystems.map(os => <PillButton key={os} label={`${draft.os === os ? '✓ ' : ''}${os}`} small disabled={!active} onPress={() => edit(() => { setDraft(v => ({ ...(prompt.trim() ? clearVmSuggestion(v) : v), os, ...(os === 'ubuntu-24.04-desktop' ? { resources: resourcePlans[2] } : {}) })); setPackages(''); setSummary(''); setSuggestedKey('') })} />)}</VmRow>
        {draft.os === 'ubuntu-24.04-desktop' && <VmText>After creation, synchronize SSH access in the Access tab. Add -N -L 3389:127.0.0.1:3389 to its SSH command, then connect Remote Desktop to 127.0.0.1:3389 using the VM username and password.</VmText>}
        <VmText>Resource plan</VmText>
        <VmRow>{resourcePlans.map(resources => <PillButton key={resources.cpu} label={`${draft.resources.cpu === resources.cpu ? '✓ ' : ''}${resources.cpu} CPU · ${resources.memory} · ${resources.disk}`} small disabled={!active} onPress={() => patch({ resources })} />)}</VmRow>
        <VmText>Services</VmText>
        <VmRow>{setupServices.map(service => <PillButton key={service} label={`${draft.services.includes(service) ? '✓ ' : ''}${service}`} small disabled={!active || !!draft.project_files?.length && ['nodejs', 'website', 'minecraft-java'].includes(service)}
            onPress={() => patch({ services: draft.services.includes(service) ? draft.services.filter(v => v !== service) : [...draft.services, service], ...(service === 'minecraft-java' ? { minecraft_eula_accepted: false, minecraft_server_type: undefined } : {}), ...(service === 'website' && draft.services.includes(service) ? { website: undefined } : {}) })} />)}</VmRow>
        <VmField label='Ubuntu packages (comma separated, up to 12)' value={packages} enabled={!!active} onChange={value => edit(() => setPackages(value))} />
        {draft.services.includes('minecraft-java') && <>
            <VmRow>{minecraftTypes.map(type => <PillButton key={type} label={`${draft.minecraft_server_type === type ? '✓ ' : ''}${type}`} small disabled={!active} onPress={() => patch({ minecraft_server_type: type })} />)}</VmRow>
            <VmText>Minecraft needs at least 4 GiB. Review the Minecraft EULA before accepting.</VmText>
            <PillButton label='Read Minecraft EULA' onPress={() => { if (w.ops.idle(g)) void Linking.openURL('https://www.minecraft.net/eula') }} />
            <PillButton label={draft.minecraft_eula_accepted ? '✓ Minecraft EULA accepted' : 'Accept Minecraft EULA'} disabled={!active} onPress={() => patch({ minecraft_eula_accepted: !draft.minecraft_eula_accepted })} />
        </>}
        {draft.services.includes('website') && <>
            <VmText strong>Website content</VmText>
            <VmField label='Website title' value={draft.website?.title || ''} enabled={!!active} onChange={title => patch({ website: withWebsiteField(draft, { title }) })} />
            <VmField label='Website tagline' value={draft.website?.tagline || ''} enabled={!!active} onChange={tagline => patch({ website: { title: draft.website?.title || '', ...draft.website, tagline, sections: draft.website?.sections || [] } })} />
            <VmField label='Contact email' value={draft.website?.contactEmail || ''} enabled={!!active} onChange={contactEmail => patch({ website: { title: draft.website?.title || '', tagline: '', sections: [], ...draft.website, contactEmail } })} />
            {draft.website?.sections.map((section, index) => <GlassCard key={index}>
                <VmField label={`Section ${index + 1} heading`} value={section.heading} enabled={!!active} onChange={heading => patch({ website: { ...draft.website!, sections: draft.website!.sections.map((s, i) => i === index ? { ...s, heading } : s) } })} />
                <VmField label={`Section ${index + 1} body`} value={section.body} multiline enabled={!!active} onChange={body => patch({ website: { ...draft.website!, sections: draft.website!.sections.map((s, i) => i === index ? { ...s, body } : s) } })} />
                <PillButton label='Remove section' disabled={!active} onPress={() => { patch({ website: { ...draft.website!, sections: draft.website!.sections.filter((_, i) => i !== index) } }); w.ops.context(g); w.publish() }} />
            </GlassCard>)}
            <PillButton label='Add website section' disabled={!active || (draft.website?.sections.length || 0) >= 5} onPress={() => { patch({ website: { title: '', tagline: '', ...draft.website, sections: [...(draft.website?.sections || []), { heading: '', body: '' }] } }); w.ops.context(g); w.publish() }} />
            {draft.website?.gallery?.map((image, index) => <GlassCard key={`gallery-${index}`}>
                <VmText>Gallery {index + 1}</VmText>
                {(['url', 'alt', 'caption'] as const).map(key => <VmField key={key} label={`Image ${key}`} value={image[key]} enabled={!!active} onChange={value => patch({ website: { ...draft.website!, gallery: draft.website!.gallery!.map((s, i) => i === index ? { ...s, [key]: value } : s) } })} />)}
                <PillButton label='Remove image' disabled={!active} onPress={() => { patch({ website: { ...draft.website!, gallery: draft.website!.gallery!.filter((_, i) => i !== index) } }); w.ops.context(g); w.publish() }} />
            </GlassCard>)}
            <PillButton label='Add gallery image' disabled={!active || (draft.website?.gallery?.length || 0) >= 8} onPress={() => { patch({ website: { title: '', tagline: '', sections: [], ...draft.website, gallery: [...(draft.website?.gallery || []), { url: '', alt: '', caption: '' }] } }); w.ops.context(g); w.publish() }} />
        </>}
        <VmField label='Describe a setup for AI planning' value={prompt} multiline enabled={!!active} onChange={value => edit(() => { setPrompt(value); setDraft(clearVmSuggestion); setPackages(''); setSummary(''); setSuggestedKey('') })} />
        <PillButton label='Review AI setup request' disabled={!active || prompt.trim().length < 5} onPress={() => w.request(g, 'setup_plan', draft.name || 'new-vm', 'Generate setup plan?', 'This invokes the configured AI service. Review its services, packages, website and generated source before creation. It does not create a VM.', async op => {
            const plan = await services.suggestSetup(settings, prompt, draft.os, op.signal)
            if (acceptsVmResult(w.ops, op, settings)) applyPlan(plan)
            return 'Setup plan received. Review all fields and generated files before creating the VM.'
        })} />
        {summary && <VmText>{summary}</VmText>}
        {!!draft.project_files?.length && <>
            <VmText strong>Generated project files · {draft.project_files.length}</VmText>
            <VmText>These files will be installed and built on the guest. Review every file. Project setup requires Node.js and at least 4 GiB.</VmText>
            {draft.project_files.map((file, index) => <GlassCard key={file.path}>
                <VmText strong>{file.path}</VmText>
                <VmField label={`Source ${file.path}`} value={file.content} multiline max={49152} enabled={!!active} onChange={content => patch({ project_files: draft.project_files!.map((v, i) => i === index ? { ...v, content } : v) })} />
            </GlassCard>)}
            <PillButton label='Remove generated project' disabled={!active} onPress={() => { patch({ project_files: undefined }); w.ops.context(g); w.publish() }} />
        </>}
        {resume && <VmField label={`Type ${resume} to resume setup`} value={confirmation} enabled={!!active} onChange={value => edit(() => setConfirmation(value))} />}
        <PillButton label={resume ? 'Review resumed setup' : 'Review VM creation'} disabled={!active} tone='accent' onPress={create} />
    </View></GlassCard>
}

function useEditorState<K extends keyof VmEditorState>(memory: VmEditorMemory | undefined, key: K, initial: VmEditorState[K]) {
    const value = useRef(editorValue(memory, key, initial)), [state, setState] = useState(value.current)
    const set = (action: SetStateAction<VmEditorState[K]>) => {
        const next = typeof action === 'function' ? (action as (previous: VmEditorState[K]) => VmEditorState[K])(value.current) : action
        value.current = next; saveEditorValue(memory, key, next); setState(next)
    }
    return [state, set] as const
}
