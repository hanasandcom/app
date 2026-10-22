import type { AppSettings } from '../types'
import { apiFetch } from './api'

export function workspaceAccountKey(settings: AppSettings) {
    return `${settings.apiBaseUrl.replace(/\/+$/, '')}/${settings.userId}/${settings.impersonatingUserId || ''}/${(settings as AppSettings & { selectedOrganizationId?: string }).selectedOrganizationId || ''}`
}

async function request(settings: AppSettings, service: 'api' | 'cdn', path: string, init: RequestInit = {}) {
    const base = service === 'cdn' ? settings.cdnBaseUrl : settings.apiBaseUrl
    if (!settings.userId || !settings.authToken || !base) throw new Error('Sign in to load your account.')
    const url = new URL(`${base.replace(/\/+$/, '')}/${path}`)
    if (url.protocol !== 'https:') throw new Error('A secure HTTPS connection is required.')
    const headers = new Headers(init.headers)
    if (typeof FormData !== 'undefined' && init.body instanceof FormData) headers.delete('Content-Type')
    else headers.set('Content-Type', 'application/json')
    if (service === 'cdn') {
        // The CDN album and favorite routes use the same session token through cookies.
        headers.set('Cookie', `id=${encodeURIComponent(settings.userId)}; access_token=${encodeURIComponent(settings.authToken)}`)
        headers.set('Origin', url.origin)
    }
    const response = await apiFetch(settings, url.toString(), {
        ...init,
        // iOS appends supplied Cookie headers to its shared jar unless disabled.
        // Keep the CDN cookie session tied to the currently signed-in account.
        ...(service === 'cdn' ? { credentials: 'omit' as const } : {}),
        headers,
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) throw new Error(body?.error || `Request failed (${response.status}). Please retry.`)
    if (!body || typeof body !== 'object') throw new Error('The server returned an unexpected response.')
    return body
}

export type GalleryFile = {
    id: string
    name: string
    type: string
    uploaded_at?: string
    photo_taken_at?: string
    is_favorite?: boolean
    location_label?: string
}
export type GalleryAlbum = { id: string, name: string, photo_count: number, member_role?: string }
export type GalleryFilter = { search: string, favorites: boolean, albumId: string }
export const galleryPageSize = 60

export async function loadGalleryPage(settings: AppSettings, filter: GalleryFilter, offset: number): Promise<{ files: GalleryFile[], hasMore: boolean, nextOffset: number }> {
    const query = new URLSearchParams({ limit: String(galleryPageSize), offset: String(offset), search: filter.search.trim(), media: 'images' })
    if (filter.favorites && !filter.albumId) query.set('favorites', 'true')
    const body = await request(settings, 'cdn', filter.albumId
        ? `albums/${encodeURIComponent(filter.albumId)}?${query}`
        : `files/user/${encodeURIComponent(settings.userId)}?${query}`)
    const rows = filter.albumId ? body.items : body
    if (!Array.isArray(rows)) throw new Error('The image library returned an unexpected response.')
    const files = rows.filter((entry): entry is GalleryFile => Boolean(entry && typeof entry.id === 'string' && typeof entry.type === 'string' && entry.type.startsWith('image/')))
    return { files, nextOffset: offset + rows.length, hasMore: filter.albumId ? offset + rows.length < Number(body.total) : rows.length === galleryPageSize }
}

export async function loadGalleryAlbums(settings: AppSettings): Promise<GalleryAlbum[]> {
    const body = await request(settings, 'cdn', 'albums')
    if (!Array.isArray(body)) throw new Error('The albums returned an unexpected response.')
    return body.filter(entry => entry && typeof entry.id === 'string' && typeof entry.name === 'string')
}

export async function favoriteGalleryFile(settings: AppSettings, id: string, favorite: boolean) {
    await request(settings, 'cdn', `files/${encodeURIComponent(id)}/favorite`, { method: 'PATCH', body: JSON.stringify({ favorite }) })
}

export const galleryMaxPhotoBytes = 50 * 1024 * 1024
export type GalleryUploadPhoto = { uri: string, name: string, type?: string, size: number }
const galleryPhotoTypes: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', avif: 'image/avif', heic: 'image/heic', heif: 'image/heif',
}

