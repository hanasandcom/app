import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Animated, Dimensions, FlatList, Image, Linking, Modal, PanResponder, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { File as LocalFile } from 'expo-file-system'
import * as MediaLibrary from 'expo-media-library'
import type { ImageReviewAsset, SwipeDecision } from '../types'
import type { AppSettings } from '../types'
import { favoriteGalleryFile, loadGalleryAlbums, loadGalleryPage, uploadGalleryPhoto, workspaceAccountKey, type GalleryAlbum, type GalleryFile, type GalleryFilter } from '../lib/workspace-data'
import { GalleryAlbumImage, GalleryAlbumsScreen } from './GalleryAlbumsScreen'
import { GlassCard, InlineNotice, PillButton, Screen, SectionTitle } from '../components/ui'
import { spacing } from '../theme/tokens'
import { useAppTheme } from '../theme/context'

const CARD_WIDTH = Dimensions.get('window').width - 48
const SWIPE_THRESHOLD = 110

export function ImagesScreen({ settings }: { settings: AppSettings }) {
    return <CloudLibrary key={`${workspaceAccountKey(settings)}/${settings.cdnBaseUrl}`} settings={settings} />
}

function CloudLibrary({ settings }: { settings: AppSettings }) {
    const theme = useAppTheme()
    const [device, setDevice] = useState(false)
    const [uploadOpen, setUploadOpen] = useState(false)
    const [albumsOpen, setAlbumsOpen] = useState(false)
    const [files, setFiles] = useState<GalleryFile[]>([])
    const [albums, setAlbums] = useState<GalleryAlbum[]>([])
    const [filter, setFilter] = useState<GalleryFilter>({ search: '', favorites: false, albumId: '' })
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [albumError, setAlbumError] = useState('')
    const [hasMore, setHasMore] = useState(false)
    const [favoriteBusy, setFavoriteBusy] = useState('')
    const [preview, setPreview] = useState<GalleryFile | null>(null)
    const sequence = useRef(0)
    const offset = useRef(0)
    useEffect(() => () => { sequence.current += 1 }, [])
    useEffect(() => {
        const timer = setTimeout(() => { void load(false) }, 250)
        return () => { clearTimeout(timer); sequence.current += 1 }
    }, [filter, settings.authToken])
    useEffect(() => { void loadAlbums() }, [settings.authToken])

    async function loadAlbums() {
        setAlbumError('')
        try { setAlbums(await loadGalleryAlbums(settings)) }
        catch (cause) { setAlbumError(cause instanceof Error ? cause.message : 'Unable to load albums.') }
    }
    async function load(more: boolean) {
        const request = ++sequence.current
        setLoading(true)
        setError('')
        try {
            const page = await loadGalleryPage(settings, filter, more ? offset.current : 0)
            if (request !== sequence.current) return
            setFiles(current => more ? [...current, ...page.files.filter(file => !current.some(item => item.id === file.id))] : page.files)
            offset.current = page.nextOffset
            setHasMore(page.hasMore)
        } catch (cause) {
            if (request === sequence.current) setError(cause instanceof Error ? cause.message : 'Unable to load images.')
        } finally { if (request === sequence.current) setLoading(false) }
    }
    async function toggleFavorite(file: GalleryFile) {
        if (favoriteBusy) return
        setFavoriteBusy(file.id)
        try {
            await favoriteGalleryFile(settings, file.id, !file.is_favorite)
            setFiles(current => current.map(item => item.id === file.id ? { ...item, is_favorite: !file.is_favorite } : item).filter(item => !filter.favorites || item.is_favorite))
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to update favorite.') }
        finally { setFavoriteBusy('') }
    }
    function changeFilter(next: GalleryFilter) {
        sequence.current += 1
        setFiles([])
        offset.current = 0
        setHasMore(false)
        setFilter(next)
    }
    if (device) return <DevicePhotoReview onBack={() => setDevice(false)} />
    if (albumsOpen) return <GalleryAlbumsScreen settings={settings} onClose={() => {
        setAlbumsOpen(false)
        changeFilter({ search: '', favorites: false, albumId: '' })
        void loadAlbums()
    }} onOpenAlbum={albumId => {
        setAlbumsOpen(false)
        changeFilter({ search: '', favorites: false, albumId })
        void loadAlbums()
    }} />
    return <Screen title='Images' subtitle='Your Hanasand library' scroll={false} contentStyle={{ paddingHorizontal: 0, paddingBottom: 0, gap: 0 }}>
        <FlatList data={files} keyExtractor={file => file.id} numColumns={2} style={{ flex: 1 }}
            initialNumToRender={6} maxToRenderPerBatch={6} windowSize={5}
            contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 168, gap: spacing.md }}
            columnWrapperStyle={{ gap: 10 }}
            ListHeaderComponent={<View style={{ gap: spacing.md }}>
                <GlassCard>
                    <View style={{ gap: spacing.sm }}>
                        <TextInput accessibilityLabel='Search images' autoCorrect={false} autoCapitalize='none' placeholder='Search images or places' placeholderTextColor={theme.textSoft} value={filter.search} onChangeText={search => changeFilter({ ...filter, search })} style={{ color: theme.text, padding: 12, borderRadius: 12, backgroundColor: theme.ambientNeutral }} />
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
                            <PillButton label='Upload photos' tone='accent' small onPress={() => setUploadOpen(true)} />
                            <PillButton label='Manage albums' small onPress={() => setAlbumsOpen(true)} />
                            <PillButton label='Library' tone={!filter.favorites && !filter.albumId ? 'accent' : 'default'} small onPress={() => changeFilter({ ...filter, favorites: false, albumId: '' })} />
                            <PillButton label='Favorites' tone={filter.favorites ? 'accent' : 'default'} small onPress={() => changeFilter({ ...filter, favorites: true, albumId: '' })} />
                            <PillButton label={loading ? 'Loading…' : 'Refresh'} small disabled={loading} onPress={() => void load(false)} />
                            <PillButton label='Review device photos' small onPress={() => setDevice(true)} />
                        </ScrollView>
                        {!!albums.length && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>{albums.map(album => <PillButton key={album.id} label={`${album.name} (${album.photo_count})`} small tone={filter.albumId === album.id ? 'accent' : 'default'} onPress={() => changeFilter({ ...filter, albumId: album.id, favorites: false })} />)}</ScrollView>}
                        {!!albumError && <><InlineNotice message={`Albums: ${albumError}`} /><PillButton label='Retry albums' small onPress={() => void loadAlbums()} /></>}
                        <Text style={{ color: theme.textMuted, fontSize: 12 }}>{files.length} images{hasMore ? ' loaded' : ''}</Text>
                    </View>
                </GlassCard>
                {!!error && <GlassCard><InlineNotice message={error} /><PillButton label='Retry images' small onPress={() => void load(false)} /></GlassCard>}
            </View>}
            renderItem={({ item: file }) => <View style={{ flex: 1, maxWidth: '48.5%', gap: 5 }}>
                <Pressable accessibilityRole='button' accessibilityLabel={`View ${file.name}`} onPress={() => setPreview(file)}><GalleryAlbumImage settings={settings} fileId={file.id} style={{ width: '100%', aspectRatio: 1, borderRadius: 16, backgroundColor: theme.ambientNeutral }} /></Pressable>
                <Text numberOfLines={1} style={{ color: theme.text, fontSize: 12 }}>{file.name}</Text>
                <PillButton label={file.is_favorite ? '♥ Favorite' : '♡ Favorite'} small disabled={!!favoriteBusy} onPress={() => void toggleFavorite(file)} />
            </View>}
            ListEmptyComponent={!loading && !error ? <GlassCard><SectionTitle eyebrow='Library' title='No images found' body={filter.search || filter.favorites || filter.albumId ? 'Try another search or library.' : 'Images in your CDN account appear here.'} /></GlassCard> : null}
            ListFooterComponent={hasMore ? <PillButton label={loading ? 'Loading…' : 'Load more'} disabled={loading} onPress={() => void load(true)} /> : null}
        />
        {uploadOpen && <PhotoUploadPicker settings={settings} onClose={() => setUploadOpen(false)} onUploaded={() => {
            changeFilter({ search: '', favorites: false, albumId: '' })
            void loadAlbums()
        }} />}
        <Modal visible={!!preview} animationType='fade' onRequestClose={() => setPreview(null)}>
            <View style={{ flex: 1, backgroundColor: theme.backgroundRaised, padding: 24, paddingTop: 64, gap: 16 }}>
                <PillButton label='Close image' onPress={() => setPreview(null)} />
                {preview && <><Text style={{ color: theme.text }}>{preview.name}</Text><GalleryAlbumImage settings={settings} fileId={preview.id} thumbnail={false} resizeMode='contain' style={{ flex: 1 }} /></>}
            </View>
        </Modal>
    </Screen>
}

