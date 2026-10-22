import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { AppSettings } from '../types'

// Run this file in its own Bun process: its apiFetch mock replaces the API module.
const requests: Array<{ settings: AppSettings, url: string, init: RequestInit }> = []
let responseBody: unknown = []
mock.module('./api', () => ({
    apiFetch: async (settings: AppSettings, input: RequestInfo | URL, init: RequestInit = {}) => {
        requests.push({ settings, url: String(input), init })
        return Response.json(responseBody)
    },
}))

const { favoriteGalleryFile, loadGalleryAlbums, loadWorkspaceCronJobs } = await import('./workspace-data')
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
