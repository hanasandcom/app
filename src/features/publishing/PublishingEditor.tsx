import { useState } from 'react'
import { Alert, View } from 'react-native'
import { MarkdownView } from '../../components/MarkdownView'
import { InlineNotice, PillButton } from '../../components/ui'
import type { PublishingDesk } from './desk'
import { PublishingActions, PublishingField, PublishingText } from './ui'

export function PublishingEditor({ desk }: { desk: PublishingDesk }) {
    const state = desk.state
    const host = state.host
    const [preview, setPreview] = useState(false)
    const article = desk.kind === 'articles'
    const creating = state.mode === 'create'
    const canEdit = desk.canEdit(host)
    function review(action: 'create' | 'update' | 'delete') {
        const reviewed = desk.review(action, host)
        if (!reviewed) return
        const scope = state.access?.name || 'current workspace'
        Alert.alert(action === 'delete' ? 'Delete saved content?' : 'Save public content?', action === 'delete'
            ? `Delete ${reviewed.mutation.original!.id} from ${scope}? This cannot be undone in the app.`
            : `Save ${article ? reviewed.mutation.draft.id : 'this thought'} to ${scope}? Changes persist immediately and may appear on public pages. There is no draft publication stage or revision protection.`, [
            { text: 'Cancel', style: 'cancel' },
            { text: action === 'delete' ? 'Delete' : 'Save now', style: action === 'delete' ? 'destructive' : 'default', onPress: () => void desk.confirm(reviewed) },
        ])
    }
    function leave() {
        if (!desk.canRead(host) || state.unknown) return
        if (!desk.hasDraftChanges()) { desk.discard(host); return }
        const draft = { ...state.draft }
        Alert.alert('Discard unsaved changes?', 'This draft exists only in memory. Return to the list without saving?', [
            { text: 'Keep editing', style: 'cancel' }, { text: 'Discard draft', style: 'destructive', onPress: () => desk.discard(host, draft) },
        ])
    }
    return <View style={{ gap: 14 }}>
        <PublishingText heading>{creating ? `Create ${article ? 'article' : 'thought'}` : state.selected?.title || 'Saved content'}</PublishingText>
        {state.selected && <PublishingText muted>{state.selected.id}{state.selected.creatorId ? ` · Author ${state.selected.creatorId}` : ''}{state.selected.updatedAt || state.selected.createdAt ? ` · ${state.selected.updatedAt || state.selected.createdAt}` : ''}</PublishingText>}
        <InlineNotice tone='info' message='Saving changes public-facing content immediately. There is no separate draft or publish status and no automatic conflict detection.' />
        {article && <InlineNotice tone='info' message='This editor saves the article body. The service strips YAML frontmatter from reads; original frontmatter cannot be preserved by this API. Images use Markdown links; file uploads are not provided here.' />}
        <View key={`editor-actions:${host}`}>
            <PublishingActions>
                <PillButton label='Return to list' onPress={leave} disabled={!desk.canRead(host) || !!state.unknown} />
                <PillButton label={preview ? 'Edit source' : 'Markdown preview'} onPress={() => { if (desk.canRead(host)) setPreview(!preview) }} disabled={!desk.canRead(host)} />
                {creating && <PillButton label='Check for existing content' onPress={() => void desk.lookup(host)} disabled={!desk.canRead(host) || !!state.unknown || !state.draft.body.trim() || article && !state.draft.id.trim()} />}
            </PublishingActions>
        </View>
        {article && creating && <PublishingField label='Article filename' value={state.draft.id} onChange={id => desk.edit(host, { id })} editable={canEdit} host={host} />}
        {preview || !canEdit ? <MarkdownView source={state.draft.body} /> : <PublishingField label={article ? 'Article Markdown' : 'Thought Markdown'} value={state.draft.body} onChange={body => desk.edit(host, { body })} editable={canEdit} multiline host={host} />}
        {state.targetMissing && <InlineNotice message='The saved record was not found in the latest refresh. Your draft is kept; this record cannot be updated or deleted.' />}
        {state.latest && <View style={{ gap: 10 }}>
            <InlineNotice message='The saved body changed while your draft was open. There is no server revision check; saving your draft may overwrite this version.' />
            <PublishingText heading>Latest saved body</PublishingText>
            <MarkdownView source={state.latest.body || ''} />
            <View key={`latest:${host}`}><PillButton label='Review replacing draft with latest' disabled={!canEdit} onPress={() => {
                if (!desk.canEdit(host)) return
                const draft = { ...state.draft }, latest = state.latest
                Alert.alert('Replace unsaved draft?', 'Use the latest loaded saved body and discard your current unsaved text?', [{ text: 'Keep draft', style: 'cancel' }, { text: 'Use latest', style: 'destructive', onPress: () => desk.useLatest(host, draft, latest) }])
            }} /></View>
        </View>}
        {state.lookup && <InlineNotice tone='info' message={state.lookup.length ? 'Matching saved content exists in this workspace. No new save has been submitted.' : 'No matching content was found in this workspace. A global filename or title may still be reserved elsewhere.'} />}
        {state.lookup?.map(item => <View key={item.id} style={{ gap: 6 }}><PublishingText heading>{item.title}</PublishingText><PublishingText muted>{item.id}</PublishingText><MarkdownView source={item.body || ''} /></View>)}
        <View key={`save-actions:${host}`}>
            <PublishingActions>
                <PillButton label={creating ? 'Review create' : 'Review save'} tone='accent' onPress={() => review(creating ? 'create' : 'update')} disabled={!canEdit || !state.draft.body.trim() || !creating && state.targetMissing === true} />
                {!creating && <PillButton label='Review delete' tone='danger' onPress={() => review('delete')} disabled={!canEdit || state.targetMissing === true} />}
            </PublishingActions>
        </View>
    </View>
}
