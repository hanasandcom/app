import AsyncStorage from '@react-native-async-storage/async-storage'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { FileText, X } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { AppSettings, Note } from '../types'
import { createNote, deleteNote, fetchNotes, updateNote } from '../lib/api'
import { workspaceAccountKey } from '../lib/workspace-data'
import { PillButton, Screen } from '../components/ui'
import { radius, spacing, type ThemePalette } from '../theme/tokens'
import { useAppTheme } from '../theme/context'

const NOTES_CACHE_KEY = 'hanasand-mobile/account-notes/'

type LocalNote = Note & {
    syncState: 'synced' | 'pending'
    localUpdatedAt: number
    baseUpdatedAt?: string
    deletedOnWebsite?: boolean
    remoteVersion?: Note
}

const emptyDraft = { title: '', content: '' }

function nowIso() {
    return new Date().toISOString()
}

function createLocalNote() {
    const timestamp = nowIso()
    return {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title: '',
        content: '',
        source: 'app',
        owner_id: '',
        created_at: timestamp,
        updated_at: timestamp,
        syncState: 'pending',
        localUpdatedAt: Date.now(),
    } satisfies LocalNote
}

function normalizeLocalNote(value: unknown): LocalNote | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const entry = value as Partial<LocalNote>
    if (typeof entry.id !== 'string' || !entry.id) return null

    return {
        id: entry.id,
        title: typeof entry.title === 'string' ? entry.title : '',
        content: typeof entry.content === 'string' ? entry.content : '',
        source: typeof entry.source === 'string' ? entry.source : 'app',
        owner_id: typeof entry.owner_id === 'string' ? entry.owner_id : '',
        created_at: typeof entry.created_at === 'string' ? entry.created_at : nowIso(),
        updated_at: typeof entry.updated_at === 'string' ? entry.updated_at : nowIso(),
        syncState: entry.syncState === 'synced' ? 'synced' : 'pending',
        localUpdatedAt: typeof entry.localUpdatedAt === 'number' ? entry.localUpdatedAt : Date.now(),
        baseUpdatedAt: entry.baseUpdatedAt,
        remoteVersion: entry.remoteVersion,
        deletedOnWebsite: entry.deletedOnWebsite === true,
    }
}

function notePreview(note: LocalNote) {
    return note.content.trim() || 'No additional text'
}

function noteTitle(note: LocalNote) {
    return note.title.trim() || note.content.trim().split('\n')[0] || 'New note'
}

function fromRemote(note: Note): LocalNote {
    return {
        ...note,
        syncState: 'synced',
        baseUpdatedAt: note.updated_at,
        localUpdatedAt: Date.parse(note.updated_at || note.created_at) || Date.now(),
    }
}

function sortNotes(notes: LocalNote[]) {
    return [...notes].sort((a, b) => b.localUpdatedAt - a.localUpdatedAt)
}

function hasText(note: LocalNote) {
    return Boolean(note.title.trim() || note.content.trim())
}

export function NotesScreen({ settings }: { settings: AppSettings }) {
    return <AccountNotes key={workspaceAccountKey(settings)} settings={settings} />
}

