import { LinearGradient } from 'expo-linear-gradient'
import { createContext, type ReactNode, useContext, useMemo } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, type KeyboardTypeOptions } from 'react-native'
import { AlertCircle, CheckCircle2, Info, Settings2 } from 'lucide-react-native'
import Svg, { Circle, Line, Path } from 'react-native-svg'
import { radius, spacing, type ThemePalette } from '../theme/tokens'
import { useAppTheme } from '../theme/context'

const SettingsDrawerContext = createContext<{ openSettings: () => void } | null>(null)

export function SettingsDrawerProvider({
    openSettings,
    children,
}: {
    openSettings: () => void
    children: ReactNode
}) {
    return (
        <SettingsDrawerContext.Provider value={{ openSettings }}>
            {children}
        </SettingsDrawerContext.Provider>
    )
}

export function Screen({
    title,
    subtitle,
    left,
    right,
    children,
    scroll = true,
    contentStyle,
}: {
    title: string
    subtitle?: string
    left?: ReactNode
    right?: ReactNode
    children: ReactNode
    scroll?: boolean
    contentStyle?: object
}) {
    const settingsDrawer = useContext(SettingsDrawerContext)
    const theme = useAppTheme()
    const styles = useMemo(() => createStyles(theme), [theme])
    const body = scroll
        ? <ScrollView contentContainerStyle={[styles.content, contentStyle]}>{children}</ScrollView>
        : <View style={[styles.content, styles.staticContent, contentStyle]}>{children}</View>

    return (
        <LinearGradient colors={[theme.backgroundRaised, theme.backgroundAlt, theme.background, '#050605']} locations={[0, 0.28, 0.72, 1]} style={styles.root}>
            <View pointerEvents='none' style={styles.atmosphere}>
                <LinearGradient
                    colors={['rgba(255,255,255,0.055)', 'rgba(255,255,255,0.012)', 'rgba(0,0,0,0)']}
                    locations={[0, 0.36, 1]}
                    style={styles.topSheen}
                />
                <LinearGradient
                    colors={['rgba(255,255,255,0.04)', 'rgba(255,255,255,0.01)', 'rgba(0,0,0,0)']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.leftSheen}
                />
                <LinearGradient
                    colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.34)']}
                    start={{ x: 0.5, y: 0 }}
                    end={{ x: 0.5, y: 1 }}
                    style={styles.bottomShade}
                />
                <View style={styles.grid}>
                    <AtmosphereGrid />
                </View>
                <View style={styles.lumbermillWrap}>
                    <LumbermillSketch />
                </View>
                <View style={styles.cabinWrap}>
                    <FutureCabinSketch />
                </View>
            </View>
            <View style={styles.rootEdges}>
                <View style={styles.header}>
                    {left ? <View style={styles.headerLeft}>{left}</View> : null}
                    <View style={{ flex: 1 }}>
                        <Text style={styles.title}>{title}</Text>
                        {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
                    </View>
                    <View style={styles.headerActions}>
                        {right}
                        {settingsDrawer ? (
                            <Pressable onPress={settingsDrawer.openSettings} style={({ pressed }) => [styles.settingsButton, pressed && styles.pressedButton]}>
                                <Settings2 color={theme.textMuted} size={18} strokeWidth={2.1} />
                            </Pressable>
                        ) : null}
                    </View>
                </View>
                {body}
            </View>
        </LinearGradient>
    )
}

export function GlassCard({ children, style }: { children: ReactNode; style?: object }) {
    const theme = useAppTheme()
    const styles = useMemo(() => createStyles(theme), [theme])
    return (
        <View style={[styles.card, style]}>
            {children}
        </View>
    )
}

export function SectionTitle({ eyebrow, title, body }: { eyebrow: string; title: string; body?: string }) {
    const theme = useAppTheme()
    const styles = useMemo(() => createStyles(theme), [theme])
    return (
        <View style={{ gap: 6 }}>
            <Text style={styles.eyebrow}>{eyebrow}</Text>
            <Text style={styles.sectionTitle}>{title}</Text>
            {!!body && <Text style={styles.body}>{body}</Text>}
        </View>
    )
}

