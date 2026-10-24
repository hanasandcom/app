import type { ThemePalette } from '../theme/tokens'

export function loginFieldColors(theme: ThemePalette) {
    return {
        color: theme.text,
        backgroundColor: theme.surface,
        borderColor: theme.surfaceBorderSoft,
    }
}
