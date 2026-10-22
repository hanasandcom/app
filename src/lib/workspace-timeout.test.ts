import { expect, test } from 'bun:test'
import { workspaceRequestTimeoutMs } from './workspace-timeout'

test('only the exact website Errors GET receives the bounded cold-read budget', () => {
    for (const endpoint of ['api/backend/logs/errors', '/api/backend/logs/errors?limit=150']) {
        expect(workspaceRequestTimeoutMs({ endpoint, origin: 'site' })).toBe(45_000)
        expect(workspaceRequestTimeoutMs({ endpoint, origin: 'site' }, 'POST')).toBe(20_000)
    }
    for (const endpoint of ['api/backend/logs/search?stats=1', 'api/backend/logs/errors/extra', 'api/backend/logs/errors-suffix', 'api/backend/logs/errors/', 'logs/errors', 'https://other.test/api/backend/logs/errors']) {
        expect(workspaceRequestTimeoutMs({ endpoint, origin: 'site' })).toBe(20_000)
    }
    expect(workspaceRequestTimeoutMs({ endpoint: 'api/backend/logs/errors' })).toBe(20_000)
    expect(workspaceRequestTimeoutMs({ endpoint: 'api/backend/logs/errors', origin: 'status' })).toBe(20_000)
})
