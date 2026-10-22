import type { AppSettings } from '../types'
import { apiFetch } from './api'
import type { GalleryFile } from './workspace-data'

export type AlbumRole = 'owner' | 'viewer' | 'contributor'
export type AlbumMember = { user_id: string, role: 'viewer' | 'contributor' }
export type ManagedAlbum = { id: string, name: string, owner: string, is_public: boolean, photo_count?: number, member_role?: AlbumRole }
export type AlbumPhoto = GalleryFile & { added_by: string }
export type AlbumDetail = ManagedAlbum & { role: AlbumRole, items: AlbumPhoto[], total: number, limit: number, offset: number, members?: AlbumMember[] }

// Match workspace-data's working native CDN adapter: supplied session cookies,
// explicit same-origin Origin, and no shared native cookie jar.
async function fetchCdn(settings: AppSettings, path: string, init: RequestInit = {}) {
    if (!settings.userId || !settings.authToken) throw new Error('Sign in to manage albums.')
    if (settings.impersonatingUserId) throw new Error('Switch back to your own account to manage CDN albums.')
    const url = new URL(`${settings.cdnBaseUrl.replace(/\/+$/, '')}/${path}`)
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('A secure CDN connection is required.')
    const headers = new Headers({ 'Content-Type': 'application/json', Origin: url.origin,
        Cookie: `id=${encodeURIComponent(settings.userId)}; access_token=${encodeURIComponent(settings.authToken)}` })
    const response = await apiFetch(settings, url.toString(), { ...init, headers, credentials: 'omit' })
    return response
}
async function request(settings: AppSettings, path: string, init: RequestInit = {}) {
    const response = await fetchCdn(settings, path, init)
    const body = await response.json().catch(() => null)
    if (!response.ok) throw new Error(body?.error || `Album request failed (${response.status}). Refresh before retrying a change.`)
    if (!body || typeof body !== 'object') throw new Error('The album service returned an unexpected response. Refresh before retrying a change.')
    return body
}
const segment = (value: string) => {
    if (!value || value.length > 128) throw new Error('Choose a valid album or photo.')
    return encodeURIComponent(value)
}
const path = (album: Pick<ManagedAlbum, 'id'>) => `albums/${segment(album.id)}`
function owner(settings: AppSettings, album: AlbumDetail) {
    if (album.role !== 'owner' || album.owner !== settings.userId) throw new Error('Only the album owner can make this change.')
}
function name(value: string) {
    const result = value.trim()
    if (!result || result.length > 120 || /[\0\r\n]/.test(result)) throw new Error('Album names must be 1–120 characters on one line.')
    return result
}
function validAlbum(body: unknown): boolean {
    const album = body as ManagedAlbum | null
    return !!album && typeof album.id === 'string' && typeof album.name === 'string' && typeof album.owner === 'string' && typeof album.is_public === 'boolean'
}
export async function listManagedAlbums(settings: AppSettings, signal?: AbortSignal): Promise<ManagedAlbum[]> {
    const body = await request(settings, 'albums', { signal })
    if (!Array.isArray(body) || !body.every(validAlbum)) throw new Error('The album list returned an unexpected response.')
    return body
}
export async function loadAlbumDetail(settings: AppSettings, id: string, offset = 0, signal?: AbortSignal): Promise<AlbumDetail> {
    if (!Number.isInteger(offset) || offset < 0 || offset > 1000000) throw new Error('Invalid album page.')
    const body = await request(settings, `albums/${segment(id)}?limit=60&offset=${offset}`, { signal })
    if (!validAlbum(body) || body.id !== id || !['owner', 'contributor', 'viewer'].includes(body.role)
        || !Array.isArray(body.items) || !Number.isInteger(body.total) || body.total < 0
        || body.offset !== offset || body.limit !== 60
        || body.items.some((item: AlbumPhoto) => !item || typeof item.id !== 'string' || typeof item.type !== 'string' || typeof item.added_by !== 'string')) {
        throw new Error('The album returned an unexpected response.')
    }
    return body
}
export async function createGalleryAlbum(settings: AppSettings, title: string): Promise<ManagedAlbum> {
    const body = await request(settings, 'albums', { method: 'POST', body: JSON.stringify({ name: name(title) }) })
    if (!validAlbum(body) || body.owner !== settings.userId || body.is_public) throw new Error('Album creation could not be confirmed. Refresh before retrying.')
    return body
}
export async function updateGalleryAlbum(settings: AppSettings, album: AlbumDetail, change: { name?: string, isPublic?: boolean }): Promise<{ name: string, is_public: boolean, shareUrl: string | null }> {
    owner(settings, album)
    const patch = { ...(change.name !== undefined ? { name: name(change.name) } : {}), ...(change.isPublic !== undefined ? { isPublic: change.isPublic } : {}) }
    if (!Object.keys(patch).length || (change.isPublic !== undefined && typeof change.isPublic !== 'boolean')) throw new Error('Choose an album change.')
    const body = await request(settings, path(album), { method: 'PATCH', body: JSON.stringify(patch) })
    if (!validAlbum(body) || body.id !== album.id || body.owner !== settings.userId || (change.isPublic !== undefined && body.is_public !== change.isPublic)) throw new Error('The change could not be confirmed. Refresh this album.')
    let shareUrl: string | null = null
    if (body.is_public && typeof body.public_token === 'string' && /^[A-Za-z0-9_-]{32}$/.test(body.public_token)) {
        shareUrl = new URL(`/shared/${body.public_token}`, settings.cdnBaseUrl).toString()
    }
    if (change.isPublic === true && !shareUrl) throw new Error('Sharing may have changed, but the link could not be confirmed. Refresh before retrying.')
    return { name: body.name, is_public: body.is_public, shareUrl }
}
export async function deleteGalleryAlbum(settings: AppSettings, album: AlbumDetail) {
    owner(settings, album)
    const body = await request(settings, path(album), { method: 'DELETE' })
    if (body.deleted !== album.id) throw new Error('Deletion could not be confirmed. Refresh your albums.')
}
export async function addAlbumPhotos(settings: AppSettings, album: AlbumDetail, fileIds: string[]): Promise<{ added: number, requested: number }> {
    if (!['owner', 'contributor'].includes(album.role)) throw new Error('This album is view only.')
    const ids = [...new Set(fileIds)]
    if (!ids.length || ids.length > 500) throw new Error('Select between 1 and 500 photos.')
    ids.forEach(segment)
    const body = await request(settings, `${path(album)}/items`, { method: 'POST', body: JSON.stringify({ fileIds: ids }) })
    if (!Number.isInteger(body.added) || body.added < 0 || body.added > ids.length || body.requested !== ids.length) throw new Error('The added photo count could not be confirmed. Refresh the album.')
    return { added: body.added, requested: body.requested }
}
export function canRemoveAlbumPhoto(settings: AppSettings, album: AlbumDetail, photo: AlbumPhoto) {
    return album.role === 'owner' || (album.role === 'contributor' && photo.added_by === settings.userId)
}
export async function removeAlbumPhoto(settings: AppSettings, album: AlbumDetail, photo: AlbumPhoto) {
    if (!canRemoveAlbumPhoto(settings, album, photo)) throw new Error('You can only remove photos you added to this album.')
    const body = await request(settings, `${path(album)}/items/${segment(photo.id)}`, { method: 'DELETE' })
    if (body.removed !== photo.id) throw new Error('Removal could not be confirmed. Refresh the album.')
}
export async function changeAlbumMember(settings: AppSettings, album: AlbumDetail, userId: string, role: AlbumMember['role']) {
    owner(settings, album)
    const id = userId.trim()
    if (!/^[a-zA-Z0-9._-]{3,80}$/.test(id) || id === settings.userId || !['viewer', 'contributor'].includes(role)) throw new Error('Enter another Hanasand account ID and choose its access.')
    const body = await request(settings, `${path(album)}/members`, { method: 'POST', body: JSON.stringify({ userId: id, role }) })
    if (body.user_id !== id || body.role !== role) throw new Error('Access could not be confirmed. Refresh the album.')
}
export async function removeAlbumMember(settings: AppSettings, album: AlbumDetail, userId: string) {
    if (userId !== settings.userId) owner(settings, album)
    const body = await request(settings, `${path(album)}/members/${segment(userId)}`, { method: 'DELETE' })
    if (body.removed !== userId) throw new Error('Access removal could not be confirmed. Refresh your albums.')
}

