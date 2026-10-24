import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'
test('intelligence UI fixture is opt-in and blocks external reads and all writes', () => {
    const normal = readFileSync(new NodeURL('../index.ts', import.meta.url), 'utf8')
    const fixture = readFileSync(new NodeURL('./intelligence-menu-fixture.tsx', import.meta.url), 'utf8')
    expect(normal).not.toContain('intelligence-menu-fixture')
    expect(fixture).toContain('].includes(url.origin)')
    expect(fixture).toContain('External requests are disabled')
    expect(fixture).toContain('<SafeAreaProvider>')
    expect(fixture).toContain('Unsupported synthetic write blocked')
    expect(fixture).toContain('Unsupported synthetic read blocked')
    expect(fixture).toContain('FIXTURE_SENSITIVE_PROSE_MUST_NOT_RENDER')
    expect(fixture).toContain('FIXTURE_UNKNOWN_JSON_MUST_NOT_RENDER')
    expect(fixture).not.toContain('loadSettings')
    expect(fixture).not.toContain('SecureStore')
    expect(fixture).not.toContain('https://hanasand.com')
})
