import { expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
it('keeps synthetic menu UI out of the normal app and denies external requests', () => {
    const normal = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
    const fixture = readFileSync(new URL('./native-menu-fixture.tsx', import.meta.url), 'utf8')
    expect(normal).not.toContain('native-menu-fixture')
    expect(fixture).toContain('url.origin !== \'https://traffic.invalid\'')
    expect(fixture).toContain('External requests are disabled')
    expect(fixture).toContain('Unsupported synthetic write blocked')
    expect(fixture).not.toContain('https://api.hanasand.com')
    expect(fixture).not.toContain('loadSettings')
    expect(fixture).not.toContain('SecureStore')
})
