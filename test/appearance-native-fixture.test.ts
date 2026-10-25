import { expect, test } from 'bun:test'

test('appearance simulator fixture is opt-in, isolated from normal app startup, and verifies global theme context', async () => {
    const normal = await Bun.file(new URL('../index.ts', import.meta.url)).text()
    const fixture = await Bun.file(new URL('./appearance-native-fixture.tsx', import.meta.url)).text()
    const drawer = await Bun.file(new URL('../src/components/SettingsDrawer.tsx', import.meta.url)).text()
    expect(normal).not.toContain('appearance-native-fixture')
    expect(fixture).toContain("import { SettingsDrawer }")
    expect(fixture).toContain('onThemeChange={themeMode => setSettings')
    expect(fixture).toContain('useAppTheme()')
    expect(fixture).toContain('<AppThemeProvider mode={settings.themeMode}>')
    expect(fixture).not.toContain('fetch(')
    expect(drawer).toContain("drawerCompact: {\n        flexDirection: 'column',\n        height: '100%',\n    }")
    expect(drawer).toContain('<ScrollView contentContainerStyle={[styles.content, compactDrawer && styles.contentCompact]}>')
})