function AccountNotes({ settings }: { settings: AppSettings }) {
    const theme = useAppTheme()
    const insets = useSafeAreaInsets()
    const styles = useMemo(() => createStyles(theme), [theme])
    const [notes, setNotes] = useState<LocalNote[]>([])
    const [selectedId, setSelectedId] = useState('')
    const [draft, setDraft] = useState(emptyDraft)
    const [menuOpen, setMenuOpen] = useState(false)
    const [search, setSearch] = useState('')
    const [loading, setLoading] = useState(true)
    const [syncing, setSyncing] = useState(false)
    const [loadError, setLoadError] = useState('')
    const [cacheError, setCacheError] = useState('')
    const [cacheRetry, setCacheRetry] = useState(0)
    const [persistedNotes, setPersistedNotes] = useState<LocalNote[] | null>(null)
    const [remoteAvailable, setRemoteAvailable] = useState(false)
    const [hydrated, setHydrated] = useState(false)
    const notesRef = useRef<LocalNote[]>([])
    const selectedRef = useRef('')
    const active = useRef(true)
    const syncingRef = useRef(false)
    const cacheWriteRef = useRef<Promise<void>>(Promise.resolve())
    const cacheKey = NOTES_CACHE_KEY + encodeURIComponent(workspaceAccountKey(settings))
    const configured = Boolean(settings.apiBaseUrl.trim() && settings.authToken.trim() && settings.userId.trim())
    const selected = notes.find(note => note.id === selectedId) || null
    const pendingChanges = notes.some(note => note.syncState === 'pending' && (hasText(note) || !note.id.startsWith('local-')))
    const locallySaved = persistedNotes === notes
    let syncStatus = remoteAvailable ? 'Synced with Hanasand' : 'Offline · showing cached notes'
    if (!configured) syncStatus = 'Sign in to sync notes'
    else if (loading) syncStatus = 'Loading notes…'
    else if (syncing) syncStatus = 'Syncing…'
    else if (cacheError) syncStatus = 'Device save failed · retry to save your edits'
    else if (pendingChanges && !locallySaved) syncStatus = 'Saving on this device…'
    else if (selected?.remoteVersion || selected?.deletedOnWebsite) syncStatus = 'Saved on this device · website changes need review'
    else if (pendingChanges) syncStatus = remoteAvailable ? 'Saved on this device · waiting to sync' : 'Saved on this device · offline'
    const visibleNotes = notes.filter(note => hasText(note) && `${note.title} ${note.content}`.toLowerCase().includes(search.toLowerCase()))

    function replaceNotes(next: LocalNote[]) {
        if (!active.current) return
        notesRef.current = sortNotes(next)
        setNotes(notesRef.current)
    }
    function choose(id: string) {
        selectedRef.current = id
        setSelectedId(id)
        const note = notesRef.current.find(item => item.id === id)
        setDraft(note ? { title: note.title, content: note.content } : emptyDraft)
    }
    useEffect(() => {
        active.current = true
        void hydrate()
        return () => { active.current = false }
    }, [])
    useEffect(() => {
        if (!hydrated || !configured) return
        // Serialize writes so an older completion cannot replace the latest cache.
        cacheWriteRef.current = cacheWriteRef.current.then(async () => {
            try {
                await AsyncStorage.setItem(cacheKey, JSON.stringify(notes))
                if (active.current && notesRef.current === notes) {
                    setPersistedNotes(notes)
                    setCacheError('')
                }
            } catch {
                if (active.current && notesRef.current === notes) setCacheError('Unable to save notes on this device.')
            }
        })
    }, [notes, hydrated, cacheKey, configured, cacheRetry])
    useEffect(() => {
        if (!hydrated || !configured || !notes.some(note => note.syncState === 'pending' && !note.remoteVersion && !note.deletedOnWebsite && (hasText(note) || !note.id.startsWith('local-')))) return
        const timer = setTimeout(() => { void syncPendingNotes() }, 1200)
        return () => clearTimeout(timer)
    }, [notes, hydrated, configured, settings.authToken])

    async function hydrate() {
        if (syncingRef.current) return
        setLoading(true)
        setLoadError('')
        try {
            if (!configured) { setLoadError('Sign in to load your notes.'); return }
            if (!hydrated) {
                const raw = await AsyncStorage.getItem(cacheKey)
                const cached = raw ? JSON.parse(raw) : []
                if (!active.current) return
                replaceNotes(Array.isArray(cached) ? cached.map(normalizeLocalNote).filter((note: LocalNote | null): note is LocalNote => note !== null) : [])
            }
            try {
                const remote = await fetchNotes(settings)
                if (!active.current) return
                setRemoteAvailable(true)
                const pending = notesRef.current.filter(note => note.syncState === 'pending')
                const pendingIds = new Set(pending.map(note => note.id))
                replaceNotes([...remote.filter(note => !pendingIds.has(note.id)).map(fromRemote), ...pending.map(note => {
                    const website = remote.find(item => item.id === note.id)
                    return website && website.updated_at !== note.baseUpdatedAt ? { ...note, remoteVersion: website } : !website && !note.id.startsWith('local-') ? { ...note, deletedOnWebsite: true } : note
                })])
            } catch (error) {
                if (active.current) {
                    setRemoteAvailable(false)
                    setLoadError(error instanceof Error ? error.message : 'Unable to load website notes.')
                }
            }
            if (active.current) {
                if (!selectedRef.current || !notesRef.current.some(note => note.id === selectedRef.current)) choose(notesRef.current[0]?.id || '')
                else choose(selectedRef.current)
            }
        } catch { if (active.current) setLoadError('Unable to read saved notes on this device.') }
        finally { if (active.current) { setHydrated(true); setLoading(false) } }
    }

    function updateDraft(nextDraft: typeof emptyDraft) {
        setDraft(nextDraft)
        const base = notesRef.current.find(note => note.id === selectedRef.current) || createLocalNote()
        const next: LocalNote = { ...base, ...nextDraft, updated_at: nowIso(), syncState: 'pending', localUpdatedAt: Date.now() }
        replaceNotes([next, ...notesRef.current.filter(note => note.id !== base.id)])
        selectedRef.current = next.id
        setSelectedId(next.id)
    }
    function openNote(note: LocalNote) { choose(note.id); setMenuOpen(false) }
    function startFreshNote() { choose(''); setMenuOpen(false) }

    async function syncPendingNotes() {
        if (syncingRef.current || !configured) return
        syncingRef.current = true
        setSyncing(true)
        try {
            const remote = await fetchNotes(settings)
            if (!active.current) return
            setRemoteAvailable(true)
            for (const note of notesRef.current.filter(item => item.syncState === 'pending' && !item.remoteVersion && !item.deletedOnWebsite && (hasText(item) || !item.id.startsWith('local-')))) {
                const website = remote.find(item => item.id === note.id)
                if (!note.id.startsWith('local-') && (!website || website.updated_at !== note.baseUpdatedAt)) {
                    if (website) replaceNotes(notesRef.current.map(item => item.id === note.id ? { ...item, remoteVersion: website } : item))
                    else replaceNotes(notesRef.current.map(item => item.id === note.id ? { ...item, deletedOnWebsite: true } : item))
                    continue
                }
                const payload = { title: note.title, content: note.content }
                const saved = note.id.startsWith('local-') ? await createNote(settings, payload) : await updateNote(settings, note.id, payload)
                if (!active.current) return
                const latest = notesRef.current.find(item => item.id === note.id)
                if (!latest) continue
                const changed = latest.title !== note.title || latest.content !== note.content
                const next = changed ? { ...latest, id: saved.id, baseUpdatedAt: saved.updated_at, remoteVersion: undefined } : fromRemote(saved)
                replaceNotes([next, ...notesRef.current.filter(item => item.id !== note.id && item.id !== saved.id)])
                if (selectedRef.current === note.id) { selectedRef.current = saved.id; setSelectedId(saved.id) }
            }
        } catch (error) {
            if (active.current) {
                setRemoteAvailable(false)
                setLoadError(error instanceof Error ? error.message : 'Sync failed. Please retry.')
            }
        }
        finally { syncingRef.current = false; if (active.current) setSyncing(false) }
    }

    function resolveConflict(useWebsite: boolean) {
        if (!selected?.remoteVersion) return
        const website = selected.remoteVersion
        // Keep both versions unless the user chooses the website copy.
        const next = useWebsite ? fromRemote(website) : { ...selected, id: createLocalNote().id, baseUpdatedAt: undefined, remoteVersion: undefined }
        replaceNotes([next, ...(useWebsite ? [] : [fromRemote(website)]), ...notesRef.current.filter(item => item.id !== selected.id)])
        choose(next.id)
    }
    function removeSelected() {
        if (!selected || syncing) return
        Alert.alert('Delete note?', 'This removes the note from your account and this device.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => { void (async () => {
                syncingRef.current = true
                setSyncing(true)
                try {
                    if (!selected.id.startsWith('local-')) await deleteNote(settings, selected.id)
                    if (!active.current) return
                    replaceNotes(notesRef.current.filter(note => note.id !== selected.id))
                    choose(notesRef.current[0]?.id || '')
                } catch (error) { if (active.current) setLoadError(error instanceof Error ? error.message : 'Unable to delete note.') }
                finally { syncingRef.current = false; if (active.current) setSyncing(false) }
            })() } },
        ])
    }

    return (
        <Screen
            title='Notes'
            scroll={false}
            left={(
                <Pressable
                    accessibilityRole='button'
                    accessibilityLabel='Open previous notes'
                    onPress={() => setMenuOpen(true)}
                    style={({ pressed }) => [styles.menuButton, pressed && styles.pressed]}
                >
                    <FileText color={theme.textMuted} size={21} strokeWidth={2.1} />
                </Pressable>
            )}
        >
            {(loading || loadError || cacheError) && <View style={{ paddingHorizontal: 14, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ flex: 1, color: theme.textMuted, fontSize: 12 }}>{loading ? 'Syncing notes with Hanasand…' : cacheError || loadError}</Text>
                {!loading && <Pressable accessibilityRole='button' onPress={() => { setCacheRetry(current => current + 1); void hydrate() }} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: theme.ambientNeutral }}><Text style={{ color: theme.text, fontWeight: '700', fontSize: 12 }}>Retry</Text></Pressable>}
            </View>}
            <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.sm }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                    <PillButton label='New note' small onPress={startFreshNote} disabled={!hydrated || !configured} />
                    <PillButton label={`${notes.filter(hasText).length} notes`} small onPress={() => setMenuOpen(true)} />
                    <PillButton label='Sync' small onPress={() => { setLoadError(''); void hydrate() }} disabled={loading || syncing} />
                    {selected && <PillButton label='Delete' tone='danger' small disabled={syncing} onPress={removeSelected} />}
                </View>
                <TextInput accessibilityLabel='Search notes' value={search} onChangeText={setSearch} placeholder='Search notes' placeholderTextColor={theme.textSoft} style={{ color: theme.text, padding: 10, borderRadius: 12, backgroundColor: theme.ambientNeutral }} />
                <PillButton label={selected ? noteTitle(selected) : `${visibleNotes.length} notes · Choose a note`} small onPress={() => setMenuOpen(true)} disabled={!visibleNotes.length} />
                <Text style={{ color: theme.textMuted, fontSize: 12 }}>{syncStatus}</Text>
                {!!selected?.deletedOnWebsite && <View style={{ gap: 8 }}><Text style={{ color: theme.textMuted }}>This note was deleted on the website. Your edits remain on this device.</Text><PillButton label='Keep as new note' small onPress={() => { const copy = { ...selected, id: createLocalNote().id, deletedOnWebsite: false, baseUpdatedAt: undefined }; replaceNotes([copy, ...notesRef.current.filter(note => note.id !== selected.id)]); choose(copy.id) }} /></View>}
                {!!selected?.remoteVersion && <View style={{ gap: 8 }}><Text style={{ color: theme.textMuted }}>This note changed on the website. Keep your edits as a new note or use the website version.</Text><View style={{ flexDirection: 'row', gap: 8 }}><PillButton label='Keep both' small onPress={() => resolveConflict(false)} /><PillButton label='Use website' small onPress={() => resolveConflict(true)} /></View></View>}
            </View>
            <View style={styles.editor}>
                <TextInput
                    editable={hydrated && configured && !loading}
                    value={draft.title}
                    onChangeText={(title) => updateDraft({ ...draft, title })}
                    placeholder='Title'
                    placeholderTextColor={theme.textSoft}
                    style={styles.titleInput}
                    returnKeyType='next'
                />
                <View style={styles.divider} />
                <TextInput
                    editable={hydrated && configured && !loading}
                    value={draft.content}
                    onChangeText={(content) => updateDraft({ ...draft, content })}
                    placeholder='Note'
                    placeholderTextColor={theme.textSoft}
                    multiline
                    textAlignVertical='top'
                    style={styles.bodyInput}
                />
            </View>

            <Modal visible={menuOpen} transparent animationType='fade' onRequestClose={() => setMenuOpen(false)}>
                <View style={[styles.modalBackdrop, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuOpen(false)} />
                    <View style={styles.noteDrawer}>
                        <View style={styles.drawerHeader}>
                            <Text style={styles.drawerTitle}>Previous notes</Text>
                            <Pressable
                                accessibilityRole='button'
                                accessibilityLabel='Close previous notes'
                                onPress={() => setMenuOpen(false)}
                                style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
                            >
                                <X color={theme.textMuted} size={18} />
                            </Pressable>
                        </View>
                        <ScrollView contentContainerStyle={styles.noteList}>
                            <Pressable
                                accessibilityRole='button'
                                accessibilityLabel='Start a fresh note'
                                onPress={startFreshNote}
                                style={({ pressed }) => [styles.noteRow, styles.freshNoteRow, pressed && styles.pressed]}
                            >
                                <FileText color={theme.text} size={17} />
                                <View style={styles.noteRowText}>
                                    <Text style={styles.noteTitle}>Fresh note</Text>
                                    <Text style={styles.notePreview}>Start typing. It saves automatically.</Text>
                                </View>
                            </Pressable>
                            {notes.filter(hasText).map(note => (
                                <Pressable
                                    key={note.id}
                                    accessibilityRole='button'
                                    accessibilityLabel={`Open ${noteTitle(note)}`}
                                    accessibilityState={{ selected: note.id === selectedId }}
                                    onPress={() => openNote(note)}
                                    style={({ pressed }) => [
                                        styles.noteRow,
                                        note.id === selectedId && styles.noteRowActive,
                                        pressed && styles.pressed,
                                    ]}
                                >
                                    <FileText color={note.id === selectedId ? theme.text : theme.textSoft} size={17} />
                                    <View style={styles.noteRowText}>
                                        <Text style={styles.noteTitle} numberOfLines={1}>{noteTitle(note)}</Text>
                                        <Text style={styles.notePreview} numberOfLines={2}>{notePreview(note)}</Text>
                                    </View>
                                </Pressable>
                            ))}
                            {!notes.filter(hasText).length && (
                                <View style={styles.emptyState}>
                                    <Text style={styles.notePreview}>Start typing and your note will be kept here automatically.</Text>
                                </View>
                            )}
                        </ScrollView>
                    </View>
                </View>
            </Modal>
        </Screen>
    )
}

