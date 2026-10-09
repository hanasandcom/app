import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { ArrowUp, Sparkles, Square } from 'lucide-react-native'
import type { AiChatMessage, AppSettings, DesktopAgentStatus, GptClient } from '../types'
import { askCodex, fetchDesktopAgentStatus, fetchDesktopScreenshot, runDesktopAgentCommand } from '../lib/api'
import { Screen } from '../components/ui'
import { spacing, type ThemePalette } from '../theme/tokens'
import { useAppTheme } from '../theme/context'

type GptSocketMessage =
  | { type: 'snapshot'; clients?: GptClient[] }
  | { type: 'update'; client?: GptClient }
  | { type: 'prompt_started'; conversationId?: string; clientName?: string | null }
  | { type: 'prompt_delta'; conversationId?: string; delta?: string }
  | { type: 'prompt_complete'; conversationId?: string }
  | { type: 'prompt_error'; conversationId?: string; error?: string }

function toWsUrl(apiBaseUrl: string) {
    const normalized = apiBaseUrl.trim().replace(/\/+$/, '')
    if (normalized.startsWith('https://')) return `wss://${normalized.slice('https://'.length)}`
    if (normalized.startsWith('http://')) {
        const url = new URL(normalized)
        const host = url.hostname.toLowerCase()
        const local = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local')
        if (!local) {
            throw new Error('Blocked insecure AI websocket. Use HTTPS for Hanasand services.')
        }
        return `ws://${normalized.slice('http://'.length)}`
    }
    return normalized
}

function formatDuration(durationMs?: number) {
    if (!durationMs) return ''
    if (durationMs < 1000) return `${Math.round(durationMs)} ms`
    return `${(durationMs / 1000).toFixed(1)} s`
}

