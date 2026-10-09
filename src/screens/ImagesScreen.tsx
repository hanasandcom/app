import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Animated, Dimensions, Image, PanResponder, Text, View } from 'react-native'
import * as MediaLibrary from 'expo-media-library'
import type { ImageReviewAsset, SwipeDecision } from '../types'
import { GlassCard, InlineNotice, PillButton, Screen, SectionTitle } from '../components/ui'
import { spacing } from '../theme/tokens'
import { useAppTheme } from '../theme/context'

const CARD_WIDTH = Dimensions.get('window').width - 48
const SWIPE_THRESHOLD = 110

export function ImagesScreen() {
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
                    <View style={{ marginTop: spacing.md }}>
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
