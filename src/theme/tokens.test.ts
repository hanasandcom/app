import { describe, expect, it } from 'bun:test'
import { themeVariants } from './tokens'

describe('mobile theme accent', () => {
    it('uses restrained red details across all appearance modes', () => {
        for (const theme of Object.values(themeVariants)) {
            expect(theme.accent).toBe('#e25b61')
            expect(theme.surfaceBorder).not.toBe(theme.accent)
            expect(theme.surfaceBorderSoft).not.toBe(theme.accent)
            expect(theme.accentSoft).not.toContain('240,125,51')
            expect(theme.accentSoft).not.toContain('213,138,69')
        }
    })

    it('marks the shaded off-white palette semantically and keeps it distinct from white', () => {
        expect(themeVariants.light.isLight).toBe(true)
        expect(themeVariants.light.surface).not.toBe('#ffffff')
        expect(themeVariants.light.background).toBe('#e3e5e7')
        expect(themeVariants.obsidian.isLight).toBe(false)
        expect(themeVariants.graphite.isLight).toBe(false)
        expect(themeVariants.forest.isLight).toBe(false)
    })
})
