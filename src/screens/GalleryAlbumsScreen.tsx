import { useEffect, useRef, useState } from 'react'
import { Alert, Image, Pressable, Share, Text, TextInput, View, type ImageResizeMode, type ImageStyle, type StyleProp } from 'react-native'
import type { AppSettings } from '../types'
import { GlassCard, InlineNotice, PillButton, Screen } from '../components/ui'
import { useAppTheme } from '../theme/context'
import { loadGalleryPage, workspaceAccountKey, type GalleryFile } from '../lib/workspace-data'
import { addAlbumPhotos, canRemoveAlbumPhoto, changeAlbumMember, createGalleryAlbum, deleteGalleryAlbum, listManagedAlbums, loadAlbumDetail, removeAlbumMember, removeAlbumPhoto, updateGalleryAlbum, loadGalleryAlbumImage, type AlbumDetail, type AlbumMember, type ManagedAlbum } from '../lib/gallery-albums'

type Props = { settings: AppSettings, onClose: () => void, onOpenAlbum: (id: string) => void }
export function GalleryAlbumsScreen(props: Props) {
    return <Albums key={useGalleryAccountKey(props.settings)} {...props} />
}
function Albums({ settings, onClose, onOpenAlbum }: Props) {
    const theme = useAppTheme()
    const [albums, setAlbums] = useState<ManagedAlbum[]>([])
    const [album, setAlbum] = useState<AlbumDetail | null>(null)
    const [title, setTitle] = useState('')
    const [memberId, setMemberId] = useState('')
    const [role, setRole] = useState<AlbumMember['role']>('viewer')
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [busy, setBusy] = useState(false)
    const [loading, setLoading] = useState(false)
    const [listing, setListing] = useState(true)
    const [picker, setPicker] = useState(false)
    const [library, setLibrary] = useState<GalleryFile[]>([])
    const [selected, setSelected] = useState<string[]>([])
    const [moreLibrary, setMoreLibrary] = useState(false)
    const alive = useRef(true)
    const operation = useRef(false)
    const sequence = useRef(0)
    const listSequence = useRef(0)
    const libraryOffset = useRef(0)
    const abort = useRef<AbortController | null>(null)
    useEffect(() => {
        alive.current = true
        void reloadList()
        return () => { alive.current = false; sequence.current++; abort.current?.abort() }
    }, [])
    const input = { color: theme.text, backgroundColor: theme.surfaceStrong, borderRadius: 12, padding: 14, fontSize: 16 }
    const row = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, alignItems: 'center' as const }
    const text = { color: theme.textMuted, fontSize: 14, lineHeight: 21 }
    const canEdit = album?.role === 'owner'
    const canAdd = album?.role === 'owner' || album?.role === 'contributor'

    async function reloadList() {
        const version = ++listSequence.current
        setListing(true)
        const list = await listManagedAlbums(settings).catch(cause => {
            if (alive.current && version === listSequence.current) setError(message(cause))
            return null
        })
        if (alive.current && version === listSequence.current) {
            if (list) setAlbums(list)
            setListing(false)
        }
    }
    function reset() {
        sequence.current++; abort.current?.abort()
        setAlbum(null); setPicker(false); setSelected([]); setTitle(''); setMemberId(''); setError(''); setLoading(false)
    }
    async function open(id: string, more = false) {
        const version = ++sequence.current
        abort.current?.abort(); abort.current = new AbortController()
        setLoading(true); setError('')
        if (!more) { setAlbum(null); setPicker(false); setSelected([]); setMemberId('') }
        try {
            const result = await loadAlbumDetail(settings, id, more && album ? album.offset + album.items.length : 0, abort.current.signal)
            if (!alive.current || version !== sequence.current) return
            // Keep offset zero while accumulating pages; next offset is the loaded count.
            setAlbum(previous => more && previous?.id === id ? { ...result, offset: 0, items: [...previous.items, ...result.items.filter(item => !previous.items.some(old => old.id === item.id))] } : result)
            if (!more) setTitle(result.name)
        } catch (cause) { if (alive.current && version === sequence.current) setError(message(cause)) }
        finally { if (alive.current && version === sequence.current) setLoading(false) }
    }
    async function run(action: () => Promise<void>) {
        if (operation.current || !alive.current) return
        operation.current = true; setBusy(true); setError(''); setNotice('')
        try { await action() }
        catch (cause) { if (alive.current) setError(message(cause)) }
        finally { operation.current = false; if (alive.current) setBusy(false) }
    }
    function confirm(heading: string, body: string, action: () => Promise<void>, destructive = false) {
        Alert.alert(heading, body, [{ text: 'Cancel', style: 'cancel' }, { text: 'Confirm', style: destructive ? 'destructive' : 'default', onPress: () => { void run(action) } }])
    }
    async function refresh(detail: AlbumDetail) {
        if (!alive.current) return
        await open(detail.id)
        if (alive.current) await reloadList()
    }
    async function loadLibrary(more = false) {
        if (operation.current || loading) return
        const version = ++sequence.current
        setPicker(true); setLoading(true); setError('')
        if (!more) { setLibrary([]); setSelected([]); libraryOffset.current = 0 }
        try {
            const result = await loadGalleryPage(settings, { search: '', favorites: false, albumId: '' }, more ? libraryOffset.current : 0)
            if (!alive.current || version !== sequence.current) return
            setLibrary(previous => more ? [...previous, ...result.files.filter(file => !previous.some(old => old.id === file.id))] : result.files)
            libraryOffset.current = result.nextOffset; setMoreLibrary(result.hasMore)
        } catch (cause) { if (alive.current && version === sequence.current) setError(message(cause)) }
        finally { if (alive.current && version === sequence.current) setLoading(false) }
    }
    async function saveSharing(enable: boolean) {
        if (!album) return
        const result = await updateGalleryAlbum(settings, album, { isPublic: enable })
        if (!alive.current) return
        await refresh(album)
        if (!alive.current) return
        setNotice(enable ? 'Public link enabled. Anyone with this link can view the album.' : 'Public link disabled. The previous link no longer opens this album.')
        if (result.shareUrl) await Share.share({ message: result.shareUrl })
    }
    return <Screen title={album ? 'Album' : 'Albums'} subtitle='Organize your CDN library' right={<PillButton label='Done' small disabled={busy} onPress={onClose} />}>
        {!!error && <InlineNotice title='Album request failed' message={error} />}
        {!!notice && <InlineNotice title='Album updated' message={notice} />}
        {(loading || listing) && <Text style={text}>Loading…</Text>}
        {!album && <>
            <GlassCard><Text style={{ color: theme.text, fontSize: 20 }}>Create a private album</Text>
                <TextInput accessibilityLabel='New album name' placeholder='Album name' placeholderTextColor={theme.textSoft} maxLength={120} value={title} onChangeText={setTitle} style={input} editable={!busy} />
                <PillButton label='Create album' tone='accent' disabled={busy || loading || !title.trim()} onPress={() => { void run(async () => {
                    const created = await createGalleryAlbum(settings, title)
                    if (!alive.current) return
                    await reloadList(); if (alive.current) await open(created.id)
                }) }} />
            </GlassCard>
            <View style={row}><PillButton label='Refresh albums' disabled={busy || loading || listing} onPress={() => { void reloadList() }} /></View>
            {!albums.length && !loading && !listing && !error && <Text style={text}>No albums yet. Create one, then add photos already in your library.</Text>}
            {albums.map(item => <GlassCard key={item.id}>
                <Text style={{ color: theme.text, fontSize: 19 }}>{item.name}</Text>
                <Text style={text}>{item.photo_count || 0} photos · {item.member_role || (item.owner === settings.userId ? 'owner' : 'shared')} · {item.is_public ? 'Public link enabled' : 'Private'}</Text>
                <PillButton label={`Open ${item.name}`} disabled={busy || loading} onPress={() => { void open(item.id) }} />
            </GlassCard>)}
        </>}
        {album && <>
            <View style={row}><PillButton label='All albums' disabled={busy || loading} onPress={reset} /><PillButton label='View photos' disabled={busy || loading} onPress={() => onOpenAlbum(album.id)} /><PillButton label='Refresh album' disabled={busy || loading} onPress={() => { void open(album.id) }} /></View>
            <GlassCard>
                <Text style={{ color: theme.text, fontSize: 24 }}>{album.name}</Text>
                <Text style={text}>{album.total} items · {album.role} · {album.is_public ? 'Public link enabled' : 'Private'}</Text>
                {canEdit && <><TextInput accessibilityLabel='Album name' value={title} maxLength={120} onChangeText={setTitle} style={input} editable={!busy} />
                    <PillButton label='Save name' disabled={busy || loading || !title.trim() || title.trim() === album.name} onPress={() => { void run(async () => { await updateGalleryAlbum(settings, album, { name: title }); await refresh(album) }) }} />
                </>}
                {canAdd && <PillButton label='Add library photos' tone='accent' disabled={busy || loading} onPress={() => { void loadLibrary() }} />}
                {!canAdd && <Text style={text}>You can view this album. Only its owner and contributors can add photos.</Text>}
            </GlassCard>
            {picker ? <GlassCard>
                <Text style={{ color: theme.text, fontSize: 20 }}>Choose library photos</Text><Text style={text}>Select photos already uploaded to your account. Adding them does not upload device photos.</Text>
                <View style={row}><PillButton label='Cancel selection' disabled={busy || loading} onPress={() => { sequence.current++; setPicker(false); setSelected([]) }} /><PillButton label={`Add selected (${selected.length})`} tone='accent' disabled={busy || loading || !selected.length} onPress={() => { void run(async () => {
                    const result = await addAlbumPhotos(settings, album, selected)
                    if (!alive.current) return
                    setPicker(false); setSelected([]); await refresh(album)
                    if (alive.current) setNotice(`${result.added} of ${result.requested} selected photos added. Photos already in the album or unavailable to your account are skipped.`)
                }) }} /></View>
                {!library.length && !loading && <Text style={text}>No photos in your library.</Text>}
                <View style={row}>{library.map(file => <Pressable key={file.id} disabled={busy || loading} accessibilityRole='checkbox' accessibilityLabel={file.name || 'Library photo'} accessibilityState={{ checked: selected.includes(file.id), disabled: busy || loading }} onPress={() => setSelected(previous => previous.includes(file.id) ? previous.filter(id => id !== file.id) : previous.length < 500 ? [...previous, file.id] : previous)} style={{ width: '47%', padding: 6, borderRadius: 12, borderWidth: 2, borderColor: selected.includes(file.id) ? theme.accent : theme.surfaceBorder }}>
                    <GalleryAlbumImage settings={settings} fileId={file.id} style={{ width: '100%', height: 110, borderRadius: 8 }} /><Text numberOfLines={2} style={text}>{selected.includes(file.id) ? '✓ ' : ''}{file.name || 'Photo'}</Text>
                </Pressable>)}</View>
                {moreLibrary && <PillButton label='Load more library photos' disabled={busy || loading} onPress={() => { void loadLibrary(true) }} />}
            </GlassCard> : <GlassCard>
                <Text style={{ color: theme.text, fontSize: 20 }}>Album contents</Text>
                {!album.items.length && <Text style={text}>This album is empty.</Text>}
                {album.items.map(photo => <View key={photo.id} style={{ gap: 8, paddingVertical: 8 }}><View style={row}>
                    {photo.type.startsWith('image/') && <GalleryAlbumImage settings={settings} fileId={photo.id} style={{ width: 60, height: 60, borderRadius: 8 }} />}
                    <Text style={[text, { flex: 1 }]}>{photo.name || 'Untitled item'}</Text>
                </View>{canRemoveAlbumPhoto(settings, album, photo) && <PillButton label={`Remove ${photo.name || 'item'} from album`} small disabled={busy || loading} onPress={() => confirm('Remove from album?', 'The original file stays in its owner’s library.', async () => { await removeAlbumPhoto(settings, album, photo); await refresh(album) }, true)} />}</View>)}
                {album.items.length < album.total && <PillButton label='Load more album items' disabled={busy || loading} onPress={() => { void open(album.id, true) }} />}
            </GlassCard>}
            {canEdit && <GlassCard>
                <Text style={{ color: theme.text, fontSize: 20 }}>Sharing & access</Text>
                <Text style={text}>{album.is_public ? 'Anyone with the public link can view this album.' : 'Only you and invited accounts can view this album.'}</Text>
                <View style={row}><PillButton label={album.is_public ? 'Share public link' : 'Enable public link'} disabled={busy || loading} onPress={() => confirm('Share album publicly?', 'Anyone with the link can view all items in this album. You can disable the link later.', () => saveSharing(true))} />
                    {album.is_public && <PillButton label='Disable public link' disabled={busy || loading} onPress={() => confirm('Disable public link?', 'The existing public link will stop working. Invited accounts keep their access.', () => saveSharing(false))} />}</View>
                <TextInput accessibilityLabel='Invite Hanasand account ID' placeholder='Hanasand account ID' placeholderTextColor={theme.textSoft} autoCapitalize='none' autoCorrect={false} value={memberId} onChangeText={setMemberId} maxLength={80} editable={!busy} style={input} />
                <View style={row}>{(['viewer', 'contributor'] as const).map(value => <PillButton key={value} label={`${role === value ? '✓ ' : ''}${value === 'viewer' ? 'View only' : 'Can add photos'}`} disabled={busy || loading} onPress={() => setRole(value)} />)}</View>
                <PillButton label='Grant account access' disabled={busy || loading || !memberId.trim()} onPress={() => confirm('Grant album access?', `Account ${memberId.trim()} will ${role === 'viewer' ? 'view this album' : 'view and add photos to this album'}. This also updates access for an existing member.`, async () => { await changeAlbumMember(settings, album, memberId, role); await refresh(album) })} />
                {(album.members || []).map(member => <View key={member.user_id} style={{ gap: 6 }}><Text style={text}>{member.user_id} · {member.role}</Text><PillButton label={`Remove access for ${member.user_id}`} small disabled={busy || loading} onPress={() => confirm('Remove account access?', `${member.user_id} will lose invited access. A public link, if enabled, still permits viewing.`, async () => { await removeAlbumMember(settings, album, member.user_id); await refresh(album) }, true)} /></View>)}
                <PillButton label='Delete album' tone='danger' disabled={busy || loading} onPress={() => confirm('Delete album?', `Delete “${album.name}” and its sharing access? Uploaded files stay in their owners’ libraries.`, async () => { await deleteGalleryAlbum(settings, album); if (alive.current) { reset(); await reloadList(); if (alive.current) setNotice('Album deleted. Original files remain in the library.') } }, true)} />
            </GlassCard>}
            {!canEdit && <PillButton label='Leave shared album' tone='danger' disabled={busy || loading} onPress={() => confirm('Leave album?', 'You will lose invited access. The owner can invite you again.', async () => { await removeAlbumMember(settings, album, settings.userId); if (alive.current) { reset(); await reloadList() } }, true)} />}
        </>}
    </Screen>
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : 'Unable to load albums. Please retry.' }

