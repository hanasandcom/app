import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { AppSettings } from '../types'

// This module mock requires a separate Bun process (like workspace-data.test.ts).
const calls: Array<{ settings: AppSettings, url: string, init: RequestInit }> = []
let reply: unknown
let status = 200
let image: Response | null = null
let pendingImage: (() => Promise<Response>) | null = null
mock.module('./api', () => ({ apiFetch: async (settings: AppSettings, url: string, init: RequestInit) => {
    calls.push({ settings, url, init })
    if (pendingImage) return pendingImage()
    if (image) return image.clone()
    return Response.json(reply, { status })
} }))
const { listManagedAlbums, loadAlbumDetail, createGalleryAlbum, updateGalleryAlbum, deleteGalleryAlbum, addAlbumPhotos, canRemoveAlbumPhoto, removeAlbumPhoto, changeAlbumMember, removeAlbumMember, loadGalleryAlbumImage, galleryAlbumPageOffset, toggleAlbumPhotoSelection } = await import('./gallery-albums')
const settings = { userId: 'owner', authToken: 'synthetic /;=', cdnBaseUrl: 'https://cdn.hanasand.test/api', impersonatingUserId: '' } as AppSettings
const album = { id: 'album /?', name: 'Photos', owner: settings.userId, is_public: false, role: 'owner' as const, items: [], total: 0, limit: 60, offset: 0, members: [] }
beforeEach(() => { calls.length = 0; reply = {}; status = 200; image = null; pendingImage = null })
function last() { return calls[calls.length - 1] }
function body() { return JSON.parse(String(last().init.body)) }

