import { useEffect, useRef, useState } from 'react'
import { Text, TextInput, View } from 'react-native'
import type { AppSettings } from '../types'
import { checkPasswordHash } from '../lib/password-check'
import { threatAccountKey } from '../lib/threat-search'
import type { BreachFile } from '../lib/pwned-prefix'
import { GlassCard, InlineNotice, PillButton, Screen } from '../components/ui'
import { useAppTheme } from '../theme/context'

export function PasswordCheckScreen({ settings }: { settings: AppSettings }) {
    return <AccountPasswordCheck key={threatAccountKey(settings)} settings={settings} />
}
function AccountPasswordCheck({ settings }: { settings: AppSettings }) {
    const theme = useAppTheme()
    const [hash, setHash] = useState('')
    const [result, setResult] = useState<{ count: number; files: BreachFile[] } | null>(null)
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const attempt = useRef(0)
    const request = useRef<AbortController | null>(null)
    useEffect(() => () => { attempt.current += 1; request.current?.abort() }, [])
    function clear() {
        attempt.current += 1; request.current?.abort()
        setHash(''); setResult(null); setError(''); setBusy(false)
    }
    async function check() {
        if (busy) return
        const value = hash
        setHash(''); setResult(null); setError(''); setBusy(true)
        const id = ++attempt.current
        const controller = new AbortController()
        request.current = controller
        const timeout = setTimeout(() => controller.abort(), 30000)
        try {
            const next = await checkPasswordHash(settings, value, controller.signal)
            if (attempt.current === id) setResult(next)
        } catch (cause) {
            if (attempt.current === id) setError(controller.signal.aborted ? 'The check took too long. Try again.' : cause instanceof Error ? cause.message : 'Unable to check this hash.')
        } finally { if (attempt.current === id) setBusy(false); clearTimeout(timeout) }
    }
    const text = { color: theme.textMuted, fontSize: 14, lineHeight: 21 }
    return <Screen title='Check password'>
        <GlassCard style={{ gap: 12 }}>
            <Text style={text}>Enter a SHA-1 hash, as on the website. Only its first five characters are sent. The full hash stays on this device and is cleared from the input when you check it.</Text>
            <TextInput accessibilityLabel='SHA-1 hash' value={hash} onChangeText={value => { setHash(value); setError(''); setResult(null) }} placeholder='40-character SHA-1 hash' placeholderTextColor={theme.textSoft} autoCapitalize='characters' autoCorrect={false} spellCheck={false} textContentType='none' autoComplete='off' importantForAutofill='no' maxLength={80} editable={!busy} onSubmitEditing={() => void check()} style={{ minHeight: 48, color: theme.text, borderWidth: 1, borderColor: theme.surfaceBorderSoft, borderRadius: 14, paddingHorizontal: 14 }} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
                <PillButton label={busy ? 'Checking…' : 'Check hash'} tone='accent' disabled={busy || !hash.trim()} onPress={() => void check()} />
                <PillButton label={busy ? 'Cancel' : 'Clear'} onPress={clear} />
            </View>
            {!!error && <InlineNotice message={error} />}
        </GlassCard>
        {result && <GlassCard style={{ gap: 12 }}>
            <Text accessibilityRole='header' style={{ color: result.count ? theme.danger : theme.success, fontSize: 18, fontWeight: '700' }}>{result.count ? 'Found in leaked records' : 'No match found'}</Text>
            <Text style={text}>{result.count ? `${result.count.toLocaleString()} occurrences in the checked records. If this is your password, replace it wherever you use it.` : 'No match was found in the checked records. This result does not establish that a password is safe.'}</Text>
            {result.files.map(file => <View key={file.file} style={{ gap: 4 }}>
                <Text selectable style={{ color: theme.text, fontWeight: '600' }}>{file.file}</Text>
                <Text style={text}>{file.count.toLocaleString()} occurrences · Lines {file.lineRanges.map(([first, last]) => first === last ? first : `${first}–${last}`).join(', ')}</Text>
            </View>)}
        </GlassCard>}
    </Screen>
}
