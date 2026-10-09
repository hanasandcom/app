import { useMemo, useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { ArrowRight, X } from 'lucide-react-native'
import type { AppSettings, HanasandAuthSession } from '../types'
import { completePasswordReset, createHanasandAccount, loginToHanasand, PendingDeletionError, requestPasswordResetCode, verifyPasswordResetCode } from '../lib/api'
import { getThemePalette, spacing, type ThemePalette } from '../theme/tokens'
import { useAppTheme } from '../theme/context'
import { InlineNotice } from '../components/ui'

type AuthMode = 'login' | 'signup'
type ResetStep = 'idle' | 'code' | 'password'

const reservedUsernames = new Set([
    'abuse', 'admin', 'administrator', 'billing', 'bookkeeper', 'cdc', 'ceo', 'cfo', 'chairman', 'compliance',
    'contact', 'controller', 'coo', 'cto', 'director', 'eirikhanasand', 'executive', 'facebook', 'finance',
    'google', 'hanasand', 'help', 'hr', 'legal', 'management', 'manager', 'meta', 'microsoft', 'noreply',
    'owner', 'paypal', 'postmaster', 'president', 'root', 'security', 'soc', 'spam', 'staff', 'support',
    'sysadmin', 'treasurer', 'trust', 'twitter', 'x',
])

export function LoginScreen({
    settings,
    onAuthenticated,
    onPendingDeletion,
}: {
    settings: AppSettings
    onAuthenticated: (session: HanasandAuthSession) => Promise<void>
    onPendingDeletion: (details: { id: string, restoreToken: string, deletionScheduledAt: string }) => Promise<void>
}) {
    const theme = getThemePalette(settings.themeMode)
    const styles = useMemo(() => createStyles(theme), [theme])
    const [authMode, setAuthMode] = useState<AuthMode>('login')
    const [username, setUsername] = useState('')
    const [name, setName] = useState('')
    const [password, setPassword] = useState('')
    const [busy, setBusy] = useState(false)
    const [status, setStatus] = useState('')
    const [resetStep, setResetStep] = useState<ResetStep>('idle')
    const [resetCode, setResetCode] = useState('')
    const [resetToken, setResetToken] = useState('')
    const [newPassword, setNewPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const codeInputRef = useRef<TextInput | null>(null)

    const cleanUsername = username.trim()
    const cleanName = name.trim()
    const passwordCounts = countPassword(password)
    const passwordIsValid =
        password.length >= 16
        && passwordCounts.numbers >= 2
        && passwordCounts.symbols >= 2
        && passwordCounts.lowercase >= 2
        && passwordCounts.uppercase >= 2
    const reservedUsername = reservedUsernames.has(cleanUsername.toLowerCase())
    const canCreateAccount = Boolean(cleanUsername && cleanName && passwordIsValid && !reservedUsername)
    const statusTone = status.includes('accepted') || status.includes('Check') || status.includes('reset') ? 'success' : status.includes('Signing') || status.includes('Creating') || status.includes('Sending') || status.includes('Checking') || status.includes('Setting') ? 'info' : 'error'

    function setMode(nextMode: AuthMode) {
        setAuthMode(nextMode)
        setResetStep('idle')
        setStatus('')
    }

    async function submitLogin() {
        if (busy) return
        setBusy(true)
        setStatus('Signing in')
        try {
            const session = await loginToHanasand(settings, cleanUsername, password)
            setStatus('')
            await onAuthenticated(session)
        } catch (error) {
            if (error instanceof PendingDeletionError) {
                await onPendingDeletion({
                    id: error.id,
                    restoreToken: error.restoreToken,
                    deletionScheduledAt: error.deletionScheduledAt,
                })
                return
            }
            setStatus(error instanceof Error ? error.message : 'Login failed.')
        } finally {
            setBusy(false)
        }
    }

    async function submitSignup() {
        if (busy) return
        if (reservedUsername) {
            setStatus('This username is reserved.')
            return
        }
        if (!passwordIsValid) {
            setStatus('Choose a stronger password.')
            return
        }
        setBusy(true)
        setStatus('Creating account')
        try {
            const session = await createHanasandAccount(settings, cleanUsername, cleanName, password)
            setStatus('')
            await onAuthenticated(session)
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Signup failed.')
        } finally {
            setBusy(false)
        }
    }

    function beginReset() {
        setAuthMode('login')
        setResetStep('code')
        setResetCode('')
        setResetToken('')
        setNewPassword('')
        setConfirmPassword('')
        setStatus('')
    }

    function cancelReset() {
        setResetStep('idle')
        setResetCode('')
        setResetToken('')
        setNewPassword('')
        setConfirmPassword('')
        setStatus('')
    }

    async function sendResetCode() {
        if (busy) return
        setBusy(true)
        setStatus('Sending code')
        try {
            await requestPasswordResetCode(settings, cleanUsername)
            setStatus('Check your mail for the 6 digit code.')
            setTimeout(() => codeInputRef.current?.focus(), 80)
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Unable to send reset code.')
        } finally {
            setBusy(false)
        }
    }

    async function submitResetCode(nextCode = resetCode) {
        if (busy) return
        const code = nextCode.trim()
        if (code.length !== 6) {
            setStatus('Enter the 6 digit code.')
            return
        }
        setBusy(true)
        setStatus('Checking code')
        try {
            const token = await verifyPasswordResetCode(settings, cleanUsername, code)
            setResetToken(token)
            setResetStep('password')
            setStatus('Code accepted.')
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Invalid reset code.')
        } finally {
            setBusy(false)
        }
    }

    async function submitNewPassword() {
        if (busy) return
        if (newPassword !== confirmPassword) {
            setStatus('Passwords do not match.')
            return
        }
        setBusy(true)
        setStatus('Setting password')
        try {
            await completePasswordReset(settings, cleanUsername, resetToken, newPassword)
            setPassword('')
            cancelReset()
            setStatus('Password reset. Log in with the new one.')
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Unable to set password.')
        } finally {
            setBusy(false)
        }
    }

    function updateResetCode(value: string) {
        const clean = value.replace(/\D/g, '').slice(0, 6)
        setResetCode(clean)
        if (clean.length === 6) {
            void submitResetCode(clean)
        }
    }

    return (
        <LinearGradient colors={[theme.backgroundRaised, theme.background, '#050605']} locations={[0, 0.58, 1]} style={styles.root}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboard}>
                <ScrollView keyboardShouldPersistTaps='handled' contentContainerStyle={styles.content}>
                    <View style={styles.masthead}>
                        <Text style={styles.logo}>Hanasand</Text>
                        <View style={styles.logoRule} />
                    </View>

                    <View style={styles.card}>
                        <LoginField
                            value={username}
                            onChangeText={setUsername}
                            placeholder='Username'
                            textContentType='username'
                            returnKeyType='next'
                        />
                        {authMode === 'signup' ? (
                            <>
                                {reservedUsername ? <Text style={styles.inlineHint}>Reserved username.</Text> : null}
                                <LoginField
                                    value={name}
                                    onChangeText={setName}
                                    placeholder='Name'
                                    textContentType='name'
                                    returnKeyType='next'
                                />
                            </>
                        ) : null}
                        <LoginField
                            value={password}
                            onChangeText={setPassword}
                            placeholder='Password'
                            secureTextEntry
                            textContentType='password'
                            returnKeyType='send'
                            onSubmitEditing={() => void (authMode === 'signup' ? submitSignup() : submitLogin())}
                        />
                        {authMode === 'signup' && password && !passwordIsValid ? (
                            <Text style={styles.inlineHint}>16 chars, 2 lowercase, 2 uppercase, 2 numbers, 2 symbols.</Text>
                        ) : null}
                        <View style={styles.actionRow}>
                            <Pressable
                                disabled={busy || (authMode === 'signup' && !canCreateAccount)}
                                onPress={() => void (authMode === 'signup' ? submitSignup() : submitLogin())}
                                style={({ pressed }) => [styles.primaryButton, (busy || (authMode === 'signup' && !canCreateAccount)) && styles.disabled, pressed && !busy && styles.pressed]}
                            >
                                <Text style={styles.primaryText}>
                                    {authMode === 'signup'
                                        ? busy ? 'Creating' : 'Create account'
                                        : busy && resetStep === 'idle' ? 'Logging in' : 'Log in'}
                                </Text>
                            </Pressable>
                            {resetStep === 'idle' ? (
                                <>
                                    <Pressable onPress={() => setMode(authMode === 'signup' ? 'login' : 'signup')} style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}>
                                        <Text style={styles.linkText}>{authMode === 'signup' ? 'Log in' : 'Sign up'}</Text>
                                    </Pressable>
                                    {authMode === 'login' ? (
                                        <Pressable onPress={beginReset} style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}>
                                            <Text style={styles.linkText}>Forgot?</Text>
                                        </Pressable>
                                    ) : null}
                                </>
                            ) : null}
                        </View>
                    </View>

                    {resetStep !== 'idle' ? (
                        <View style={styles.recoveryCard}>
                            <View style={styles.recoveryHeader}>
                                <View>
                                    <Text style={styles.recoveryTitle}>Account recovery</Text>
                                    <Text style={styles.recoverySubtitle}>{resetStep === 'code' ? 'Send and confirm the one-time code.' : 'Choose a new password.'}</Text>
                                </View>
                                <Pressable accessibilityRole='button' accessibilityLabel='Cancel account recovery' onPress={cancelReset} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
                                    <X color={theme.textMuted} size={18} strokeWidth={2.1} />
                                </Pressable>
                            </View>

                            {resetStep === 'code' ? (
                                <View style={styles.resetStack}>
                                    <View style={styles.inlineRow}>
                                        <LoginField
                                            value={username}
                                            onChangeText={setUsername}
                                            placeholder='Username'
                                            textContentType='username'
                                            returnKeyType='send'
                                            onSubmitEditing={() => void sendResetCode()}
                                            style={styles.inlineInput}
                                        />
                                        <Pressable disabled={busy} onPress={() => void sendResetCode()} style={({ pressed }) => [styles.secondaryButton, busy && styles.disabled, pressed && !busy && styles.pressed]}>
                                            <Text style={styles.secondaryText}>Send code</Text>
                                        </Pressable>
                                    </View>
                                    <Pressable accessibilityRole='button' accessibilityLabel='Enter password reset code' onPress={() => codeInputRef.current?.focus()} style={styles.codeRow}>
                                        {Array.from({ length: 6 }).map((_, index) => (
                                            <View key={index} style={[styles.codeBox, resetCode.length === index && styles.codeBoxActive]}>
                                                <Text style={styles.codeText}>{resetCode[index] || ''}</Text>
                                            </View>
                                        ))}
                                    </Pressable>
                                    <TextInput
                                        ref={codeInputRef}
                                        value={resetCode}
                                        onChangeText={updateResetCode}
                                        keyboardType='number-pad'
                                        textContentType='oneTimeCode'
                                        autoComplete='one-time-code'
                                        maxLength={6}
                                        style={styles.hiddenCodeInput}
                                    />
                                </View>
                            ) : (
                                <View style={styles.resetStack}>
                                    <LoginField
                                        value={newPassword}
                                        onChangeText={setNewPassword}
                                        placeholder='New password'
                                        secureTextEntry
                                        textContentType='password'
                                    />
                                    <LoginField
                                        value={confirmPassword}
                                        onChangeText={setConfirmPassword}
                                        placeholder='Confirm new password'
                                        secureTextEntry
                                        textContentType='password'
                                        returnKeyType='send'
                                        onSubmitEditing={() => void submitNewPassword()}
                                    />
                                    <Pressable disabled={busy} onPress={() => void submitNewPassword()} style={({ pressed }) => [styles.setPasswordButton, busy && styles.disabled, pressed && !busy && styles.pressed]}>
                                        <Text style={styles.secondaryText}>Set password</Text>
                                        <ArrowRight color={theme.text} size={16} strokeWidth={2.2} />
                                    </Pressable>
                                </View>
                            )}
                        </View>
                    ) : null}

                    <InlineNotice message={status} tone={statusTone} />
                </ScrollView>
            </KeyboardAvoidingView>
        </LinearGradient>
    )
}

