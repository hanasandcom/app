import { describe, expect, it } from 'bun:test'
import { getThemePalette } from '../theme/tokens'
import { loginFieldColors } from './login-theme'

describe('login field colors', () => {
    it('uses readable theme colors in light and dark modes', () => {
        for (const mode of ['light', 'obsidian'] as const) {
            const palette = getThemePalette(mode)
            expect(loginFieldColors(palette)).toEqual({
                color: palette.text,
                backgroundColor: palette.surface,
                borderColor: palette.surfaceBorderSoft,
            })
        }
    })
})
