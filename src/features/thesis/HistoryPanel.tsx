import { useEffect, useRef, useState } from 'react'
import { Alert, View } from 'react-native'
import { GlassCard, InlineNotice, PillButton } from '../../components/ui'
import type { HistoryEntry, ThesisApi } from './api'
import type { ThesisDocument } from './document'
import { Actions, ThesisText } from './ui'
import { MarkdownView } from './MarkdownView'
import { identifiedSheets } from './workspace'

export function HistoryPanel({ api, enabled, guard, onRestore }: { api: ThesisApi; enabled: boolean; guard: () => boolean; onRestore: (value: ThesisDocument) => Promise<boolean> }) {
    const [items, setItems] = useState<HistoryEntry[] | null>(null)
    const [preview, setPreview] = useState<ThesisDocument | null>(null)
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const [more, setMore] = useState(false)
    const mounted = useRef(true), operation = useRef(0), controller = useRef<AbortController | null>(null)
    const current = useRef({ enabled, guard, busy, preview }); current.current = { enabled, guard, busy, preview }
    useEffect(() => () => { mounted.current = false; operation.current++; controller.current?.abort() }, [])
    async function load(older = false) {
        if (current.current.busy || !current.current.enabled || !current.current.guard()) return
        const id = ++operation.current, request = new AbortController(); controller.current = request
        setBusy(true)
        try {
            const result = await api.history(request.signal, older ? items?.at(-1)?.revision : undefined)
            if (!mounted.current || id !== operation.current) return
            setItems(older ? [...items || [], ...result] : result); setMore(result.length === 50); setError('')
        } catch (cause) { if (!request.signal.aborted && mounted.current) setError((cause as Error).message) }
        finally { if (mounted.current && id === operation.current) setBusy(false) }
    }
    async function show(revision: number) {
        if (current.current.busy || !current.current.enabled || !current.current.guard()) return
        const id = ++operation.current, request = new AbortController(); controller.current = request
        setBusy(true); setPreview(null)
        try { const value = await api.version(revision, request.signal); if (mounted.current && id === operation.current) setPreview(value) }
        catch (cause) { if (!request.signal.aborted && mounted.current) setError((cause as Error).message) }
        finally { if (mounted.current && id === operation.current) setBusy(false) }
    }
    function restore() {
        const value = preview, reviewed = operation.current
        if (!value || current.current.busy || !current.current.enabled || !current.current.guard()) return
        Alert.alert('Restore this version?', `Replace the current shared document with revision ${value.revision}. Your current draft must save first.`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Restore', style: 'destructive', onPress: () => {
                if (!mounted.current || reviewed !== operation.current || current.current.busy || current.current.preview !== value || !current.current.enabled || !current.current.guard()) return
                setBusy(true)
                void onRestore(value).then(saved => { if (mounted.current) { if (saved) { setPreview(null); setItems(null) } else setError('Restore did not complete. Review your draft and refresh before trying again.') } }).finally(() => { if (mounted.current) setBusy(false) })
            } },
        ])
    }
    return <View style={{ gap: 12 }}>
        <ThesisText heading>Version history</ThesisText>
        <ThesisText muted>The immediate previous version is kept with regular checkpoints. After seven days, one checkpoint per eight-hour block remains.</ThesisText>
        <InlineNotice message={error} />
        <PillButton label={busy ? 'Loading…' : 'Load version history'} onPress={() => void load()} disabled={busy || !enabled} />
        {items?.map(item => <GlassCard key={item.revision}><View style={{ gap: 8 }}><ThesisText>{item.title} · revision {item.revision}</ThesisText><ThesisText muted>{item.saved_at}{item.immediate ? ' · immediate previous version' : ''}</ThesisText><PillButton label='Preview version' onPress={() => void show(item.revision)} disabled={busy || !enabled} /></View></GlassCard>)}
        {more && <PillButton label='Older versions' disabled={busy || !enabled} onPress={() => void load(true)} />}
        {preview && <GlassCard><View style={{ gap: 12 }}>
            <ThesisText heading>Revision {preview.revision}</ThesisText>
            {identifiedSheets(preview.title, preview.body).map(sheet => <View key={sheet.id} style={{ gap: 8 }}><ThesisText heading>{sheet.name}</ThesisText><MarkdownView source={sheet.title + '\n\n' + sheet.body} /></View>)}
            <Actions><PillButton label='Restore this version' tone='danger' onPress={restore} disabled={!enabled || busy} /><PillButton label='Close preview' onPress={() => { operation.current++; setPreview(null) }} /></Actions>
        </View></GlassCard>}
    </View>
}