type GalleryImageProps = { settings: AppSettings, fileId: string, thumbnail?: boolean, style?: StyleProp<ImageStyle>, resizeMode?: ImageResizeMode, onError?: (message: string) => void }
export function GalleryAlbumImage(props: GalleryImageProps) {
    return <PrivateImage key={`${useGalleryAccountKey(props.settings)}/${props.fileId}/${props.thumbnail !== false}`} {...props} />
}
function PrivateImage({ settings, fileId, thumbnail = true, style, resizeMode = 'cover', onError }: GalleryImageProps) {
    const theme = useAppTheme()
    const [uri, setUri] = useState('')
    const [failed, setFailed] = useState(false)
    const [attempt, setAttempt] = useState(0)
    const reportError = useRef(onError)
    reportError.current = onError
    useEffect(() => {
        const controller = new AbortController()
        setFailed(false); setUri('')
        void loadGalleryAlbumImage(settings, fileId, thumbnail, controller.signal).then(value => {
            if (!controller.signal.aborted) setUri(value)
        }).catch(cause => {
            if (!controller.signal.aborted) { setFailed(true); reportError.current?.(message(cause)) }
        })
        return () => controller.abort()
    }, [settings, fileId, thumbnail, attempt])
    return uri ? <Image source={{ uri }} style={style} resizeMode={resizeMode} accessibilityLabel='Album photo' onError={() => { setUri(''); setFailed(true); reportError.current?.('This photo could not be displayed on this device.') }} />
        : <Pressable disabled={!failed} accessibilityRole='button' accessibilityLabel={failed ? 'Photo unavailable. Retry loading photo' : 'Loading photo'} onPress={() => setAttempt(value => value + 1)} style={[style, { backgroundColor: theme.surfaceStrong, alignItems: 'center', justifyContent: 'center' }]}><Text style={{ color: theme.textMuted, fontSize: 11 }}>{failed ? 'Photo unavailable · Retry' : 'Loading…'}</Text></Pressable>
}

function useGalleryAccountKey(settings: AppSettings) {
    const account = `${workspaceAccountKey(settings)}/${settings.cdnBaseUrl}`
    const current = useRef({ account, token: settings.authToken, revision: 0 })
    if (current.current.account !== account || current.current.token !== settings.authToken) {
        current.current = { account, token: settings.authToken, revision: current.current.revision + 1 }
    }
    // Session changes remount and discard old pixels without exposing a token in
    // React element keys, URLs, logs, or a persistent cache.
    return `${account}/${current.current.revision}`
}
