import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { AppSettings } from '../types'

// Run this file in its own Bun process: its apiFetch mock replaces the API module.
const requests: Array<{ settings: AppSettings, url: string, init: RequestInit }> = []
let responseBody: unknown = []
const responses: Array<{ body: unknown, status?: number }> = []
mock.module('./api', () => ({
    apiFetch: async (settings: AppSettings, input: RequestInfo | URL, init: RequestInit = {}) => {
        requests.push({ settings, url: String(input), init })
        const response = responses.shift()
        return Response.json(response ? response.body : responseBody, { status: response?.status || 200 })
    },
}))

const { favoriteGalleryFile, loadGalleryAlbums, loadWorkspaceCronJobs, uploadGalleryPhoto, galleryMaxPhotoBytes } = await import('./workspace-data')
const settings: AppSettings = {
    themeMode: 'obsidian',
    workspaceMode: 'daily',
    siteBaseUrl: 'https://hanasand.com',
    apiBaseUrl: 'https://api.example.test/api',
    selectedOrganizationId: 'personal',
    cdnBaseUrl: 'https://cdn.example.test/api',
    authToken: 'synthetic-token',
    userId: 'synthetic-user',
    impersonationToken: '',
    impersonatingUserId: '',
    impersonatingUserName: '',
    codexUrl: '',
    codexApiPath: '',
    desktopAgentBaseUrl: '',
    vpnUrlScheme: '',
    remoteDesktopHost: '',
    remoteDesktopUser: '',
    vncHost: '',
    serverBaseUrl: '',
    serverStartPath: '',
    serverStopPath: '',
    serverLogsPath: '',
}

beforeEach(() => {
    requests.length = 0
    responseBody = []
    responses.length = 0
})

describe('CDN account session transport', () => {
    it('loads albums with the current cookie session and excludes the native cookie jar', async () => {
        const albums = [{ id: 'album-id', name: 'Saved photos', photo_count: 3 }]
        responseBody = albums

        expect(await loadGalleryAlbums(settings)).toEqual(albums)
        expect(requests).toHaveLength(1)
        const request = requests[0]
        expect(request.settings).toBe(settings)
        expect(request.url).toBe('https://cdn.example.test/api/albums')
        expect(request.init.credentials).toBe('omit')
        const headers = new Headers(request.init.headers)
        expect(headers.get('Cookie')).toBe('id=synthetic-user; access_token=synthetic-token')
        expect(headers.get('Origin')).toBe('https://cdn.example.test')
    })

    it('encodes the newly selected account without reusing the previous session', async () => {
        await loadGalleryAlbums(settings)
        const nextAccount = { ...settings, userId: 'user /;=', authToken: 'token /;=&' }
        await loadGalleryAlbums(nextAccount)

        expect(requests).toHaveLength(2)
        expect(requests[1].settings).toBe(nextAccount)
        expect(requests[1].init.credentials).toBe('omit')
        expect(new Headers(requests[1].init.headers).get('Cookie')).toBe('id=user%20%2F%3B%3D; access_token=token%20%2F%3B%3D%26')
    })

    it('favorites use the same isolated session and an explicit PATCH payload', async () => {
        responseBody = { id: 'file /?', favorite: true }
        await favoriteGalleryFile(settings, 'file /?', true)

        expect(requests).toHaveLength(1)
        const request = requests[0]
        expect(request.settings).toBe(settings)
        expect(request.url).toBe('https://cdn.example.test/api/files/file%20%2F%3F/favorite')
        expect(request.init.method).toBe('PATCH')
        expect(request.init.credentials).toBe('omit')
        expect(JSON.parse(String(request.init.body))).toEqual({ favorite: true })
        const headers = new Headers(request.init.headers)
        expect(headers.get('Cookie')).toBe('id=synthetic-user; access_token=synthetic-token')
        expect(headers.get('Origin')).toBe('https://cdn.example.test')
    })

    it('keeps API cron requests free of CDN cookies and Origin headers', async () => {
        responseBody = { jobs: [], ready: true }
        expect(await loadWorkspaceCronJobs(settings)).toEqual({ jobs: [], ready: true })

        expect(requests).toHaveLength(1)
        const request = requests[0]
        expect(request.settings).toBe(settings)
        expect(request.url).toBe('https://api.example.test/api/system/cron')
        expect(request.init.credentials).toBeUndefined()
        const headers = new Headers(request.init.headers)
        expect(headers.get('Cookie')).toBeNull()
        expect(headers.get('Origin')).toBeNull()
    })
})