function PhotoUploadPicker({ settings, onClose, onUploaded }: { settings: AppSettings, onClose: () => void, onUploaded: () => void }) {
    const theme = useAppTheme()
    const [permission, requestPermission] = MediaLibrary.usePermissions()
    const [photos, setPhotos] = useState<MediaLibrary.Asset[]>([])
    const [selected, setSelected] = useState(new Set<string>())
    const [loading, setLoading] = useState(false)
    const [busy, setBusy] = useState(false)
    const [stopping, setStopping] = useState(false)
    const [error, setError] = useState('')
    const [progress, setProgress] = useState('')
    const [uploadedCount, setUploadedCount] = useState(0)
    const [hasMore, setHasMore] = useState(false)
    const cursor = useRef<string | undefined>(undefined)
    const active = useRef(true)
    const loadingRef = useRef(false)
    const uploading = useRef(false)
    const stopRequested = useRef(false)
    useEffect(() => () => { active.current = false; stopRequested.current = true }, [])
    useEffect(() => { if (permission?.granted) void loadPhotos(false) }, [permission?.granted])

    async function loadPhotos(more: boolean) {
        if (loadingRef.current || uploading.current) return
        loadingRef.current = true
        setLoading(true)
        setError('')
        if (!more) setSelected(new Set())
        try {
            const result = await MediaLibrary.getAssetsAsync({ mediaType: 'photo', first: 60, sortBy: ['creationTime'], ...(more && cursor.current ? { after: cursor.current } : {}) })
            if (!active.current) return
            setPhotos(current => more ? [...current, ...result.assets.filter(photo => !current.some(item => item.id === photo.id))] : result.assets)
            cursor.current = result.endCursor
            setHasMore(result.hasNextPage)
        } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : 'Unable to load device photos.') }
        finally { loadingRef.current = false; if (active.current) setLoading(false) }
    }
    function togglePhoto(id: string) {
        if (uploading.current) return
        setSelected(current => {
            const next = new Set(current)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }
    async function uploadSelected() {
        if (uploading.current || !selected.size) return
        uploading.current = true
        stopRequested.current = false
        setBusy(true)
        setStopping(false)
        setError('')
        const chosen = photos.filter(photo => selected.has(photo.id))
        let completed = 0
        try {
            for (const [index, photo] of chosen.entries()) {
                if (!active.current || stopRequested.current) break
                setProgress(`Uploading ${index + 1} of ${chosen.length} · ${photo.filename}`)
                // Resolve only explicitly selected assets after the Upload action.
                const info = await MediaLibrary.getAssetInfoAsync(photo.id, { shouldDownloadFromNetwork: true })
                if (!active.current || stopRequested.current) break
                const uri = info.localUri || info.uri
                const file = new LocalFile(uri)
                if (!file.exists) throw new Error('This photo is not available on the device.')
                await uploadGalleryPhoto(settings, { uri, name: info.filename, type: file.type, size: file.size })
                completed++
                if (!active.current) break
                setUploadedCount(current => current + 1)
                setSelected(current => { const next = new Set(current); next.delete(photo.id); return next })
                // The standard CDN endpoint admits one upload per second per account.
                if (index < chosen.length - 1 && !stopRequested.current) await new Promise(resolve => setTimeout(resolve, 1100))
            }
        } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : 'Unable to upload this photo. Retry the remaining selection.') }
        finally {
            uploading.current = false
            if (active.current) {
                setBusy(false)
                setProgress('')
                if (completed) onUploaded()
            }
        }
    }
    const buttonStyle = { color: theme.text, fontSize: 12 } as const
    return <Modal visible animationType='slide' onRequestClose={() => { if (!uploading.current) onClose() }}>
        <View style={{ flex: 1, backgroundColor: theme.backgroundRaised, padding: 20, paddingTop: 64, gap: spacing.md }}>
            <Text style={{ color: theme.text, fontSize: 24, fontWeight: '700' }}>Upload photos</Text>
            <Text style={{ color: theme.textMuted }}>Select the photos to add to your Hanasand library.</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                <PillButton label={uploadedCount ? 'View library' : 'Cancel'} disabled={busy} small onPress={onClose} />
                {permission?.granted && <PillButton label={busy ? 'Uploading…' : `Upload ${selected.size} photo${selected.size === 1 ? '' : 's'}`} tone='accent' disabled={busy || !selected.size || loading} small onPress={() => void uploadSelected()} />}
                {busy && <PillButton label={stopping ? 'Stopping…' : 'Stop after current'} disabled={stopping} small onPress={() => { stopRequested.current = true; setStopping(true) }} />}
            </View>
            {!!uploadedCount && <Text style={buttonStyle}>{uploadedCount} photo{uploadedCount === 1 ? '' : 's'} added to your library.</Text>}
            {!!progress && <Text accessibilityLiveRegion='polite' style={{ color: theme.textMuted }}>{progress}</Text>}
            {!!error && <InlineNotice message={error} />}
            {!permission?.granted ? <View style={{ gap: spacing.sm }}>
                <PillButton label={permission?.canAskAgain === false ? 'Open photo settings' : 'Choose photo access'} tone='accent' onPress={() => {
                    const action = permission?.canAskAgain === false ? Linking.openSettings() : requestPermission()
                    void action.catch(() => setError('Unable to request photo access. Check this app’s photo permissions in Settings.'))
                }} />
                <Text style={{ color: theme.textMuted }}>Photo access is needed to select photos from this device.</Text>
            </View> : <>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                    <PillButton label={loading ? 'Loading…' : 'Refresh device photos'} disabled={loading || busy} small onPress={() => void loadPhotos(false)} />
                    {permission.accessPrivileges === 'limited' && <PillButton label='Choose more photos' disabled={loading || busy} small onPress={() => { void MediaLibrary.presentPermissionsPickerAsync().then(() => loadPhotos(false)).catch(() => setError('Unable to change photo access.')) }} />}
                </View>
                <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                    {photos.map(photo => <Pressable key={photo.id} accessibilityRole='checkbox' accessibilityLabel={`Select ${photo.filename}`} accessibilityState={{ checked: selected.has(photo.id), disabled: busy }} disabled={busy} onPress={() => togglePhoto(photo.id)} style={{ width: '30%', gap: 4 }}>
                        <Image source={{ uri: photo.uri }} style={{ width: '100%', aspectRatio: 1, borderRadius: 12, borderWidth: selected.has(photo.id) ? 3 : 0, borderColor: theme.surfaceBorder, backgroundColor: theme.ambientNeutral }} />
                        <Text numberOfLines={1} style={buttonStyle}>{selected.has(photo.id) ? '✓ ' : ''}{photo.filename}</Text>
                    </Pressable>)}
                    {!photos.length && !loading && <Text style={{ color: theme.textMuted }}>No photos available. Check the selected photo access or refresh.</Text>}
                    {hasMore && <PillButton label={loading ? 'Loading…' : 'Load more photos'} disabled={loading || busy} small onPress={() => void loadPhotos(true)} />}
                </ScrollView>
            </>}
        </View>
    </Modal>
}