export function PillButton({
    label,
    onPress,
    tone = 'default',
    small = false,
    disabled = false,
}: {
    label: string
    onPress: () => void
    tone?: 'default' | 'accent' | 'danger'
    small?: boolean
    disabled?: boolean
}) {
    const theme = useAppTheme()
    const styles = useMemo(() => createStyles(theme), [theme])
    const toneStyle = tone === 'accent' ? styles.buttonAccent : tone === 'danger' ? styles.buttonDanger : styles.buttonDefault
    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            accessibilityRole='button'
            accessibilityLabel={label}
            accessibilityState={{ disabled }}
            style={({ pressed }) => [
                styles.button,
                small && styles.buttonSmall,
                toneStyle,
                disabled && styles.buttonDisabled,
                pressed && !disabled && { opacity: 0.84, transform: [{ scale: 0.98 }] },
            ]}
        >
            <Text style={styles.buttonLabel}>{label}</Text>
        </Pressable>
    )
}

export function StatChip({ label, value }: { label: string; value: string }) {
    const theme = useAppTheme()
    const styles = useMemo(() => createStyles(theme), [theme])
    return (
        <View style={styles.statChip}>
            <Text style={styles.statLabel}>{label}</Text>
            <Text style={styles.statValue}>{value}</Text>
        </View>
    )
}

export function InlineNotice({
    message,
    title,
    tone = 'error',
}: {
    message?: string
    title?: string
    tone?: 'error' | 'info' | 'success'
}) {
    const theme = useAppTheme()
    const styles = useMemo(() => createStyles(theme), [theme])
    if (!message) return null

    const Icon = tone === 'success' ? CheckCircle2 : tone === 'info' ? Info : AlertCircle
    const accent = tone === 'success' ? theme.success : tone === 'info' ? theme.accentAlt : theme.danger

    return (
        <View style={styles.notice}>
            <View style={[styles.noticeAccent, { backgroundColor: accent }]} />
            <Icon color={accent} size={17} strokeWidth={2.1} />
            <View style={{ flex: 1, gap: 2 }}>
                {!!title && <Text style={styles.noticeTitle}>{title}</Text>}
                <Text style={styles.noticeText}>{message}</Text>
            </View>
        </View>
    )
}

export function NativeTile({ eyebrow, title, body, meta, onPress }: { eyebrow?: string; title: string; body: string; meta?: string; onPress?: () => void }) {
    const theme = useAppTheme()
    const styles = useMemo(() => createStyles(theme), [theme])
    const content = (
        <>
            {!!eyebrow && <Text style={styles.tileEyebrow}>{eyebrow}</Text>}
            <Text style={styles.tileTitle}>{title}</Text>
            <Text style={styles.body}>{body}</Text>
            {!!meta && <Text style={styles.tileMeta}>{meta}</Text>}
        </>
    )

    if (!onPress) {
        return (
            <View style={styles.nativeTile}>
                {content}
            </View>
        )
    }

    return (
        <Pressable
            onPress={onPress}
            accessibilityRole='button'
            accessibilityLabel={[eyebrow, title, meta].filter(Boolean).join(', ')}
            style={({ pressed }) => [styles.nativeTile, pressed && styles.nativeTilePressed]}
        >
            {content}
        </Pressable>
    )
}

export function LabeledInput({
    label,
    value,
    onChangeText,
    placeholder,
    secureTextEntry = false,
    multiline = false,
    autoCapitalize = 'sentences',
    autoCorrect = true,
    keyboardType = 'default',
    textContentType = 'none',
}: {
    label: string
    value: string
    onChangeText: (next: string) => void
    placeholder?: string
    secureTextEntry?: boolean
    multiline?: boolean
    autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters'
    autoCorrect?: boolean
    keyboardType?: KeyboardTypeOptions
    textContentType?: 'none' | 'URL' | 'username' | 'password'
}) {
    const theme = useAppTheme()
    const styles = useMemo(() => createStyles(theme), [theme])
    return (
        <View style={{ gap: 8 }}>
            <Text style={styles.inputLabel}>{label}</Text>
            <TextInput
                value={value}
                onChangeText={onChangeText}
                placeholder={placeholder}
                placeholderTextColor={theme.textSoft}
                secureTextEntry={secureTextEntry}
                multiline={multiline}
                autoCapitalize={autoCapitalize}
                autoCorrect={autoCorrect}
                keyboardType={keyboardType}
                textContentType={textContentType}
                style={[styles.input, multiline && styles.inputMultiline]}
            />
        </View>
    )
}

