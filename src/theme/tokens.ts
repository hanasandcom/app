export const themeVariants = {
    obsidian: {
        background: '#0b0c0b',
        backgroundAlt: '#121311',
        backgroundRaised: '#181917',
        surface: '#20211f',
        surfaceStrong: '#292a27',
        surfaceBorder: '#444640',
        surfaceBorderSoft: '#383a35',
        text: '#f1f3ee',
        textMuted: 'rgba(241,243,238,0.72)',
        textSoft: 'rgba(241,243,238,0.46)',
        accent: '#f07d33',
        accentSoft: 'rgba(240,125,51,0.18)',
        accentAlt: '#74806e',
        success: '#87a37a',
        warning: '#bf8b48',
        danger: '#b86a5e',
        grid: 'rgba(241,243,238,0.032)',
        ambientPrimary: 'rgba(79,132,105,0.08)',
        ambientSecondary: 'rgba(240,125,51,0.07)',
        ambientNeutral: 'rgba(241,243,238,0.04)',
        shadow: 'rgba(0,0,0,0.42)',
    },
    graphite: {
        background: '#101112',
        backgroundAlt: '#17181a',
        backgroundRaised: '#1f2023',
        surface: '#232528',
        surfaceStrong: '#2c2f33',
        surfaceBorder: '#45484e',
        surfaceBorderSoft: '#36393f',
        text: '#f3f5f8',
        textMuted: 'rgba(243,245,248,0.72)',
        textSoft: 'rgba(243,245,248,0.46)',
        accent: '#7e92b8',
        accentSoft: 'rgba(126,146,184,0.18)',
        accentAlt: '#77807d',
        success: '#8ca88e',
        warning: '#c09652',
        danger: '#bc7369',
        grid: 'rgba(243,245,248,0.032)',
        ambientPrimary: 'rgba(120,135,170,0.08)',
        ambientSecondary: 'rgba(155,165,181,0.06)',
        ambientNeutral: 'rgba(243,245,248,0.04)',
        shadow: 'rgba(0,0,0,0.42)',
    },
    forest: {
        background: '#090c0a',
        backgroundAlt: '#0f1511',
        backgroundRaised: '#141c17',
        surface: '#19231c',
        surfaceStrong: '#213026',
        surfaceBorder: '#355140',
        surfaceBorderSoft: '#274034',
        text: '#edf4ee',
        textMuted: 'rgba(237,244,238,0.72)',
        textSoft: 'rgba(237,244,238,0.46)',
        accent: '#7ca36a',
        accentSoft: 'rgba(124,163,106,0.18)',
        accentAlt: '#d58a45',
        success: '#87b484',
        warning: '#ba9756',
        danger: '#af6d60',
        grid: 'rgba(237,244,238,0.028)',
        ambientPrimary: 'rgba(124,163,106,0.11)',
        ambientSecondary: 'rgba(213,138,69,0.07)',
        ambientNeutral: 'rgba(237,244,238,0.035)',
        shadow: 'rgba(0,0,0,0.45)',
    },
} as const

export type ThemeMode = keyof typeof themeVariants
export type ThemePalette = (typeof themeVariants)[ThemeMode]

export const palette = themeVariants.obsidian

export function getThemePalette(mode: ThemeMode = 'obsidian') {
    return themeVariants[mode] || themeVariants.obsidian
}

export const spacing = {
    xs: 8,
    sm: 12,
    md: 16,
    lg: 20,
    xl: 24,
    xxl: 32,
}

export const radius = {
    sm: 14,
    md: 20,
    lg: 28,
    pill: 999,
}