function DevicePhotoReview({ onBack }: { onBack: () => void }) {
    const theme = useAppTheme()
    const [permissionResponse, requestPermission] = MediaLibrary.usePermissions()
    const [assets, setAssets] = useState<ImageReviewAsset[]>([])
    const [index, setIndex] = useState(0)
    const [decisions, setDecisions] = useState<Record<string, SwipeDecision>>({})
    const [history, setHistory] = useState<string[]>([])
    const [busy, setBusy] = useState(false)
    const [loadError, setLoadError] = useState('')
    const translate = useRef(new Animated.ValueXY()).current
    const loadSequenceRef = useRef(0)

    useEffect(() => {
        void loadAssets()
    }, [permissionResponse?.granted])

    async function loadAssets() {
        const requestId = loadSequenceRef.current + 1
        loadSequenceRef.current = requestId
        if (!permissionResponse?.granted) return
        setBusy(true)
        setLoadError('')
        try {
            const media = await MediaLibrary.getAssetsAsync({ mediaType: 'photo', first: 40, sortBy: ['creationTime'] })
            if (loadSequenceRef.current !== requestId) return
            setAssets(media.assets.map(asset => ({
                id: asset.id,
                uri: asset.uri,
                filename: asset.filename,
                width: asset.width,
                height: asset.height,
                creationTime: asset.creationTime,
            })))
            setIndex(0)
            setHistory([])
            setDecisions({})
        } catch (cause) {
            if (loadSequenceRef.current !== requestId) return
            setLoadError(cause instanceof Error ? cause.message : 'Unable to load photo library.')
        } finally {
            if (loadSequenceRef.current === requestId) {
                setBusy(false)
            }
        }
    }

    function registerDecision(decision: SwipeDecision) {
        const current = assets[index]
        if (!current) return
        setDecisions(previous => ({ ...previous, [current.id]: decision }))
        setHistory(previous => [...previous, current.id])
        Animated.timing(translate, { toValue: { x: decision === 'keep' ? 420 : -420, y: 0 }, duration: 180, useNativeDriver: false }).start(() => {
            translate.setValue({ x: 0, y: 0 })
            setIndex(currentIndex => currentIndex + 1)
        })
    }

    function undoLast() {
        const previousId = history[history.length - 1]
        if (!previousId) {
            Alert.alert('Nothing to undo', 'No image decisions have been made yet.')
            return
        }
        setHistory(current => current.slice(0, -1))
        setDecisions(current => {
            const next = { ...current }
            delete next[previousId]
            return next
        })
        setIndex(current => Math.max(current - 1, 0))
        translate.setValue({ x: 0, y: 0 })
    }

    async function deleteDeferred() {
        if (busy) return
        const ids = Object.entries(decisions).filter(([, decision]) => decision === 'discard').map(([id]) => id)
        if (!ids.length) {
            Alert.alert('Nothing to delete', 'You have not marked any images for deletion yet.')
            return
        }
        Alert.alert('Delete marked images?', `${ids.length} images will be removed from the photo library.`, [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete',
                style: 'destructive',
                onPress: () => {
                    void (async () => {
                        setBusy(true)
                        try {
                            await MediaLibrary.deleteAssetsAsync(ids)
                            Alert.alert('Deleted', `${ids.length} images were deleted.`)
                            setIndex(0)
                            setHistory([])
                            setDecisions({})
                            setAssets(current => current.filter(asset => !ids.includes(asset.id)))
                        } catch (cause) {
                            Alert.alert('Delete failed', cause instanceof Error ? cause.message : 'Unable to delete marked images.')
                        } finally {
                            setBusy(false)
                        }
                    })()
                },
            },
        ])
    }

    const current = assets[index]
    const remaining = Math.max(assets.length - index, 0)
    const discardCount = useMemo(() => Object.values(decisions).filter(value => value === 'discard').length, [decisions])

    const panResponder = useMemo(
        () => PanResponder.create({
            onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 12,
            onPanResponderMove: (_, gesture) => translate.setValue({ x: gesture.dx, y: gesture.dy * 0.2 }),
            onPanResponderRelease: (_, gesture) => {
                if (gesture.dx > SWIPE_THRESHOLD) {
                    registerDecision('keep')
                    return
                }
                if (gesture.dx < -SWIPE_THRESHOLD) {
                    registerDecision('discard')
                    return
                }
                Animated.spring(translate, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start()
            },
        }),
        [assets, index, translate],
    )

    if (!permissionResponse?.granted) {
        return (
            <Screen title='Images' subtitle=''>
                <GlassCard>
                    <SectionTitle eyebrow='Permission required' title='Photo access needed' />
                    <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                        <PillButton label='Hanasand library' onPress={onBack} small />
                        <PillButton label='Allow photo library access' onPress={() => void requestPermission()} tone='accent' />
                    </View>
                </GlassCard>
            </Screen>
        )
    }

    return (
        <Screen title='Images' subtitle=''>
            <GlassCard>
                <SectionTitle eyebrow='Review' title={current ? `${remaining} left` : 'Complete'} />
                <InlineNotice message={loadError} />
                <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginTop: spacing.md }}>
                    <PillButton label='Hanasand library' onPress={onBack} small />
                    <PillButton label='Undo last' onPress={undoLast} small disabled={busy || !history.length} />
                    <PillButton label={busy ? 'Working...' : `Delete marked (${discardCount})`} onPress={() => void deleteDeferred()} tone='danger' small disabled={busy || !discardCount} />
                </View>
            </GlassCard>

            {current ? (
                <Animated.View
                    {...panResponder.panHandlers}
                    style={{
                        width: CARD_WIDTH,
                        alignSelf: 'center',
                        transform: [
                            { translateX: translate.x },
                            { translateY: translate.y },
                            { rotate: translate.x.interpolate({ inputRange: [-220, 0, 220], outputRange: ['-10deg', '0deg', '10deg'] }) },
                        ],
                    }}
                >
                    <GlassCard>
                        <Image source={{ uri: current.uri }} style={{ width: '100%', height: 420, borderRadius: 24, backgroundColor: theme.ambientNeutral }} resizeMode='cover' />
                        <View style={{ gap: 6, marginTop: spacing.md }}>
                            <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>{current.filename || 'Unnamed image'}</Text>
                            <Text style={{ color: theme.textMuted }}>{current.width}×{current.height}</Text>
                        </View>
                        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                            <PillButton label='Keep' onPress={() => registerDecision('keep')} tone='accent' disabled={busy} />
                            <PillButton label='Discard later' onPress={() => registerDecision('discard')} tone='danger' disabled={busy} />
                        </View>
                    </GlassCard>
                </Animated.View>
            ) : (
                <GlassCard>
                    <SectionTitle eyebrow='Done' title='Batch sorted' />
                    <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginTop: spacing.md }}>
                        <PillButton label={busy ? 'Loading...' : 'Reload library'} onPress={() => void loadAssets()} tone='accent' disabled={busy} />
                        <PillButton label={busy ? 'Working...' : `Delete marked (${discardCount})`} onPress={() => void deleteDeferred()} tone='danger' disabled={busy || !discardCount} />
                    </View>
                </GlassCard>
            )}
        </Screen>
    )
}