describe('explicit native photo uploads', () => {
    const photo = { uri: 'file:///synthetic/photo.heic', name: 'photo.heic', size: 1024 }
    it('verifies the account before sending a native multipart photo with current session isolation', async () => {
        responses.push({ body: { id: settings.userId } }, { body: { id: 'uploaded-id', owner: settings.userId, path: 'uploaded-id' } })
        expect(await uploadGalleryPhoto(settings, photo)).toEqual({ id: 'uploaded-id', name: 'photo.heic', type: 'image/heic' })
        expect(requests.map(request => request.url)).toEqual(['https://cdn.example.test/api/auth/session', 'https://cdn.example.test/api/files'])
        const upload = requests[1]
        expect(upload.init.method).toBe('POST')
        expect(upload.init.credentials).toBe('omit')
        const headers = new Headers(upload.init.headers)
        expect(headers.get('Content-Type')).toBeNull()
        expect(headers.get('Cookie')).toBe('id=synthetic-user; access_token=synthetic-token')
        expect(headers.get('Origin')).toBe('https://cdn.example.test')
        const form = upload.init.body as FormData
        expect(form).toBeInstanceOf(FormData)
        expect(form.get('name')).toBe('photo.heic')
        expect(form.get('type')).toBe('image/heic')
        expect(form.has('file')).toBe(true)
    })
    it('rejects unavailable photos, invalid names, unsupported formats and oversize files before network access', async () => {
        for (const invalid of [
            { ...photo, uri: 'ph://not-downloaded' },
            { ...photo, name: 'bad\nname.jpg' },
            { ...photo, name: 'image.svg', type: 'image/svg+xml' },
            { ...photo, size: galleryMaxPhotoBytes + 1 },
            { ...photo, size: 0 },
        ]) await expect(uploadGalleryPhoto(settings, invalid)).rejects.toThrow()
        expect(requests).toHaveLength(0)
    })
    it('does not send photo bytes when the account session is invalid or belongs to someone else', async () => {
        responses.push({ body: { error: 'Sign in to continue.' }, status: 401 })
        await expect(uploadGalleryPhoto(settings, photo)).rejects.toThrow('Sign in')
        expect(requests).toHaveLength(1)
        expect(requests[0].init.body).toBeUndefined()
        responses.push({ body: { id: 'other-account' } })
        await expect(uploadGalleryPhoto(settings, photo)).rejects.toThrow('Sign in again')
        expect(requests).toHaveLength(2)
        expect(requests.every(request => request.url.endsWith('/auth/session'))).toBe(true)
    })
    it('does not acknowledge an anonymous or malformed upload receipt as saved to the account', async () => {
        for (const receipt of [{ id: 'guest-id', owner: null }, { owner: settings.userId }, { id: '', owner: settings.userId }]) {
            responses.push({ body: { id: settings.userId } }, { body: receipt })
            await expect(uploadGalleryPhoto(settings, photo)).rejects.toThrow('ownership could not be confirmed')
        }
        expect(requests.filter(request => request.init.method === 'POST')).toHaveLength(3)
    })
    it('leaves rate-limited uploads for explicit retry without sending a second upload', async () => {
        responses.push({ body: { id: settings.userId } }, { body: { error: 'Please wait before trying again.' }, status: 429 })
        await expect(uploadGalleryPhoto(settings, photo)).rejects.toThrow('Please wait')
        expect(requests.filter(request => request.init.method === 'POST')).toHaveLength(1)
    })
})