export async function uploadGalleryPhoto(settings: AppSettings, photo: GalleryUploadPhoto): Promise<GalleryFile> {
    if (!/^(file|content):\/\//.test(photo.uri)) throw new Error('Choose a photo available on this device.')
    if (!photo.name.trim() || photo.name.length > 255 || /[\r\n\0]/.test(photo.name)) throw new Error('Choose a photo with a valid file name.')
    if (!Number.isFinite(photo.size) || photo.size <= 0 || photo.size > galleryMaxPhotoBytes) throw new Error('Photos must be between 1 byte and 50 MB.')
    const extension = photo.name.split('.').pop()?.toLowerCase() || ''
    const type = Object.values(galleryPhotoTypes).includes(photo.type || '') ? photo.type! : galleryPhotoTypes[extension]
    if (!type) throw new Error('Choose a JPEG, PNG, GIF, WebP, AVIF, or HEIC photo.')
    // The upload route also permits guests. Verify the account before sending bytes.
    const session = await request(settings, 'cdn', 'auth/session')
    if (session.id !== settings.userId) throw new Error('Sign in again before uploading photos.')
    const form = new FormData()
    form.append('file', { uri: photo.uri, name: photo.name, type } as unknown as Blob)
    form.append('name', photo.name)
    form.append('type', type)
    const body = await request(settings, 'cdn', 'files', { method: 'POST', body: form })
    if (typeof body.id !== 'string' || !body.id || body.owner !== settings.userId) {
        throw new Error('Upload ownership could not be confirmed. Refresh your library before retrying.')
    }
    return { id: body.id, name: photo.name, type }
}

export function galleryImageUrl(settings: AppSettings, id: string, thumbnail = false) {
    return `${settings.cdnBaseUrl.replace(/\/+$/, '')}/files/${encodeURIComponent(id)}${thumbnail ? '?variant=thumbnail' : ''}`
}

export type WorkspaceCronJob = {
    id: string
    name: string
    description: string
    category: string
    service: string
    host?: string
    schedule: string
    enabled: boolean
    running: boolean
    status: string
    lastRunAt: string | null
    nextRunAt: string | null
    lastSuccessAt: string | null
    lastError: string | null
    logExcerpt: string | null
    controls: string[]
}

function cronJobs(body: unknown): WorkspaceCronJob[] {
    if (!Array.isArray(body)) throw new Error('Cron jobs returned an unexpected response.')
    return body.filter(entry => entry && typeof entry.id === 'string').map(entry => ({
        ...entry,
        name: entry.name || entry.id,
        description: entry.description || '',
        category: entry.category || 'Other/System',
        service: entry.service || '',
        schedule: entry.schedule || '',
        status: entry.status || 'unknown',
        controls: Array.isArray(entry.controls) ? entry.controls : [],
    }))
}

export async function loadWorkspaceCronJobs(settings: AppSettings) {
    const body = await request(settings, 'api', 'system/cron')
    return { jobs: cronJobs(body.jobs), ready: body.ready !== false }
}

export async function changeWorkspaceCronJob(settings: AppSettings, job: WorkspaceCronJob, patch: { schedule?: string, enabled?: boolean, action?: 'run_now' }) {
    if (patch.schedule !== undefined && !job.controls.includes('edit_schedule')) throw new Error('This schedule cannot be edited.')
    if (patch.action && (!job.controls.includes('run_now') || job.running)) throw new Error('This job cannot be started right now.')
    if (patch.enabled !== undefined && !(patch.enabled ? ['resume', 'enable'] : ['pause', 'disable']).some(control => job.controls.includes(control))) throw new Error('This job cannot be changed from your account.')
    const body = await request(settings, 'api', `system/cron/${encodeURIComponent(job.id)}`, { method: 'PUT', body: JSON.stringify(patch) })
    return cronJobs(body.jobs)
}