export function HomeScreen({
    settings,
    aiMessages,
    onSaveAiMessages,
}: {
    settings: AppSettings
    aiMessages: AiChatMessage[]
    onSaveAiMessages: (messages: AiChatMessage[]) => Promise<void>
}) {
    const theme = useAppTheme()
    const styles = useMemo(() => createStyles(theme), [theme])
    const [prompt, setPrompt] = useState('')
    const [busy, setBusy] = useState(false)
    const [clients, setClients] = useState<GptClient[]>([])
    const [desktopStatus, setDesktopStatus] = useState<DesktopAgentStatus | null>(null)
    const [desktopIssue, setDesktopIssue] = useState('')
    const [desktopScreenshotUri, setDesktopScreenshotUri] = useState('')
    const [screenPreviewSize, setScreenPreviewSize] = useState({ width: 1, height: 1 })
    const [remoteKeyboardText, setRemoteKeyboardText] = useState('')
    const [remoteKeyboardVisible, setRemoteKeyboardVisible] = useState(false)
    const [remoteBusy, setRemoteBusy] = useState('')
    const remoteKeyboardInputRef = useRef<TextInput | null>(null)
    const activeConversationRef = useRef<string | null>(null)
    const socketRef = useRef<WebSocket | null>(null)
    const aiMessagesRef = useRef(aiMessages)
    const saveAiMessagesRef = useRef(onSaveAiMessages)
    const runTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        aiMessagesRef.current = aiMessages
    }, [aiMessages])

    useEffect(() => {
        saveAiMessagesRef.current = onSaveAiMessages
    }, [onSaveAiMessages])

    async function saveMessages(next: AiChatMessage[]) {
        aiMessagesRef.current = next
        await saveAiMessagesRef.current(next)
    }

    function clearRunTimeout() {
        if (runTimeoutRef.current) {
            clearTimeout(runTimeoutRef.current)
            runTimeoutRef.current = null
        }
    }

    function finishRun() {
        clearRunTimeout()
        activeConversationRef.current = null
        setBusy(false)
    }

    function startRunTimeout(conversationId: string) {
        clearRunTimeout()
        runTimeoutRef.current = setTimeout(() => {
            if (activeConversationRef.current !== conversationId) return
            finishRun()
            void saveMessages(aiMessagesRef.current.map(entry => entry.id === `${conversationId}-assistant`
                ? { ...entry, content: entry.content || 'The model did not finish this run in time.', pending: false, error: true }
                : entry))
        }, 90_000)
    }

    function failActiveSocketRun(message: string) {
        const conversationId = activeConversationRef.current
        if (!conversationId) return
        finishRun()
        void saveMessages(aiMessagesRef.current.map(entry => entry.id === `${conversationId}-assistant`
            ? { ...entry, content: entry.content || message, pending: false, error: true }
            : entry))
    }

    useEffect(() => clearRunTimeout, [])

    useEffect(() => {
        void refreshDesktopStatus(false)
    }, [settings.desktopAgentBaseUrl])

    useEffect(() => {
        if (!settings.apiBaseUrl.trim()) {
            socketRef.current?.close()
            socketRef.current = null
            setClients([])
            return
        }

        let socketUrl
        try {
            socketUrl = `${toWsUrl(settings.apiBaseUrl)}/client/ws/gpt`
        } catch {
            setClients([])
            return
        }

        const ws = new WebSocket(socketUrl)
        socketRef.current = ws

        ws.onclose = () => {
            socketRef.current = null
            failActiveSocketRun('The live model connection closed before the answer finished.')
        }
        ws.onerror = () => {
            failActiveSocketRun('The live model connection failed before the answer finished.')
        }
        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data) as GptSocketMessage
                if (message.type === 'snapshot') {
                    setClients(Array.isArray(message.clients) ? message.clients : [])
                    return
                }

                if (message.type === 'update' && message.client) {
                    setClients(current => {
                        const existing = current.find(client => client.name === message.client?.name)
                        return existing
                            ? current.map(client => client.name === message.client?.name ? (message.client as GptClient) : client)
                            : [...current, message.client as GptClient]
                    })
                    return
                }

                if (!('conversationId' in message) || !message.conversationId || message.conversationId !== activeConversationRef.current) {
                    return
                }

                if (message.type === 'prompt_started') {
                    const assistantId = `${message.conversationId}-assistant`
                    if (!aiMessagesRef.current.some(entry => entry.id === assistantId)) {
                        void saveMessages([
                            ...aiMessagesRef.current,
                            { id: assistantId, role: 'assistant', content: '', createdAt: Date.now(), pending: true },
                        ])
                    }
                    return
                }

                if (message.type === 'prompt_delta') {
                    const assistantId = `${message.conversationId}-assistant`
                    const current = aiMessagesRef.current
                    const next = current.some(entry => entry.id === assistantId)
                        ? current.map(entry => entry.id === assistantId
                            ? { ...entry, content: `${entry.content}${message.delta || ''}`, pending: true }
                            : entry)
                        : [
                            ...current,
                            { id: assistantId, role: 'assistant' as const, content: message.delta || '', createdAt: Date.now(), pending: true },
                        ]
                    void saveMessages(next)
                    return
                }

                if (message.type === 'prompt_complete') {
                    finishRun()
                    void saveMessages(aiMessagesRef.current.map(entry => entry.id === `${message.conversationId}-assistant` ? { ...entry, pending: false } : entry))
                    return
                }

                if (message.type === 'prompt_error') {
                    finishRun()
                    void saveMessages(aiMessagesRef.current.map(entry => entry.id === `${message.conversationId}-assistant`
                        ? { ...entry, content: message.error || 'The model failed to answer this prompt.', pending: false, error: true }
                        : entry))
                }
            } catch {
                failActiveSocketRun('The live model returned an unreadable response.')
            }
        }

        return () => ws.close()
    }, [settings.apiBaseUrl])

    const bestClient = useMemo(() => [...clients].sort((a, b) => (b.model?.tps || 0) - (a.model?.tps || 0))[0] || null, [clients])
    const latestMessages = useMemo(() => aiMessages.slice(-10), [aiMessages])
    async function refreshDesktopStatus(addChatMessage = true) {
        setDesktopIssue('')
        setRemoteBusy('pc')
        try {
            const status = await fetchDesktopAgentStatus(settings)
            setDesktopStatus(status)
            if (addChatMessage) {
                await saveMessages([
                    ...aiMessagesRef.current,
                    {
                        id: `${Date.now()}-assistant`,
                        role: 'assistant',
                        content: `This Mac is reachable: ${status.hostname || 'local host'} on ${status.platform || 'desktop'}${status.cwd ? `, cwd ${status.cwd}` : ''}.`,
                        createdAt: Date.now(),
                    },
                ])
            }
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : 'Desktop agent unavailable.'
            setDesktopIssue(message)
            if (addChatMessage) {
                await saveMessages([
                    ...aiMessagesRef.current,
                    { id: `${Date.now()}-assistant`, role: 'assistant', content: `Desktop agent is not connected yet: ${message}`, createdAt: Date.now(), error: true },
                ])
            }
        } finally {
            setRemoteBusy('')
        }
    }

    async function runRemoteDesktopCommand(command: string, label: string) {
        setDesktopIssue('')
        setRemoteBusy('rdp')
        try {
            const status = await runDesktopAgentCommand(settings, command)
            setDesktopStatus(status)
            await saveMessages([
                ...aiMessagesRef.current,
                {
                    id: `${Date.now()}-assistant`,
                    role: 'assistant',
                    content: `${label} sent to this Mac. ${status.message || 'Open Hanasand Desktop to see the reflected state.'}`,
                    createdAt: Date.now(),
                },
            ])
            if (desktopScreenshotUri) {
                setTimeout(() => void refreshDesktopScreenshot(), 350)
            }
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : `${label} failed.`
            setDesktopIssue(message)
        } finally {
            setRemoteBusy('')
        }
    }

    function desktopControlPromptFromText(value: string) {
        const trimmed = value.trim()
        const lower = trimmed.toLowerCase()
        if (lower.startsWith('codex:')) return trimmed.slice('codex:'.length).trim()
        if (lower.startsWith('codex ')) return trimmed.slice('codex '.length).trim()
        if (lower.startsWith('mac codex:')) return trimmed.slice('mac codex:'.length).trim()
        if (lower.includes(' on my pc') || lower.includes(' on this mac') || lower.includes(' on the mac')) return trimmed
        const actionPrefixes = [
            'open',
            'launch',
            'start',
            'visit',
            'go to',
            'search',
            'click',
            'type',
            'press',
            'move',
            'scroll',
            'close',
            'switch',
            'focus',
            'use',
            'show',
        ]
        const looksLikeDesktopAction = actionPrefixes.some(prefix => lower === prefix || lower.startsWith(`${prefix} `))
        if (looksLikeDesktopAction) {
            return [
                'Use this Mac like a desktop assistant.',
                'Infer the application, website, shell command, or UI action needed from the user request.',
                'Do not rely on hard-coded aliases; choose and execute the needed steps from context.',
                `User request: ${trimmed}`,
            ].join('\n')
        }
        return ''
    }

    async function runDesktopCodexPrompt(value: string) {
        const desktopPrompt = value.trim()
        if (!desktopPrompt) return
        setDesktopIssue('')
        setRemoteBusy('rdp')
        try {
            const status = await runDesktopAgentCommand(settings, `codex_prompt:${encodeURIComponent(desktopPrompt)}`)
            setDesktopStatus(status)
            const message = status.message || 'Codex prompt queued on this Mac.'
            await saveMessages([
                ...aiMessagesRef.current,
                {
                    id: `${Date.now()}-assistant`,
                    role: 'assistant',
                    content: `Mac Codex: ${message}`,
                    createdAt: Date.now(),
                },
            ])
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : 'Mac Codex prompt failed.'
            setDesktopIssue(message)
            await saveMessages([
                ...aiMessagesRef.current,
                { id: `${Date.now()}-assistant`, role: 'assistant', content: message, createdAt: Date.now(), error: true },
            ])
        } finally {
            setRemoteBusy('')
        }
    }

    async function refreshDesktopScreenshot() {
        setDesktopIssue('')
        setRemoteBusy('screen')
        try {
            const screenshot = await fetchDesktopScreenshot(settings)
            setDesktopScreenshotUri(`data:${screenshot.mimeType || 'image/png'};base64,${screenshot.imageBase64}`)
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : 'Mac screen capture failed.'
            setDesktopIssue(message)
        } finally {
            setRemoteBusy('')
        }
    }

    async function clickDesktopPreview(locationX: number, locationY: number) {
        const width = Math.max(screenPreviewSize.width, 1)
        const height = Math.max(screenPreviewSize.height, 1)
        const x = Math.min(Math.max(locationX / width, 0), 1).toFixed(4)
        const y = Math.min(Math.max(locationY / height, 0), 1).toFixed(4)
        await runRemoteDesktopCommand(`mac_control_pointer_click_at:${x}:${y}`, 'Preview click')
        await refreshDesktopScreenshot()
    }

    async function typeRemoteKeyboardText() {
        const value = remoteKeyboardText.trim()
        if (!value) {
            remoteKeyboardInputRef.current?.focus()
            return
        }
        await runRemoteDesktopCommand(`mac_control_type_text:${encodeURIComponent(value)}`, 'Type text')
        setRemoteKeyboardText('')
        await refreshDesktopScreenshot()
    }

    function showRemoteKeyboard() {
        setRemoteKeyboardVisible(true)
        setTimeout(() => {
            remoteKeyboardInputRef.current?.focus()
        }, 80)
    }

    async function submitPrompt() {
        const trimmed = prompt.trim()
        if (busy) return
        if (!trimmed) {
            Alert.alert('Empty prompt', 'Type a prompt first.')
            return
        }

        const userMessage: AiChatMessage = { id: `${Date.now()}-user`, role: 'user', content: trimmed, createdAt: Date.now() }
        const baseMessages = [...aiMessagesRef.current, userMessage]
        await saveMessages(baseMessages)
        setPrompt('')
        setBusy(true)

        const desktopCodexPrompt = desktopControlPromptFromText(trimmed)
        if (desktopCodexPrompt) {
            await runDesktopCodexPrompt(desktopCodexPrompt)
            setBusy(false)
            return
        }

        const socket = socketRef.current
        if (socket && socket.readyState === WebSocket.OPEN && bestClient) {
            const conversationId = `${Date.now()}-${Math.random().toString(16).slice(2)}`
            activeConversationRef.current = conversationId
            const withPending = [...baseMessages, { id: `${conversationId}-assistant`, role: 'assistant' as const, content: '', createdAt: Date.now(), pending: true }]
            await saveMessages(withPending)
            socket.send(JSON.stringify({
                type: 'prompt_request',
                conversationId,
                clientName: bestClient.name,
                messages: baseMessages.map(message => ({ role: message.role, content: message.content })),
                maxTokens: 512,
                temperature: 0.7,
            }))
            startRunTimeout(conversationId)
            return
        }

        try {
            const context = aiMessagesRef.current.slice(-10).map(message => `${message.role}: ${message.content}`).join('\n')
            const reply = await askCodex(settings, trimmed, context)
            await saveMessages([
                ...baseMessages,
                {
                    id: `${Date.now()}-assistant`,
                    role: 'assistant',
                    content: reply.message,
                    createdAt: Date.now(),
                    durationMs: reply.durationMs,
                    thoughtSummary: reply.thoughtSummary,
                    toolUses: reply.toolUses,
                    fileSummaries: reply.fileSummaries,
                },
            ])
        } catch (cause) {
            await saveMessages([
                ...baseMessages,
                { id: `${Date.now()}-assistant`, role: 'assistant', content: cause instanceof Error ? cause.message : 'Codex request failed.', createdAt: Date.now(), error: true },
            ])
        } finally {
            setBusy(false)
        }
    }

    return (
        <Screen title='Hanasand AI' subtitle='' scroll={false} contentStyle={styles.aiScreen}>
            <View style={styles.aiRoot}>
                <Pressable
                    accessibilityRole='button'
                    accessibilityLabel='Tap Mac screen preview to click the Mac'
                    disabled={!desktopScreenshotUri}
                    onLayout={event => setScreenPreviewSize(event.nativeEvent.layout)}
                    onPress={event => desktopScreenshotUri ? void clickDesktopPreview(event.nativeEvent.locationX, event.nativeEvent.locationY) : undefined}
                    style={({ pressed }) => [styles.macWindow, pressed && desktopScreenshotUri && styles.pressed]}
                >
                    {desktopScreenshotUri ? (
                        <Image source={{ uri: desktopScreenshotUri }} style={styles.macPreview} resizeMode='contain' />
                    ) : (
                        <View style={styles.macPlaceholder}>
                            <View style={[styles.infraDot, desktopStatus?.ok ? styles.infraDotLive : styles.infraDotIdle]} />
                            <Text style={styles.macStatusText} numberOfLines={2}>
                                {desktopStatus?.ok
                                    ? `${desktopStatus.hostname || 'Mac'} · ${desktopStatus.platform || 'desktop'}`
                                    : desktopIssue || 'Mac agent checking'}
                            </Text>
                        </View>
                    )}
                </Pressable>

                <View style={styles.remoteButtonRow}>
                    <Pressable
                        accessibilityRole='button'
                        accessibilityLabel='Refresh Mac screen for mouse control'
                        disabled={remoteBusy === 'screen'}
                        onPress={() => void refreshDesktopScreenshot()}
                        style={({ pressed }) => [styles.remoteButton, remoteBusy === 'screen' && styles.disabled, pressed && remoteBusy !== 'screen' && styles.pressed]}
                    >
                        <Text style={styles.remoteButtonText}>{remoteBusy === 'screen' ? 'Loading...' : 'Mouse'}</Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole='button'
                        accessibilityLabel='Show remote keyboard controls'
                        onPress={showRemoteKeyboard}
                        style={({ pressed }) => [styles.remoteButton, remoteKeyboardVisible && styles.remoteButtonActive, pressed && styles.pressed]}
                    >
                        <Text style={styles.remoteButtonText}>Keyboard</Text>
                    </Pressable>
                </View>

                {desktopStatus?.ok && (desktopStatus.screenCaptureAllowed === false || desktopStatus.accessibilityAllowed === false) && (
                    <Pressable
                        accessibilityRole='button'
                        accessibilityLabel='Open Mac remote-control privacy permissions'
                        onPress={() => void runRemoteDesktopCommand('mac_control_authorize', 'Authorize Mac')}
                        style={({ pressed }) => [styles.permissionLine, pressed && styles.pressed]}
                    >
                        <Text style={styles.permissionText} numberOfLines={1}>
                            {desktopStatus.screenCaptureAllowed === false && desktopStatus.accessibilityAllowed === false
                                ? 'Needs Screen Recording + Accessibility'
                                : desktopStatus.screenCaptureAllowed === false
                                    ? 'Needs Screen Recording'
                                    : 'Needs Accessibility'}
                        </Text>
                        <Text style={styles.remoteMiniButtonText}>Open</Text>
                    </Pressable>
                )}

                {remoteKeyboardVisible && (
                    <View style={styles.remoteKeyboardPanel}>
                        <View style={styles.remoteKeyboardPanelHeader}>
                            <Text style={styles.remoteKeyboardTitle}>Remote keyboard</Text>
                            <Pressable
                                accessibilityRole='button'
                                accessibilityLabel='Hide remote keyboard controls'
                                onPress={() => setRemoteKeyboardVisible(false)}
                                style={({ pressed }) => [styles.remoteMiniButton, pressed && styles.pressed]}
                            >
                                <Text style={styles.remoteMiniButtonText}>Hide</Text>
                            </Pressable>
                        </View>
                        <View style={styles.remoteKeyboardBar}>
                            <TextInput
                                ref={remoteKeyboardInputRef}
                                value={remoteKeyboardText}
                                onChangeText={setRemoteKeyboardText}
                                placeholder='Type on Mac...'
                                placeholderTextColor={theme.textSoft}
                                style={styles.remoteKeyboardInput}
                                autoCapitalize='none'
                                autoCorrect={false}
                                returnKeyType='send'
                                onSubmitEditing={() => void typeRemoteKeyboardText()}
                            />
                            <Pressable
                                accessibilityRole='button'
                                accessibilityLabel='Type text on Mac'
                                onPress={() => void typeRemoteKeyboardText()}
                                style={({ pressed }) => [styles.remoteKeyButton, pressed && styles.pressed]}
                            >
                                <Text style={styles.remoteButtonText}>Type</Text>
                            </Pressable>
                        </View>
                    </View>
                )}

                <ScrollView style={styles.chatScroll} contentContainerStyle={styles.chatContent}>
                    {latestMessages.length ? latestMessages.map(message => (
                        <View
                            key={message.id}
                            style={[
                                styles.chatBubble,
                                message.role === 'user' ? styles.userBubble : styles.assistantBubble,
                                message.error && styles.errorBubble,
                            ]}
                        >
                            <Text style={styles.chatRole}>{message.role === 'user' ? 'You' : 'Hanasand AI'}</Text>
                            <Text style={styles.chatText}>{message.content || (message.pending ? 'Thinking...' : '')}</Text>
                            {message.role === 'assistant' && !!message.durationMs && (
                                <Text style={styles.detailText}>Worked for {formatDuration(message.durationMs)}</Text>
                            )}
                            {message.role === 'assistant' && !!message.thoughtSummary && (
                                <View style={styles.detailBox}>
                                    <Text style={styles.detailLabel}>Summary</Text>
                                    <Text style={styles.detailText}>{message.thoughtSummary}</Text>
                                </View>
                            )}
                            {message.role === 'assistant' && !!message.toolUses?.length && (
                                <View style={styles.detailBox}>
                                    <Text style={styles.detailLabel}>Tools</Text>
                                    {message.toolUses.map((tool, index) => (
                                        <Text key={`${tool.name}-${index}`} style={styles.detailText}>
                                            {tool.name}{tool.durationMs ? ` · ${formatDuration(tool.durationMs)}` : ''}{tool.summary ? `: ${tool.summary}` : ''}
                                        </Text>
                                    ))}
                                </View>
                            )}
                            {message.role === 'assistant' && !!message.fileSummaries?.length && (
                                <View style={styles.detailBox}>
                                    <Text style={styles.detailLabel}>Files</Text>
                                    {message.fileSummaries.map((file, index) => (
                                        <Text key={`${file.path}-${index}`} style={styles.detailText}>
                                            {file.path}{typeof file.additions === 'number' || typeof file.deletions === 'number'
                                                ? ` +${file.additions || 0} -${file.deletions || 0}`
                                                : ''}{file.summary ? `: ${file.summary}` : ''}
                                        </Text>
                                    ))}
                                </View>
                            )}
                        </View>
                    )) : (
                        <Text style={styles.emptyChat}>Ask something above. Replies, errors, and pending runs will stay here.</Text>
                    )}
                </ScrollView>

                <View style={styles.promptShell}>
                    <Sparkles color={theme.textMuted} size={15} strokeWidth={2.1} />
                    <TextInput
                        value={prompt}
                        onChangeText={setPrompt}
                        placeholder='Ask Hanasand AI...'
                        placeholderTextColor={theme.textSoft}
                        style={styles.promptInput}
                        returnKeyType='send'
                        onSubmitEditing={() => void submitPrompt()}
                        autoFocus
                    />
                    {prompt.trim() ? (
                        <Pressable
                            disabled={busy}
                            accessibilityRole='button'
                            accessibilityLabel='Send prompt'
                            accessibilityState={{ disabled: busy }}
                            onPress={() => void submitPrompt()}
                            style={({ pressed }) => [styles.promptArrowButton, busy && styles.disabled, pressed && !busy && styles.pressed]}
                        >
                            {busy ? <Square color={theme.background} size={12} fill={theme.background} /> : <ArrowUp color={theme.background} size={14} strokeWidth={2.7} />}
                        </Pressable>
                    ) : null}
                </View>
            </View>
        </Screen>
    )
}