function createStyles(theme: ThemePalette) {
    return StyleSheet.create({
        menuButton: {
            width: 46,
            height: 46,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: theme.surfaceBorder,
            backgroundColor: theme.surface,
            alignItems: 'center',
            justifyContent: 'center',
        },
        editor: {
            flex: 1,
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.lg,
        },
        titleInput: {
            color: theme.text,
            fontSize: 28,
            fontWeight: '700',
            paddingVertical: spacing.sm,
        },
        divider: {
            height: 1,
            backgroundColor: theme.surfaceBorderSoft,
            marginBottom: spacing.md,
        },
        bodyInput: {
            flex: 1,
            color: theme.text,
            fontSize: 18,
            lineHeight: 27,
            paddingTop: 0,
        },
        modalBackdrop: {
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.48)',
            justifyContent: 'flex-start',
            paddingTop: 132,
            paddingHorizontal: spacing.lg,
        },
        noteDrawer: {
            maxHeight: '68%',
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: theme.surfaceBorder,
            backgroundColor: theme.backgroundRaised,
            overflow: 'hidden',
        },
        drawerHeader: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: spacing.md,
            borderBottomWidth: 1,
            borderBottomColor: theme.surfaceBorderSoft,
        },
        drawerTitle: {
            color: theme.text,
            fontSize: 20,
            fontWeight: '700',
        },
        closeButton: {
            width: 34,
            height: 34,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.surface,
        },
        noteList: {
            padding: spacing.sm,
            gap: spacing.xs,
        },
        noteRow: {
            flexDirection: 'row',
            gap: spacing.sm,
            borderRadius: radius.md,
            padding: spacing.md,
            alignItems: 'flex-start',
        },
        noteRowActive: {
            backgroundColor: theme.surface,
        },
        freshNoteRow: {
            borderWidth: 1,
            borderColor: theme.surfaceBorderSoft,
            backgroundColor: theme.surface,
        },
        noteRowText: {
            flex: 1,
            gap: 4,
        },
        noteTitle: {
            color: theme.text,
            fontSize: 15,
            fontWeight: '700',
        },
        notePreview: {
            color: theme.textMuted,
            fontSize: 13,
            lineHeight: 18,
        },
        emptyState: {
            padding: spacing.md,
        },
        pressed: {
            opacity: 0.82,
            transform: [{ scale: 0.98 }],
        },
    })
}
