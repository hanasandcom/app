import { createContext, type ReactNode, useContext, useMemo } from 'react'
import { getThemePalette, type ThemeMode, type ThemePalette } from './tokens'

const ThemeContext = createContext<ThemePalette>(getThemePalette('obsidian'))

export function AppThemeProvider({
    mode,
    children,
}: {
    mode: ThemeMode
    children: ReactNode
}) {
    const theme = useMemo(() => getThemePalette(mode), [mode])
    return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
}

export function useAppTheme() {
    return useContext(ThemeContext)
}