function createStyles(theme: ThemePalette) {
    return StyleSheet.create({
        aiScreen: { flex: 1, paddingBottom: 96, gap: 0 },
        aiRoot: { flex: 1, gap: 8 },
        macWindow: {
            minHeight: 78,
            maxHeight: 128,
            borderRadius: 22,
            borderWidth: 1,
            borderColor: theme.surfaceBorderSoft,
            backgroundColor: `${theme.backgroundRaised}cc`,
            overflow: 'hidden',
        },
        macPreview: { width: '100%', height: 118 },
        macPlaceholder: {
            flex: 1,
            minHeight: 78,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 14,
        },
        macStatusText: { flex: 1, color: theme.textMuted, fontSize: 12, lineHeight: 16 },
        promptShell: {
            width: '100%',
            minHeight: 46,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: theme.surfaceBorderSoft,
            backgroundColor: `${theme.backgroundRaised}ee`,
            paddingHorizontal: 12,
        },
        promptInput: { flex: 1, color: theme.text, fontSize: 14, paddingVertical: 10, fontWeight: '400' },
        promptArrowButton: {
            width: 30,
            height: 30,
            borderRadius: 15,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.text,
            borderWidth: 1,
            borderColor: theme.text,
        },
        disabled: { opacity: 0.55 },
        infraDot: { width: 9, height: 9, borderRadius: 9 },
        infraDotLive: { backgroundColor: theme.success },
        infraDotIdle: { backgroundColor: theme.textMuted },
        permissionLine: {
            minHeight: 32,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: `${theme.danger}66`,
            backgroundColor: `${theme.danger}12`,
            paddingHorizontal: 12,
        },
        permissionText: { flex: 1, color: theme.textMuted, fontSize: 11, fontWeight: '500' },
        remoteButtonRow: {
            flexDirection: 'row',
            gap: 8,
        },
        remoteButton: {
            minHeight: 32,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: theme.surfaceBorderSoft,
            backgroundColor: `${theme.backgroundRaised}a8`,
            paddingHorizontal: 14,
            alignItems: 'center',
            justifyContent: 'center',
        },
        remoteButtonText: { color: theme.text, fontSize: 12, fontWeight: '600' },
        remoteButtonActive: { borderColor: theme.accent, backgroundColor: theme.accentSoft },
        remoteKeyboardPanel: {
            borderRadius: 16,
            borderWidth: 1,
            borderColor: theme.surfaceBorderSoft,
            backgroundColor: `${theme.backgroundRaised}a8`,
            padding: 8,
        },
        remoteKeyboardPanelHeader: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
        },
        remoteKeyboardTitle: {
            color: theme.textMuted,
            fontSize: 10,
            fontWeight: '600',
            textTransform: 'uppercase',
            letterSpacing: 1,
        },
        remoteMiniButton: {
            minHeight: 28,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: theme.surfaceBorderSoft,
            paddingHorizontal: spacing.sm,
            alignItems: 'center',
            justifyContent: 'center',
        },
        remoteMiniButtonText: { color: theme.textMuted, fontSize: 11, fontWeight: '600' },
        remoteKeyboardBar: {
            flexDirection: 'row',
            gap: 8,
            alignItems: 'center',
            marginTop: 8,
        },
        remoteKeyboardInput: {
            flex: 1,
            minHeight: 34,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: theme.surfaceBorderSoft,
            backgroundColor: theme.backgroundRaised,
            color: theme.text,
            paddingHorizontal: 12,
            fontSize: 12,
            fontWeight: '400',
        },
        remoteKeyButton: {
            minHeight: 34,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: theme.surfaceBorderSoft,
            backgroundColor: theme.backgroundRaised,
            paddingHorizontal: 12,
            alignItems: 'center',
            justifyContent: 'center',
        },
        chatScroll: { flex: 1 },
        chatContent: { gap: 10, paddingVertical: 6 },
        chatBubble: {
            gap: 4,
            maxWidth: '94%',
        },
        userBubble: {
            alignSelf: 'flex-end',
            borderRadius: 15,
            borderWidth: 1,
            backgroundColor: theme.accentSoft,
            borderColor: theme.accent,
            paddingHorizontal: 12,
            paddingVertical: 9,
        },
        assistantBubble: {
            alignSelf: 'flex-start',
            backgroundColor: 'transparent',
            borderColor: 'transparent',
        },
        errorBubble: {
            borderRadius: 15,
            borderWidth: 1,
            borderColor: theme.danger,
            backgroundColor: `${theme.danger}22`,
            paddingHorizontal: 12,
            paddingVertical: 9,
        },
        chatRole: {
            color: theme.textSoft,
            fontSize: 9,
            fontWeight: '500',
            textTransform: 'uppercase',
            letterSpacing: 1.2,
        },
        chatText: { color: theme.text, fontSize: 13, lineHeight: 18, fontWeight: '400' },
        detailBox: {
            gap: 4,
            marginTop: 6,
            paddingTop: 2,
        },
        detailLabel: {
            color: theme.textSoft,
            fontSize: 9,
            fontWeight: '600',
            textTransform: 'uppercase',
            letterSpacing: 1.2,
        },
        detailText: { color: theme.textMuted, fontSize: 11, lineHeight: 16 },
        emptyChat: { color: theme.textMuted, fontSize: 13, lineHeight: 18, marginTop: 8 },
        pressed: { opacity: 0.9, transform: [{ scale: 0.98 }] },
    })
}
