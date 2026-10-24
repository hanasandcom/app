import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'
test('operations fixture cannot enter normal startup or contact real services', () => {
    const normal = readFileSync(new NodeURL('../index.ts', import.meta.url), 'utf8')
    const fixture = readFileSync(new NodeURL('./support-desk-fixture.tsx', import.meta.url), 'utf8')
    expect(normal).not.toContain('support-desk-fixture')
    expect(fixture).toContain('].includes(url.origin)')
    expect(fixture).toContain('External requests are disabled')
    expect(fixture).toContain('<SafeAreaProvider>')
    expect(fixture).toContain('Unsupported synthetic write blocked')
    expect(fixture).not.toContain('https://hanasand.com')
    expect(fixture).not.toContain('loadSettings')
    expect(fixture).not.toContain('SecureStore')
    expect(fixture).toContain('proof: \'synthetic-proof\'')
    expect(fixture).toContain('live={aiLive}')
})
