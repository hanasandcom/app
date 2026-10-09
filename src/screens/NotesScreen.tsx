import AsyncStorage from '@react-native-async-storage/async-storage'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { FileText, Menu, X } from 'lucide-react-native'
import type { AppSettings, Note } from '../types'
import { createNote, fetchNotes, updateNote } from '../lib/api'
import { Screen } from '../components/ui'
import { radius, spacing, type ThemePalette } from '../theme/tokens'
import { useAppTheme } from '../theme/context'

const NOTES_CACHE_KEY = 'hanasand-mobile/local-notes'

type LocalNote = Note & {
    syncState: 'synced' | 'pending'
    localUpdatedAt: number
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
    const theme = useAppTheme()
    const styles = useMemo(() => createStyles(theme), [theme])
    const [notes, setNotes] = useState<LocalNote[]>([])
    const [selectedId, setSelectedId] = useState('')
    const [draft, setDraft] = useState(emptyDraft)
    const [menuOpen, setMenuOpen] = useState(false)
    const hydratedRef = useRef(false)
    const syncingRef = useRef(false)
    const configured = Boolean(settings.apiBaseUrl.trim() && settings.authToken.trim() && settings.userId.trim())
    const selected = useMemo(() => notes.find((note) => note.id === selectedId) || null, [notes, selectedId])

    useEffect(() => {
        void hydrate()
    }, [])

    useEffect(() => {
        if (!hydratedRef.current) return
        void AsyncStorage.setItem(NOTES_CACHE_KEY, JSON.stringify(notes))
    }, [notes])

    useEffect(() => {
        if (!configured || !notes.some(note => note.syncState === 'pending' && hasText(note))) return
        const timeout = setTimeout(() => {
            void syncPendingNotes()
        }, 1200)

        return () => clearTimeout(timeout)
    }, [configured, notes, settings.apiBaseUrl, settings.authToken, settings.userId])

    useEffect(() => {
        if (!selected) {
            setDraft(emptyDraft)
            return
        }

        setDraft({ title: selected.title, content: selected.content })
    }, [selectedId])

    async function hydrate() {
        const local = await loadLocalNotes()
        let next = local

        if (configured) {
            try {
                const remote = (await fetchNotes(settings)).map(fromRemote)
                const pendingLocal = local.filter(note => note.syncState === 'pending')
                const remoteIds = new Set(remote.map(note => note.id))
                next = sortNotes([...remote, ...pendingLocal.filter(note => !remoteIds.has(note.id))])
            } catch {
                next = local
            }
        }

        hydratedRef.current = true
        setNotes(next)
        setSelectedId(next[0]?.id || '')
    }

    async function loadLocalNotes() {
        try {
            const raw = await AsyncStorage.getItem(NOTES_CACHE_KEY)
            const parsed = raw ? JSON.parse(raw) as unknown : []
            return sortNotes(Array.isArray(parsed) ? parsed.map(normalizeLocalNote).filter(Boolean) as LocalNote[] : [])
        } catch {
            return []
        }
    }

    function updateDraft(nextDraft: typeof emptyDraft) {
        setDraft(nextDraft)
        setNotes(current => {
            const timestamp = nowIso()
            const base = current.find(note => note.id === selectedId) || createLocalNote()
            const nextNote: LocalNote = {
                ...base,
                ...nextDraft,
                updated_at: timestamp,
                syncState: 'pending',
                localUpdatedAt: Date.now(),
            }
            const nextNotes = sortNotes([nextNote, ...current.filter(note => note.id !== nextNote.id)])
            if (!selectedId || selectedId !== nextNote.id) {
                setSelectedId(nextNote.id)
            }
            return nextNotes
        })
    }

    function openNote(note: LocalNote) {
        setSelectedId(note.id)
        setMenuOpen(false)
    }

    function startFreshNote() {
        setSelectedId('')
        setDraft(emptyDraft)
        setMenuOpen(false)
    }

    async function syncPendingNotes() {
        if (syncingRef.current) return
        syncingRef.current = true

        try {
            const pending = notes.filter(note => note.syncState === 'pending' && hasText(note))
            for (const note of pending) {
                try {
                    const payload = { title: note.title, content: note.content }
                    const saved = note.id.startsWith('local-')
                        ? await createNote(settings, payload)
                        : await updateNote(settings, note.id, payload)
                    const synced = fromRemote(saved)
                    setNotes(current => sortNotes([synced, ...current.filter(item => item.id !== note.id && item.id !== saved.id)]))
                    if (selectedId === note.id) {
                        setSelectedId(saved.id)
                    }
                } catch {
                    break
                }
            }
        } finally {
            syncingRef.current = false
        }
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
                    <Menu color={theme.textMuted} size={22} strokeWidth={2.1} />
                </Pressable>
            )}
        >
            <View style={styles.editor}>
                <TextInput
                    value={draft.title}
                    onChangeText={(title) => updateDraft({ ...draft, title })}
                    placeholder='Title'
                    placeholderTextColor={theme.textSoft}
                    style={styles.titleInput}
                    returnKeyType='next'
                />
                <View style={styles.divider} />
                <TextInput
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
                <View style={styles.modalBackdrop}>
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