// At most three pixel requests/decodes run at once, including full-size previews.
let activeImages = 0
const waitingImages: Array<() => void> = []
function imageSlot(signal?: AbortSignal): Promise<() => void> {
    return new Promise((resolve, reject) => {
        const cancel = () => {
            const index = waitingImages.indexOf(start)
            if (index !== -1) waitingImages.splice(index, 1)
            reject(new Error('Photo request cancelled.'))
        }
        const start = () => {
            signal?.removeEventListener('abort', cancel)
            if (signal?.aborted) { reject(new Error('Photo request cancelled.')); return }
            activeImages++
            resolve(() => { activeImages--; waitingImages.shift()?.() })
        }
        if (signal?.aborted) { cancel(); return }
        if (activeImages < 3) start()
        else { waitingImages.push(start); signal?.addEventListener('abort', cancel, { once: true }) }
    })
}

// Keep private pixels in component memory. Image's native loader cannot create a
// fresh DPoP proof or isolate its cookie jar; apiFetch can do both.
export async function loadGalleryAlbumImage(settings: AppSettings, id: string, thumbnail = true, signal?: AbortSignal): Promise<string> {
    const release = await imageSlot(signal)
    try {
        const response = await fetchCdn(settings, `files/${segment(id)}${thumbnail ? '?variant=thumbnail' : ''}`, { signal, cache: 'no-store' })
        if (signal?.aborted) throw new Error('Photo request cancelled.')
        if (!response.ok) throw new Error(`Photo unavailable (${response.status}). Refresh or sign in again.`)
        const type = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() || ''
        if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/heic', 'image/heif'].includes(type)) throw new Error('The CDN did not return a supported photo.')
        const maxBytes = thumbnail ? 5 * 1024 * 1024 : 50 * 1024 * 1024
        const declaredSize = Number(response.headers.get('Content-Length'))
        if (declaredSize > maxBytes) throw new Error('This photo is too large to preview in the app.')
        // Streaming is available on web/test runtimes. Native fetch may expose
        // only arrayBuffer; validate its actual size as well as Content-Length.
        const reader = response.body?.getReader?.()
        let bytes: Uint8Array
        if (reader) {
            const chunks: Uint8Array[] = []
            let size = 0
            try {
                while (true) {
                    const next = await reader.read()
                    if (signal?.aborted) throw new Error('Photo request cancelled.')
                    if (next.done) break
                    size += next.value.length
                    if (size > maxBytes) throw new Error('This photo is too large to preview in the app.')
                    chunks.push(next.value)
                }
                bytes = new Uint8Array(size)
                let offset = 0
                for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
            } finally { await reader.cancel().catch(() => {}) }
        } else bytes = new Uint8Array(await response.arrayBuffer())
        if (!bytes.length || bytes.length > maxBytes) throw new Error('This photo is empty or too large to preview in the app.')
        if (signal?.aborted) throw new Error('Photo request cancelled.')
        let binary = ''
        for (let offset = 0; offset < bytes.length; offset += 16384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384))
        return `data:${type};base64,${btoa(binary)}`
    } finally { release() }
}