describe('native album contract and session isolation', () => {
    it('lists and pages actual accessible album shape using current encoded session cookies and no shared cookie jar', async () => {
        reply = [album]
        expect(await listManagedAlbums(settings)).toEqual([album])
        expect(last().url).toBe('https://cdn.hanasand.test/api/albums')
        expect(last().init.credentials).toBe('omit')
        expect(new Headers(last().init.headers).get('Cookie')).toBe('id=owner; access_token=synthetic%20%2F%3B%3D')
        expect(new Headers(last().init.headers).get('Origin')).toBe('https://cdn.hanasand.test')
        reply = { ...album, offset: 60, total: 61, items: [{ id: 'photo', type: 'image/jpeg', added_by: 'owner' }] }
        expect((await loadAlbumDetail(settings, album.id, 60)).items).toHaveLength(1)
        expect(last().url).toBe('https://cdn.hanasand.test/api/albums/album%20%2F%3F?limit=60&offset=60')
        const next = { ...settings, userId: 'next /', authToken: 'new token' }
        reply = []
        await listManagedAlbums(next)
        expect(last().settings).toBe(next)
        expect(new Headers(last().init.headers).get('Cookie')).toBe('id=next%20%2F; access_token=new%20token')
    })
    it('creates private albums, trims names, and rejects invalid names before sending', async () => {
        reply = album
        expect(await createGalleryAlbum(settings, '  Photos  ')).toEqual(album)
        expect(last().init.method).toBe('POST')
        expect(body()).toEqual({ name: 'Photos' })
        for (const invalid of ['', 'x'.repeat(121), 'a\nb', 'a\0b']) await expect(createGalleryAlbum(settings, invalid)).rejects.toThrow()
        expect(calls).toHaveLength(1)
        reply = { ...album, is_public: true }
        await expect(createGalleryAlbum(settings, 'Photos')).rejects.toThrow('could not be confirmed')
    })
    it('renames without changing sharing and uses an explicit public-link patch only on request', async () => {
        reply = { ...album, name: 'Renamed', public_token: null }
        expect(await updateGalleryAlbum(settings, album, { name: 'Renamed' })).toEqual({ name: 'Renamed', is_public: false, shareUrl: null })
        expect(last().init.method).toBe('PATCH')
        expect(body()).toEqual({ name: 'Renamed' })
        reply = { ...album, is_public: true, public_token: 'a'.repeat(32) }
        expect((await updateGalleryAlbum(settings, album, { isPublic: true })).shareUrl).toBe(`https://cdn.hanasand.test/shared/${'a'.repeat(32)}`)
        expect(body()).toEqual({ isPublic: true })
        reply = { ...album, is_public: false, public_token: null }
        expect((await updateGalleryAlbum(settings, album, { isPublic: false })).shareUrl).toBeNull()
        expect(body()).toEqual({ isPublic: false })
        reply = { ...album, is_public: true, public_token: 'https://foreign.test/token' }
        await expect(updateGalleryAlbum(settings, album, { isPublic: true })).rejects.toThrow('link could not be confirmed')
    })
    it('deletes only the album endpoint, never original files', async () => {
        reply = { deleted: album.id }
        await deleteGalleryAlbum(settings, album)
        expect(last().init.method).toBe('DELETE')
        expect(last().url).toBe('https://cdn.hanasand.test/api/albums/album%20%2F%3F')
        expect(last().init.body).toBeUndefined()
        const viewer = { ...album, role: 'viewer' as const }
        await expect(deleteGalleryAlbum(settings, viewer)).rejects.toThrow('owner')
        await expect(updateGalleryAlbum(settings, viewer, { isPublic: true })).rejects.toThrow('owner')
        expect(calls).toHaveLength(1)
    })
    it('deduplicates explicit existing photo IDs and reports partial adds accurately', async () => {
        reply = { added: 1, requested: 2 }
        expect(await addAlbumPhotos(settings, album, ['photo /', 'photo /', 'already-added'])).toEqual({ added: 1, requested: 2 })
        expect(last().url).toEndWith('/albums/album%20%2F%3F/items')
        expect(last().init.method).toBe('POST')
        expect(body()).toEqual({ fileIds: ['photo /', 'already-added'] })
        await expect(addAlbumPhotos(settings, { ...album, role: 'viewer' }, ['photo'])).rejects.toThrow('view only')
        await expect(addAlbumPhotos(settings, album, [])).rejects.toThrow('Select')
        await expect(addAlbumPhotos(settings, album, Array.from({ length: 501 }, (_, i) => String(i)))).rejects.toThrow('Select')
        expect(calls).toHaveLength(1)
    })
    it('contributors can remove only their own additions; removal only deletes album membership', async () => {
        const contributor = { ...album, role: 'contributor' as const }
        const photo = { id: 'photo /?', type: 'image/jpeg', name: 'Photo', added_by: 'owner' }
        expect(canRemoveAlbumPhoto(settings, contributor, photo)).toBe(true)
        expect(canRemoveAlbumPhoto({ ...settings, userId: 'other' }, contributor, photo)).toBe(false)
        await expect(removeAlbumPhoto({ ...settings, userId: 'other' }, contributor, photo)).rejects.toThrow('only remove')
        expect(calls).toHaveLength(0)
        reply = { removed: photo.id }
        await removeAlbumPhoto(settings, contributor, photo)
        expect(last().url).toEndWith('/albums/album%20%2F%3F/items/photo%20%2F%3F')
        expect(last().init.method).toBe('DELETE')
    })
    it('grants explicit member roles only for owners, supports removal and leaving shared albums', async () => {
        reply = { user_id: 'member-id', role: 'viewer' }
        await changeAlbumMember(settings, album, ' member-id ', 'viewer')
        expect(last().url).toEndWith('/members')
        expect(last().init.method).toBe('POST')
        expect(body()).toEqual({ userId: 'member-id', role: 'viewer' })
        await expect(changeAlbumMember(settings, { ...album, role: 'contributor' }, 'member-id', 'viewer')).rejects.toThrow('owner')
        await expect(changeAlbumMember(settings, album, settings.userId, 'viewer')).rejects.toThrow('another')
        await expect(changeAlbumMember(settings, album, 'bad /id', 'viewer')).rejects.toThrow('another')
        reply = { removed: 'member-id' }
        await removeAlbumMember(settings, album, 'member-id')
        expect(last().url).toEndWith('/members/member-id')
        reply = { removed: 'owner' }
        await removeAlbumMember(settings, { ...album, role: 'viewer' }, 'owner')
        expect(last().init.method).toBe('DELETE')
        await expect(removeAlbumMember(settings, { ...album, role: 'viewer' }, 'other')).rejects.toThrow('owner')
    })
    it('does not retry failed writes or silently acknowledge malformed receipts', async () => {
        status = 503; reply = { error: 'Temporary failure' }
        await expect(createGalleryAlbum(settings, 'Photos')).rejects.toThrow('Temporary failure')
        expect(calls).toHaveLength(1)
        status = 200; reply = { added: 5, requested: 1 }
        await expect(addAlbumPhotos(settings, album, ['photo'])).rejects.toThrow('could not be confirmed')
        reply = { ...album, id: 'other' }
        await expect(loadAlbumDetail(settings, album.id)).rejects.toThrow('unexpected')
    })
    it('rejects absent sessions, insecure endpoints and unsupported impersonation before network', async () => {
        for (const next of [{ ...settings, authToken: '' }, { ...settings, cdnBaseUrl: 'http://cdn.hanasand.test/api' }, { ...settings, impersonatingUserId: 'someone' }, { ...settings, impersonatingUserId: '', impersonationToken: 'partial-impersonation' }]) await expect(listManagedAlbums(next)).rejects.toThrow()
        expect(calls).toHaveLength(0)
    })
})

