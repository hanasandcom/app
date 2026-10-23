import { useEffect, useRef, useState } from 'react'
import { Alert, Text, TextInput, View } from 'react-native'
import { GlassCard, PillButton, SectionTitle } from './ui'
import { AiMetricsText } from './AiMetricsClients'
import { useAppTheme } from '../theme/context'
import { aiPromptDraftAfterAcceptance, type AiTestMessage } from '../lib/ai-metrics-live'

export function AiMetricsPrompt({ clientName, epoch, disabled, busy, status, messages, partial, onSend, onClose, onStop }: {
    clientName: string; epoch: number; disabled: boolean; busy: boolean; status: string
    messages: AiTestMessage[]; partial: string
    onSend: (prompt: string, epoch: number, onAccepted: () => void) => void; onClose: () => void; onStop: () => void
}) {
    const theme = useAppTheme(), [prompt, setPrompt] = useState('')
    const mounted = useRef(true), revision = useRef(0)
    const latest = useRef({ prompt, epoch, disabled, clientName, revision: revision.current })
    latest.current = { prompt, epoch, disabled, clientName, revision: revision.current }
    useEffect(() => {
        mounted.current = true
        return () => { mounted.current = false }
    }, [])
    function edit(value: string) {
        revision.current++
        latest.current = { ...latest.current, prompt: value, revision: revision.current }
        setPrompt(value)
    }
    function review() {
        if (disabled || !prompt.trim()) return
        const snapshot = { ...latest.current }
        Alert.alert('Send model test?', `Client: ${clientName}\nMaximum output: 512 tokens\nTemperature: 0.7\n\n${prompt}\n\nThis submits real inference work. Closing the screen stops listening, not the model.`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Send test', onPress: () => {
                if (!mounted.current || latest.current.disabled || latest.current.epoch !== snapshot.epoch
                    || latest.current.prompt !== snapshot.prompt || latest.current.clientName !== snapshot.clientName
                    || latest.current.revision !== snapshot.revision) return
                onSend(snapshot.prompt, snapshot.epoch, () => {
                    if (!mounted.current) return
                    const next = aiPromptDraftAfterAcceptance(latest.current, snapshot)
                    latest.current = { ...latest.current, prompt: next }
                    setPrompt(next)
                })
            } },
        ])
    }
    return <GlassCard style={{ gap: 12 }}>
        <SectionTitle title={`Test ${clientName}`} eyebrow='Targeted model conversation' body='Responses stay in memory and clear when this screen hides, the target changes, or the test closes.' />
        <AiMetricsText>{status}</AiMetricsText>
        {messages.map((message, index) => <View key={index} style={{ gap: 4 }}>
            <Text style={{ color: theme.textMuted, fontWeight: '600' }}>{message.role === 'user' ? 'You' : clientName}</Text>
            <Text selectable style={{ color: theme.text, lineHeight: 21 }}>{message.content}</Text>
        </View>)}
        {!!partial && <View style={{ gap: 4 }}>
            <AiMetricsText>Model output · In progress</AiMetricsText>
            <Text selectable style={{ color: theme.text, lineHeight: 21 }}>{partial}</Text>
        </View>}
        <TextInput accessibilityLabel={`Prompt for ${clientName}`} value={prompt} onChangeText={edit} multiline maxLength={8000} editable={!disabled}
            autoCapitalize='sentences' autoCorrect={false} autoComplete='off' spellCheck={false} placeholder='Enter a model test prompt'
            placeholderTextColor={theme.textSoft} style={{ color: theme.text, borderColor: theme.surfaceBorderSoft, borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 100 }} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <PillButton label='Review model test' disabled={disabled || !prompt.trim()} tone='accent' onPress={review} />
            {busy && <PillButton label='Stop listening' tone='danger' onPress={onStop} />}
            <PillButton label='Close test' onPress={onClose} />
        </View>
    </GlassCard>
}
