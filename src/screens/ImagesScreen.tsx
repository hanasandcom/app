import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Animated, Dimensions, Image, Modal, PanResponder, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import * as MediaLibrary from 'expo-media-library'
import type { ImageReviewAsset, SwipeDecision } from '../types'
import type { AppSettings } from '../types'
import { favoriteGalleryFile, galleryImageUrl, loadGalleryAlbums, loadGalleryPage, workspaceAccountKey, type GalleryAlbum, type GalleryFile, type GalleryFilter } from '../lib/workspace-data'
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
    return <Screen title='Images' subtitle='Your Hanasand library'>
        <GlassCard>
            <View style={{ gap: spacing.sm }}>
                <TextInput accessibilityLabel='Search images' placeholder='Search images or places' placeholderTextColor={theme.textSoft} value={filter.search} onChangeText={search => changeFilter({ ...filter, search })} style={{ color: theme.text, padding: 12, borderRadius: 12, backgroundColor: theme.ambientNeutral }} />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                    <PillButton label='Library' tone={!filter.favorites && !filter.albumId ? 'accent' : 'default'} small onPress={() => changeFilter({ ...filter, favorites: false, albumId: '' })} />
                    <PillButton label='Favorites' tone={filter.favorites ? 'accent' : 'default'} small onPress={() => changeFilter({ ...filter, favorites: true, albumId: '' })} />
                    <PillButton label={loading ? 'Loading…' : 'Refresh'} small disabled={loading} onPress={() => void load(false)} />
                </View>
                {!!albums.length && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>{albums.map(album => <PillButton key={album.id} label={`${album.name} (${album.photo_count})`} small tone={filter.albumId === album.id ? 'accent' : 'default'} onPress={() => changeFilter({ ...filter, albumId: album.id, favorites: false })} />)}</ScrollView>}
                {!!albumError && <><InlineNotice message={`Albums: ${albumError}`} /><PillButton label='Retry albums' small onPress={() => void loadAlbums()} /></>}
                <PillButton label='Review device photos' small onPress={() => setDevice(true)} />
                <Text style={{ color: theme.textMuted, fontSize: 12 }}>{files.length} images{hasMore ? ' loaded' : ''}</Text>
            </View>
        </GlassCard>
        {!!error && <GlassCard><InlineNotice message={error} /><PillButton label='Retry images' small onPress={() => void load(false)} /></GlassCard>}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {files.map(file => <View key={file.id} style={{ width: '48%', gap: 5 }}>
                <Pressable accessibilityRole='button' accessibilityLabel={`View ${file.name}`} onPress={() => setPreview(file)}><Image source={{ uri: galleryImageUrl(settings, file.id, true) }} style={{ width: '100%', aspectRatio: 1, borderRadius: 16, backgroundColor: theme.ambientNeutral }} resizeMode='cover' /></Pressable>
                <Text numberOfLines={1} style={{ color: theme.text, fontSize: 12 }}>{file.name}</Text>
                <PillButton label={file.is_favorite ? '♥ Favorite' : '♡ Favorite'} small disabled={!!favoriteBusy} onPress={() => void toggleFavorite(file)} />
            </View>)}
        </View>
        {!files.length && !loading && !error && <GlassCard><SectionTitle eyebrow='Library' title='No images found' body={filter.search || filter.favorites || filter.albumId ? 'Try another search or library.' : 'Images in your CDN account appear here.'} /></GlassCard>}
        {hasMore && <PillButton label={loading ? 'Loading…' : 'Load more'} disabled={loading} onPress={() => void load(true)} />}
        <Modal visible={!!preview} animationType='fade' onRequestClose={() => setPreview(null)}>
            <View style={{ flex: 1, backgroundColor: theme.backgroundRaised, padding: 24, paddingTop: 64, gap: 16 }}>
                <PillButton label='Close image' onPress={() => setPreview(null)} />
                {preview && <><Text style={{ color: theme.text }}>{preview.name}</Text><Image source={{ uri: galleryImageUrl(settings, preview.id) }} resizeMode='contain' style={{ flex: 1 }} /></>}
            </View>
        </Modal>
    </Screen>
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