describe('private album image transport', () => {
    it('fetches private pixels using signed apiFetch/current explicit cookies and no-store; never puts credentials into URLs', async () => {
        image = new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/webp' } })
        const controller = new AbortController()
        expect(await loadGalleryAlbumImage(settings, 'photo /?', true, controller.signal)).toBe('data:image/webp;base64,AQID')
        expect(last().url).toBe('https://cdn.hanasand.test/api/files/photo%20%2F%3F?variant=thumbnail')
        expect(last().url).not.toContain(settings.authToken)
        expect(last().init.credentials).toBe('omit')
        expect(last().init.cache).toBe('no-store')
        expect(last().init.signal).toBe(controller.signal)
        expect(new Headers(last().init.headers).get('Cookie')).toContain('access_token=synthetic%20%2F%3B%3D')
        expect(await loadGalleryAlbumImage(settings, 'photo', false)).toStartWith('data:image/webp;')
        expect(last().url).toEndWith('/files/photo')
    })
    it('limits pixel work to three concurrent requests and cancels queued work before any network request', async () => {
        const resolvers: Array<(value: Response) => void> = []
        pendingImage = () => new Promise(resolve => resolvers.push(resolve))
        const controllers = Array.from({ length: 5 }, () => new AbortController())
        const tasks = controllers.map((controller, index) => loadGalleryAlbumImage(settings, `photo-${index}`, true, controller.signal))
        const settled = Promise.allSettled(tasks)
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(calls).toHaveLength(3)
        controllers[3].abort()
        const photo = () => new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'image/png' } })
        resolvers.slice(0, 3).forEach(resolve => resolve(photo()))
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(calls).toHaveLength(4)
        expect(calls.some(call => call.url.includes('photo-3'))).toBe(false)
        resolvers[3](photo())
        const results = await settled
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(4)
        expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    })
    it('discards cancelled old-account responses and fetches the same file afresh for the next account', async () => {
        let resolveImage!: (value: Response) => void
        pendingImage = () => new Promise(resolve => { resolveImage = resolve })
        const controller = new AbortController()
        const old = loadGalleryAlbumImage(settings, 'same-file', true, controller.signal)
        const rejected = old.then(() => 'unexpected success', error => error.message)
        await new Promise(resolve => setTimeout(resolve, 0))
        controller.abort()
        resolveImage(new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'image/png' } }))
        expect(await rejected).toContain('cancelled')
        pendingImage = null
        image = new Response(new Uint8Array([2]), { headers: { 'Content-Type': 'image/png' } })
        const next = { ...settings, userId: 'next-account', authToken: 'next-session' }
        expect(await loadGalleryAlbumImage(next, 'same-file')).toBe('data:image/png;base64,Ag==')
        expect(calls).toHaveLength(2)
        expect(last().settings).toBe(next)
        expect(new Headers(last().init.headers).get('Cookie')).toBe('id=next-account; access_token=next-session')
    })
    it('rejects private access failures, nonimage content, oversized or cancelled pixels', async () => {
        image = new Response('not found', { status: 404 })
        await expect(loadGalleryAlbumImage(settings, 'photo')).rejects.toThrow('404')
        image = new Response('<html>', { headers: { 'Content-Type': 'text/html' } })
        await expect(loadGalleryAlbumImage(settings, 'photo')).rejects.toThrow('supported photo')
        image = new Response('x', { headers: { 'Content-Type': 'image/png', 'Content-Length': String(5 * 1024 * 1024 + 1) } })
        await expect(loadGalleryAlbumImage(settings, 'photo')).rejects.toThrow('too large')
        image = new Response('x', { headers: { 'Content-Type': 'image/png' } })
        const controller = new AbortController(); controller.abort()
        await expect(loadGalleryAlbumImage(settings, 'photo', true, controller.signal)).rejects.toThrow('cancelled')
        image = new Response(new Uint8Array(5 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'image/png', 'Content-Length': '1' } })
        await expect(loadGalleryAlbumImage(settings, 'photo')).rejects.toThrow('too large')
    })
})

describe('bounded album pages', () => {
    it('moves by the actual 60 item page without accumulating offsets or leaving the supported range', () => {
        expect(galleryAlbumPageOffset(0, 'next')).toBe(60)
        expect(galleryAlbumPageOffset(60, 'next')).toBe(120)
        expect(galleryAlbumPageOffset(120, 'previous')).toBe(60)
        expect(galleryAlbumPageOffset(0, 'previous')).toBe(0)
        expect(galleryAlbumPageOffset(999960, 'next')).toBe(1000000)
        expect(() => galleryAlbumPageOffset(-1, 'next')).toThrow('Invalid')
    })
    it('preserves selection across replacement pages and caps it at the server batch limit', () => {
        let selected = toggleAlbumPhotoSelection([], 'first-page-photo')
        const nextPage = galleryAlbumPageOffset(0, 'next')
        expect(nextPage).toBe(60)
        selected = toggleAlbumPhotoSelection(selected, 'second-page-photo')
        expect(selected).toEqual(['first-page-photo', 'second-page-photo'])
        selected = toggleAlbumPhotoSelection(selected, 'first-page-photo')
        expect(selected).toEqual(['second-page-photo'])
        const full = Array.from({ length: 500 }, (_, index) => String(index))
        expect(toggleAlbumPhotoSelection(full, 'new-photo')).toBe(full)
        expect(toggleAlbumPhotoSelection(full, '0')).toHaveLength(499)
    })
})