function LoginField({
    style,
    ...props
}: React.ComponentProps<typeof TextInput> & { style?: object }) {
    const theme = useAppTheme()
    return (
        <TextInput
            {...props}
            autoCapitalize='none'
            autoCorrect={false}
            placeholderTextColor={theme.textSoft}
            style={[loginFieldStyles.input, style]}
        />
    )
}

function countPassword(value: string) {
    let numbers = 0
    let symbols = 0
    let lowercase = 0
    let uppercase = 0

    for (const char of value) {
        if (!isNaN(Number(char))) {
            numbers++
        }
        if (/[^a-zA-Z0-9]/.test(char)) {
            symbols++
        }
        if (/[a-z]/.test(char)) {
            lowercase++
        }
        if (/[A-Z]/.test(char)) {
            uppercase++
        }
    }

    return { numbers, symbols, lowercase, uppercase }
}

const loginFieldStyles = StyleSheet.create({
    input: {
        minHeight: 58,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.10)',
        backgroundColor: 'rgba(255,255,255,0.055)',
        color: '#f3f0e8',
        paddingHorizontal: 18,
        fontSize: 17,
        fontWeight: '600',
    },
})

function createStyles(theme: ThemePalette) {
    return StyleSheet.create({
        root: { flex: 1 },
        keyboard: { flex: 1 },
        content: {
            flexGrow: 1,
            justifyContent: 'center',
            paddingHorizontal: spacing.xl,
            paddingVertical: 54,
            gap: 22,
        },
        masthead: { alignItems: 'center', gap: 14, marginBottom: 8 },
        logo: {
            color: theme.text,
            fontSize: 56,
            lineHeight: 62,
            fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }),
            fontWeight: '700',
            letterSpacing: 0.3,
        },
        logoRule: { width: 48, height: 1, backgroundColor: `${theme.text}33` },
        card: {
            gap: 13,
            borderRadius: 26,
            borderWidth: 1,
            borderColor: theme.surfaceBorder,
            backgroundColor: `${theme.surface}dd`,
            padding: 14,
            shadowColor: '#000',
            shadowOpacity: 0.24,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 16 },
        },
        actionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
        primaryButton: {
            minHeight: 54,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.text,
            paddingHorizontal: 24,
        },
        primaryText: { color: theme.background, fontSize: 16, fontWeight: '800' },
        linkButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 },
        linkText: { color: theme.textSoft, fontSize: 13, fontWeight: '700' },
        inlineHint: { color: theme.textMuted, fontSize: 12, fontWeight: '700', lineHeight: 18, paddingHorizontal: 4 },
        recoveryCard: {
            gap: 16,
            borderRadius: 26,
            borderWidth: 1,
            borderColor: `${theme.accent}66`,
            backgroundColor: `${theme.backgroundRaised}cc`,
            padding: 14,
        },
        recoveryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 },
        recoveryTitle: {
            color: theme.text,
            fontSize: 24,
            fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }),
            fontWeight: '700',
        },
        recoverySubtitle: { color: theme.textMuted, fontSize: 13, fontWeight: '600', marginTop: 3 },
        iconButton: {
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: theme.surfaceBorderSoft,
            backgroundColor: theme.backgroundRaised,
        },
        resetStack: { gap: 12 },
        inlineRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
        inlineInput: { flex: 1 },
        secondaryButton: {
            minHeight: 58,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: theme.surfaceBorderSoft,
            backgroundColor: `${theme.surfaceStrong}dd`,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 16,
        },
        secondaryText: { color: theme.text, fontSize: 15, fontWeight: '800' },
        codeRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
        codeBox: {
            flex: 1,
            aspectRatio: 0.9,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: theme.surfaceBorderSoft,
            backgroundColor: `${theme.surfaceStrong}bb`,
            alignItems: 'center',
            justifyContent: 'center',
        },
        codeBoxActive: { borderColor: theme.accent },
        codeText: { color: theme.text, fontSize: 20, fontWeight: '800' },
        hiddenCodeInput: {
            position: 'absolute',
            opacity: 0,
            height: 1,
            width: 1,
        },
        setPasswordButton: {
            minHeight: 52,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: theme.surfaceBorderSoft,
            backgroundColor: `${theme.surfaceStrong}dd`,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: 8,
        },
        disabled: { opacity: 0.58 },
        pressed: { opacity: 0.9, transform: [{ scale: 0.985 }] },
    })
}