function SketchPath({ d, tone = 'base' }: { d: string; tone?: 'base' | 'distant' | 'shade' }) {
    const theme = useAppTheme()
    const stroke = tone === 'shade' ? theme.ambientNeutral : tone === 'distant' ? theme.grid : theme.textSoft
    const strokeWidth = tone === 'shade' ? 0.9 : tone === 'distant' ? 1.1 : 1.25
    return <Path d={d} fill='none' stroke={stroke} strokeWidth={strokeWidth} strokeLinecap='round' strokeLinejoin='round' />
}

function AtmosphereGrid() {
    const theme = useAppTheme()
    const vertical = Array.from({ length: 8 }, (_, index) => 24 + index * 48)
    const horizontal = Array.from({ length: 12 }, (_, index) => index * 48)

    return (
        <Svg viewBox='0 0 360 640' preserveAspectRatio='none' style={baseStyles.sketchSvg}>
            {vertical.map(position => <Line key={`v-${position}`} x1={position} y1='0' x2={position} y2='640' stroke={theme.grid} strokeWidth='1' />)}
            {horizontal.map(position => <Line key={`h-${position}`} x1='0' y1={position} x2='360' y2={position} stroke={theme.grid} strokeWidth='1' />)}
        </Svg>
    )
}

function LumbermillSketch() {
    const theme = useAppTheme()
    return (
        <Svg viewBox='0 0 430 190' style={baseStyles.sketchSvg}>
            <SketchPath tone='distant' d='M7 122 C37 101 76 112 107 93 C143 71 176 94 209 75 C247 53 286 86 322 68 C356 51 382 68 420 57' />
            <SketchPath tone='distant' d='M43 125 V96 L61 82 L82 96 V125' />
            <SketchPath tone='distant' d='M82 96 L96 102 V126' />
            <SketchPath tone='distant' d='M49 125 V111 H61' />
            <SketchPath tone='distant' d='M129 121 V90 L149 76 L171 91 V121' />
            <SketchPath tone='distant' d='M171 91 L188 98 V123' />
            <SketchPath tone='distant' d='M136 121 V107 H149' />
            <SketchPath tone='distant' d='M286 120 V88 L309 72 L332 88 V120' />
            <SketchPath tone='distant' d='M332 88 L350 97 V122' />
            <SketchPath tone='distant' d='M294 120 V105 H309' />
            <SketchPath tone='distant' d='M363 119 V91 L381 78 L404 92 V119' />
            <SketchPath tone='distant' d='M404 92 L418 99 V121' />
            <SketchPath tone='distant' d='M369 119 V106 H382' />
            <SketchPath tone='distant' d='M40 96 H84 L98 102' />
            <SketchPath tone='distant' d='M126 91 H173 L190 98' />
            <SketchPath tone='distant' d='M283 88 H333 L351 97' />
            <SketchPath tone='distant' d='M359 92 H405 L420 99' />
            <SketchPath d='M18 154 C43 146 68 158 91 151 C112 145 138 154 161 149 C196 142 222 158 253 151 C284 145 319 147 354 153 C376 157 397 148 421 154' />
            <SketchPath d='M22 152 V116 L45 96 L72 114 V152' />
            <SketchPath d='M72 114 L93 123 V152' />
            <SketchPath d='M25 116 H72 L94 123' />
            <SketchPath d='M34 152 V133 H48 V152' />
            <SketchPath d='M57 152 V130 H67 V152' />
            <SketchPath d='M80 152 V135 H88' />
            <SketchPath tone='shade' d='M31 123 H70' />
            <SketchPath tone='shade' d='M31 132 H70' />
            <SketchPath tone='shade' d='M32 144 H68' />
            <SketchPath tone='shade' d='M73 120 L91 127' />
            <SketchPath tone='shade' d='M73 129 L91 136' />
            <SketchPath tone='shade' d='M37 106 L26 116' />
            <SketchPath tone='shade' d='M49 99 L36 116' />
            <SketchPath tone='shade' d='M62 107 L53 116' />
            <SketchPath d='M112 152 V103 L153 76 L199 103 V152' />
            <SketchPath d='M199 103 L227 115 V152' />
            <SketchPath d='M116 103 H199 L228 115' />
            <SketchPath d='M128 152 V124 H148 V152' />
            <SketchPath d='M165 152 V123 H186 V152' />
            <SketchPath d='M207 152 V130 H220' />
            <SketchPath tone='shade' d='M121 112 H196' />
            <SketchPath tone='shade' d='M121 122 H196' />
            <SketchPath tone='shade' d='M121 137 H196' />
            <SketchPath tone='shade' d='M201 110 L225 120' />
            <SketchPath tone='shade' d='M201 121 L225 131' />
            <SketchPath tone='shade' d='M201 135 L225 145' />
            <SketchPath tone='shade' d='M130 94 L116 103' />
            <SketchPath tone='shade' d='M146 83 L126 103' />
            <SketchPath tone='shade' d='M164 82 L142 103' />
            <SketchPath tone='shade' d='M183 94 L170 103' />
            <SketchPath d='M120 124 C137 116 151 128 168 120 C184 113 195 124 209 118' />
            <Circle cx='239' cy='128' r='26' fill='none' stroke={theme.textSoft} strokeWidth='1.25' />
            <Circle cx='239' cy='128' r='8' fill='none' stroke={theme.textSoft} strokeWidth='1.25' />
            <SketchPath d='M239 102 V154' />
            <SketchPath d='M213 128 H265' />
            <SketchPath d='M221 110 L257 146' />
            <SketchPath d='M257 110 L221 146' />
            <SketchPath tone='shade' d='M207 136 C221 141 238 143 269 136' />
            <SketchPath tone='shade' d='M210 145 C229 151 249 150 266 143' />
            <SketchPath d='M274 152 V114 L297 96 L323 113 V152' />
            <SketchPath d='M323 113 L345 123 V152' />
            <SketchPath d='M277 114 H324 L346 123' />
            <SketchPath d='M286 152 V134 H301 V152' />
            <SketchPath d='M313 152 V132 H321' />
            <SketchPath d='M333 152 V137 H341' />
            <SketchPath tone='shade' d='M282 122 H321' />
            <SketchPath tone='shade' d='M282 134 H321' />
            <SketchPath tone='shade' d='M282 145 H321' />
            <SketchPath tone='shade' d='M325 120 L343 128' />
            <SketchPath tone='shade' d='M325 132 L343 140' />
            <SketchPath tone='shade' d='M287 106 L277 114' />
            <SketchPath tone='shade' d='M301 99 L287 114' />
            <SketchPath tone='shade' d='M315 108 L306 114' />
            <SketchPath d='M365 152 V122 L383 108 L406 122 V152' />
            <SketchPath d='M406 122 L423 130 V152' />
            <SketchPath d='M367 122 H407 L424 130' />
            <SketchPath d='M373 152 V137 H386 V152' />
            <SketchPath d='M395 152 V135 H403' />
            <SketchPath tone='shade' d='M370 129 H405' />
            <SketchPath tone='shade' d='M370 141 H405' />
            <SketchPath tone='shade' d='M408 128 L422 134' />
            <SketchPath tone='shade' d='M408 138 L422 145' />
            <SketchPath d='M84 152 V126 L101 113 L119 126 V152' />
            <SketchPath d='M89 152 V138 H101 V152' />
            <SketchPath d='M86 126 H120' />
            <SketchPath d='M120 126 L132 132 V152' />
            <SketchPath tone='shade' d='M88 133 H117' />
            <SketchPath tone='shade' d='M89 144 H118' />
            <SketchPath d='M346 152 V128 L360 117 L377 128 V152' />
            <SketchPath d='M351 152 V139 H361 V152' />
            <SketchPath d='M348 128 H378' />
            <SketchPath d='M378 128 L390 134 V152' />
            <SketchPath tone='shade' d='M350 135 H376' />
            <SketchPath tone='shade' d='M350 145 H376' />
            <SketchPath d='M293 96 V74' />
            <SketchPath d='M289 74 H301' />
            <SketchPath d='M297 72 C306 66 298 57 309 51' />
        </Svg>
    )
}

