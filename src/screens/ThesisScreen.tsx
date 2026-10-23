import { useRef, useState } from 'react'
import { View } from 'react-native'
import { GlassCard, InlineNotice, PillButton, Screen } from '../components/ui'
import type { AppSettings } from '../types'
import { useThesis, type ThesisServices } from '../features/thesis/useThesis'
import { WorkspaceEditor } from '../features/thesis/WorkspaceEditor'
import { HistoryPanel } from '../features/thesis/HistoryPanel'
import { CodeInventory } from '../features/thesis/CodeInventory'
import { Actions, ThesisText } from '../features/thesis/ui'
import type { ThesisDocument } from '../features/thesis/document'

export default function ThesisScreen({ settings, services }: { settings: AppSettings; services?: ThesisServices }) {
    const thesis = useThesis(settings, services)
    const [panel, setPanel] = useState<'workspace' | 'history' | 'code'>('workspace')
    const current = useRef({ thesis, panel }); current.current = { thesis, panel }
    const generation = thesis.generation.current
    function guard(expected = panel) {
        const live = current.current
        return live.thesis.visible && live.panel === expected && live.thesis.generation.current === generation
            && live.thesis.canEdit && !!live.thesis.state && !live.thesis.state.unknown && !live.thesis.state.conflict
    }
    function navigate(next: typeof panel) { thesis.renew(); setPanel(next) }
    async function restore(value: ThesisDocument) {
        if (!guard('history') || thesis.state?.pending) return false
        const epoch = thesis.epoch.current
        if (thesis.state?.dirty && !await thesis.save()) return false
        const latest = current.current.thesis
        if (!latest.visible || latest.epoch.current !== epoch || !latest.canEdit || !latest.state || latest.state.dirty || latest.state.pending || latest.state.unknown || latest.state.conflict) return false
        latest.edit({ ...value, revision: latest.state.base.revision }, latest.generation.current, '', true)
        // save() reads the owned model; explicit restore remains one reviewed PUT.
        return latest.save()
    }
    const model = thesis.state
    return (
        <Screen title='Thesis' subtitle='Shared Hanasand workspace'>
            {!thesis.visible ? <InlineNotice tone='info' message='Thesis is paused while this screen is hidden.' /> : <>
                <InlineNotice message={thesis.error} />
                <ThesisText muted>{thesis.liveState}</ThesisText>
                <Actions key={`toolbar:${thesis.host}`}>
                    <PillButton label={thesis.loading ? 'Loading…' : 'Refresh and reconcile'} disabled={thesis.loading || !!model?.pending} onPress={() => void thesis.refresh()} />
                    <PillButton label={model?.pending ? 'Saving…' : 'Save now'} disabled={!thesis.canEdit || !model?.dirty || model.pending || model.unknown || !!model.conflict} onPress={() => void thesis.save()} tone='accent' />
                    <PillButton label='Undo' disabled={!thesis.canEdit || !model?.canUndo || model.pending || model.unknown} onPress={() => { if (!guard()) return; model?.undo(); thesis.renew(); thesis.notify(); void thesis.persist() }} />
                    <PillButton label='Redo' disabled={!thesis.canEdit || !model?.canRedo || model.pending || model.unknown} onPress={() => { if (!guard()) return; model?.undo(true); thesis.renew(); thesis.notify(); void thesis.persist() }} />
                </Actions>
                {!!model && <ThesisText muted>Revision {model.base.revision} · {model.unknown ? 'Save outcome uncertain' : model.conflict ? 'Resolve shared changes' : model.pending ? 'Saving current revision' : model.dirty ? 'Draft · autosaves after 5 seconds' : 'Saved'} · {thesis.canEdit ? 'Editing enabled' : 'Read only'}</ThesisText>}
                {thesis.recovered?.draft && <GlassCard><View style={{ gap: 10 }}>
                    <ThesisText heading>Encrypted local draft found</ThesisText>
                    <ThesisText>Saved on this device {new Date(thesis.recovered.savedAt).toLocaleString()}. Revision {thesis.recovered.draft.revision}. Recover it to compare with the shared version.</ThesisText>
                    <Actions key={thesis.host}><PillButton label='Recover draft' onPress={() => thesis.recover(true)} /><PillButton label='Keep shared version' onPress={() => thesis.recover(false)} /></Actions>
                </View></GlassCard>}
                {model?.conflict && <GlassCard><View style={{ gap: 10 }}>
                    <ThesisText heading>Shared changes need review</ThesisText>
                    <ThesisText>Your draft: {model.draft.title} · {model.draft.body.length} characters</ThesisText>
                    <ThesisText>Latest: revision {model.conflict.revision} · {model.conflict.title} · {model.conflict.body.length} characters</ThesisText>
                    <Actions key={thesis.host}><PillButton label='Use my draft' disabled={!thesis.canEdit || model.unknown} onPress={() => thesis.resolve(true)} /><PillButton label='Use latest' disabled={!thesis.canEdit || model.unknown} onPress={() => thesis.resolve(false)} /></Actions>
                </View></GlassCard>}
                {model && <>
                    <Actions key={`panels:${thesis.host}`}><PillButton label='Workspace' onPress={() => navigate('workspace')} /><PillButton label='Version history' onPress={() => navigate('history')} disabled={!thesis.canEdit} /><PillButton label='Source and dependencies' onPress={() => navigate('code')} /></Actions>
                    <View style={{ display: panel === 'workspace' ? 'flex' : 'none' }}>
                        <WorkspaceEditor value={model.draft} host={thesis.host} enabled={thesis.canEdit && !model.unknown && !model.conflict && !thesis.recovered} guard={() => guard('workspace')} onContext={thesis.renew} onChange={(value, group, structural) => thesis.edit(value, generation, group, structural)} onHistory={() => navigate('history')} onCode={() => navigate('code')} />
                    </View>
                    {panel === 'history' && <HistoryPanel api={thesis.api} enabled={thesis.canEdit && !model.pending && !model.unknown && !model.conflict} guard={() => guard('history')} onRestore={restore} />}
                    {panel === 'code' && <CodeInventory api={thesis.api} canReview={thesis.canEdit && !model.pending && !model.unknown && !model.conflict} guard={() => guard('code')} host={thesis.host} />}
                </>}
            </>}
        </Screen>
    )
}