function FutureCabinSketch() {
    const theme = useAppTheme()
    return (
        <Svg viewBox='0 0 430 190' style={baseStyles.sketchSvg}>
            <SketchPath tone='shade' d='M224 137 C267 119 310 129 352 110 C385 95 407 97 426 85' />
            <SketchPath d='M267 114 L267 75 L340 55 L398 89 L398 114' />
            <SketchPath d='M340 55 L340 101' />
            <SketchPath d='M340 101 L398 114' />
            <SketchPath d='M267 75 L340 55 L403 89' />
            <SketchPath d='M251 77 L312 36 L414 88 L401 92 L341 69 L267 87 Z' />
            <SketchPath d='M312 36 L341 69' />
            <SketchPath d='M341 69 L414 88' />
            <SketchPath d='M267 114 L340 101' />
            <SketchPath tone='shade' d='M275 84 L331 69' />
            <SketchPath tone='shade' d='M275 96 L331 82' />
            <SketchPath tone='shade' d='M275 108 L331 95' />
            <SketchPath tone='shade' d='M348 72 L390 94' />
            <SketchPath tone='shade' d='M348 86 L391 107' />
            <SketchPath tone='shade' d='M277 66 L266 75' />
            <SketchPath tone='shade' d='M296 51 L281 74' />
            <SketchPath tone='shade' d='M321 47 L302 68' />
            <SketchPath tone='shade' d='M351 64 L338 70' />
            <SketchPath tone='shade' d='M379 78 L365 83' />
            <SketchPath d='M286 90 L320 81 L320 106 L286 113 Z' />
            <SketchPath d='M292 95 L313 90 L313 104 L292 108 Z' />
            <SketchPath tone='shade' d='M303 86 V110' />
            <SketchPath tone='shade' d='M286 102 L320 95' />
            <SketchPath tone='distant' d='M291 101 C305 91 318 94 332 82 C347 70 359 76 374 62' />
            <SketchPath tone='distant' d='M291 110 C311 98 333 105 355 90 C372 78 384 82 402 69' />
            <SketchPath d='M354 114 V90 L379 98 V114' />
            <SketchPath d='M349 90 L377 82 L403 95' />
            <SketchPath d='M379 98 L403 95 V114' />
            <SketchPath d='M363 89 L363 80' />
            <SketchPath d='M359 78 H367' />
            <Circle cx='363' cy='85' r='3' fill='none' stroke={theme.textSoft} strokeWidth='1.25' />
            <SketchPath tone='shade' d='M356 86 C360 78 366 78 371 86' />
            <SketchPath tone='shade' d='M353 101 L375 107' />
            <SketchPath tone='shade' d='M384 101 L398 97' />
            <SketchPath d='M218 128 V78' />
            <SketchPath d='M191 104 L218 59 L247 104' />
            <SketchPath d='M197 119 L218 83 L242 119' />
            <SketchPath d='M204 128 L218 105 L235 128' />
            <SketchPath d='M410 121 V82' />
            <SketchPath d='M388 101 L410 67 L429 101' />
            <SketchPath d='M394 114 L410 90 L425 114' />
            <SketchPath d='M178 134 V99' />
            <SketchPath d='M161 116 L178 88 L195 116' />
            <SketchPath d='M166 127 L178 108 L191 127' />
            <SketchPath d='M18 166 C68 156 120 170 168 160 C208 151 239 164 273 156' />
            <SketchPath d='M10 181 C60 171 114 185 164 175 C204 166 233 178 270 171' />
            <SketchPath tone='shade' d='M36 173 C80 166 126 177 171 168' />
            <SketchPath tone='shade' d='M57 186 C100 179 143 188 188 181' />
            <SketchPath d='M249 126 H404' />
            <SketchPath tone='shade' d='M264 126 L274 133' />
            <SketchPath tone='shade' d='M296 126 L306 133' />
            <SketchPath tone='shade' d='M328 126 L338 133' />
            <SketchPath tone='shade' d='M360 126 L370 133' />
            <SketchPath tone='shade' d='M392 126 L402 133' />
        </Svg>
    )
}

function createStyles(theme: ThemePalette) {
    return StyleSheet.create({
        root: { flex: 1, backgroundColor: theme.background },
        rootEdges: { flex: 1 },
        atmosphere: {
            ...StyleSheet.absoluteFillObject,
            overflow: 'hidden',
        },
        grid: {
            ...StyleSheet.absoluteFillObject,
            opacity: 0.36,
        },
        header: { paddingHorizontal: spacing.lg, paddingTop: 84, paddingBottom: spacing.md, gap: 6, flexDirection: 'row', alignItems: 'flex-start' },
        headerLeft: { marginRight: spacing.xs },
        headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
        content: { paddingHorizontal: spacing.lg, paddingBottom: 168, gap: spacing.md },
        staticContent: { flex: 1 },
        eyebrow: { color: theme.textSoft, fontSize: 12, textTransform: 'uppercase', letterSpacing: 2 },
        title: { color: theme.text, fontSize: 30, fontWeight: '700' },
        subtitle: { color: theme.textMuted, fontSize: 14, lineHeight: 20, marginTop: 2 },
        sectionTitle: { color: theme.text, fontSize: 21, fontWeight: '700' },
        body: { color: theme.textMuted, fontSize: 14, lineHeight: 20 },
        card: {
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: theme.surfaceBorder,
            padding: spacing.lg,
            backgroundColor: theme.surface,
            shadowOpacity: 0,
        },
        button: { minHeight: 44, borderRadius: radius.pill, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.surfaceBorder },
        buttonSmall: { minHeight: 38, paddingHorizontal: 14 },
        buttonDefault: { backgroundColor: theme.surfaceStrong },
        buttonAccent: { backgroundColor: theme.accentSoft, borderColor: theme.accent },
        buttonDanger: { backgroundColor: `${theme.danger}2e`, borderColor: `${theme.danger}55` },
        buttonDisabled: { opacity: 0.55 },
        buttonLabel: { color: theme.text, fontWeight: '600', fontSize: 14 },
        statChip: { flex: 1, minWidth: 92, borderRadius: radius.md, borderWidth: 1, borderColor: theme.surfaceBorder, backgroundColor: theme.surfaceStrong, padding: spacing.md, gap: 6 },
        statLabel: { color: theme.textSoft, fontSize: 12 },
        statValue: { color: theme.text, fontSize: 18, fontWeight: '700' },
        notice: {
            position: 'relative',
            overflow: 'hidden',
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 10,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: theme.surfaceBorderSoft,
            backgroundColor: theme.ambientNeutral,
            paddingHorizontal: 12,
            paddingVertical: 11,
        },
        noticeAccent: {
            position: 'absolute',
            top: 9,
            bottom: 9,
            left: 0,
            width: 2,
            borderTopRightRadius: 2,
            borderBottomRightRadius: 2,
        },
        noticeTitle: { color: theme.text, fontSize: 13, fontWeight: '600' },
        noticeText: { color: theme.textMuted, fontSize: 13, lineHeight: 18, fontWeight: '500' },
        nativeTile: {
            gap: 6,
            borderRadius: radius.md,
            padding: spacing.md,
            borderWidth: 1,
            borderColor: theme.surfaceBorderSoft,
            backgroundColor: theme.surfaceStrong,
        },
        nativeTilePressed: {
            opacity: 0.9,
            transform: [{ scale: 0.99 }],
        },
        tileEyebrow: {
            color: theme.textSoft,
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: 1.8,
        },
        tileTitle: {
            color: theme.text,
            fontSize: 16,
            fontWeight: '700',
        },
        tileMeta: {
            color: theme.accentAlt,
            fontSize: 12,
            marginTop: 2,
        },
        inputLabel: { color: theme.textMuted, fontSize: 13, fontWeight: '600' },
        input: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: theme.surfaceBorder, backgroundColor: theme.surfaceStrong, paddingHorizontal: 14, color: theme.text, fontSize: 15 },
        inputMultiline: { minHeight: 110, textAlignVertical: 'top', paddingVertical: 14 },
        settingsButton: {
            width: 42,
            height: 42,
            borderRadius: 15,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: theme.surfaceBorderSoft,
            backgroundColor: theme.ambientNeutral,
        },
        pressedButton: {
            opacity: 0.84,
            transform: [{ scale: 0.98 }],
        },
        topSheen: {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 210,
        },
        leftSheen: {
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            width: 96,
        },
        bottomShade: {
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 220,
        },
        lumbermillWrap: {
            position: 'absolute',
            top: 116,
            left: -8,
            width: 264,
            height: 118,
            opacity: 0.72,
            transform: [{ rotate: '-1.4deg' }],
        },
        cabinWrap: {
            position: 'absolute',
            right: -6,
            bottom: 182,
            width: 252,
            height: 116,
            opacity: 0.68,
            transform: [{ rotate: '1.2deg' }],
        },
        sketchSvg: {
            width: '100%',
            height: '100%',
        },
    })
}

const baseStyles = StyleSheet.create({
    sketchSvg: {
        width: '100%',
        height: '100%',
    },
})
