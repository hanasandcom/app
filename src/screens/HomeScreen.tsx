import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { randomUUID } from 'expo-crypto'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { ArrowUp, Sparkles } from 'lucide-react-native'
import type { AiChatMessage, AppSettings, DesktopAgentStatus } from '../types'
import { fetchDesktopAgentStatus, fetchDesktopScreenshot, isHanasandOrganizationMember, runDesktopAgentCommand } from '../lib/api'
import { InlineNotice, PillButton, Screen } from '../components/ui'
import { createAiConversation, fetchAiWorkspace, fetchChatGptActivity, submitChatGptPrompt, portalMessages, conversationContext, newConversation, nextAiMessageTimestamp, persistAiMessage, runHanasandPrompt, type AiConversation, type WorkspaceMessage, type PromptPortalItem } from '../lib/ai-workspace'
import { spacing, type ThemePalette } from '../theme/tokens'
import { useAppTheme } from '../theme/context'

function formatDuration(durationMs?: number) {
    if (!durationMs) return ''
    if (durationMs < 1000) return `${Math.round(durationMs)} ms`
    return `${(durationMs / 1000).toFixed(1)} s`
}

export function HomeScreen({
    settings,
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
    const [canUseChatGpt, setCanUseChatGpt] = useState(false)
    const [selectedAgent, setSelectedAgent] = useState<'hanasand' | 'chatgpt'>('hanasand')
    const [conversations, setConversations] = useState<AiConversation[]>([])
    const [activeConversationId, setActiveConversationId] = useState('')
    const [workspaceLoading, setWorkspaceLoading] = useState(true)
    const [workspaceError, setWorkspaceError] = useState('')
    const [historyVisible, setHistoryVisible] = useState(false)
    const [workspaceRevision, setWorkspaceRevision] = useState(0)
    const [portalItems, setPortalItems] = useState<PromptPortalItem[]>([])
    const [portalError, setPortalError] = useState('')
    const [portalUncertain, setPortalUncertain] = useState(false)
    const [portalRefreshing, setPortalRefreshing] = useState(false)
    const [portalReady, setPortalReady] = useState(false)
    const [portalRevision, setPortalRevision] = useState(0)
    const [desktopStatus, setDesktopStatus] = useState<DesktopAgentStatus | null>(null)
    const [desktopIssue, setDesktopIssue] = useState('')
    const [desktopScreenshotUri, setDesktopScreenshotUri] = useState('')
    const [screenPreviewSize, setScreenPreviewSize] = useState({ width: 1, height: 1 })
    const [remoteKeyboardText, setRemoteKeyboardText] = useState('')
    const [remoteKeyboardVisible, setRemoteKeyboardVisible] = useState(false)
    const [remoteBusy, setRemoteBusy] = useState('')
    const desktopConnectionLabel = desktopStatus?.ok
        ? `${desktopStatus.hostname || 'Mac'} · ${desktopStatus.platform || 'desktop'}`
        : desktopIssue || (remoteBusy === 'pc' ? 'Connecting to desktop…' : 'Desktop not connected')
    const remoteKeyboardInputRef = useRef<TextInput | null>(null)
    const aiMessagesRef = useRef<WorkspaceMessage[]>([])
    const saveAiMessagesRef = useRef(onSaveAiMessages)
    const conversationsRef = useRef<AiConversation[]>([])
    const selectedConversationRef = useRef('')
    const persistedConversationIds = useRef(new Set<string>())
    const runControllerRef = useRef<AbortController | null>(null)
    const mountedRef = useRef(true)
    const portalItemsRef = useRef<PromptPortalItem[]>([])
    const portalConversationRef = useRef('')
    const submittingRef = useRef(false)
    const pendingMessageSync = useRef(new Map<string, { conversationId: string; message: WorkspaceMessage }>())
    const messageSyncQueue = useRef<Promise<void>>(Promise.resolve())
    const workspaceAccountRef = useRef('')
    const preferenceKey = `hanasand-mobile/ai-active/${settings.userId}/${settings.selectedOrganizationId || 'personal'}`
    const activeConversation = conversations.find(item => item.id === activeConversationId)
    const latestMessages = selectedAgent === 'chatgpt' ? portalMessages(portalItems) : activeConversation?.messages || []
    const readOnly = activeConversation?.collaboration?.role === 'reviewer'

    useEffect(() => { saveAiMessagesRef.current = onSaveAiMessages }, [onSaveAiMessages])
    useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; runControllerRef.current?.abort() } }, [])
    useEffect(() => { void refreshDesktopStatus(false) }, [settings.desktopAgentBaseUrl])
    useEffect(() => {
        let active = true
        setCanUseChatGpt(false)
        void isHanasandOrganizationMember(settings).then(value => { if (active) setCanUseChatGpt(value) }).catch(() => {})
        return () => { active = false }
    }, [settings.apiBaseUrl, settings.authToken, settings.userId])

    useEffect(() => { if (!canUseChatGpt) setSelectedAgent('hanasand') }, [canUseChatGpt])

    function updateConversations(next: AiConversation[]) {
        conversationsRef.current = next
        if (mountedRef.current) setConversations(next)
    }
    function selectConversation(id: string, values = conversationsRef.current) {
        const conversation = values.find(item => item.id === id)
        if (!conversation) return
        selectedConversationRef.current = id
        aiMessagesRef.current = conversation.messages
        setActiveConversationId(id)
        setHistoryVisible(false)
        setPrompt('')
        setPortalUncertain(false)
        void AsyncStorage.setItem(preferenceKey, id).catch(() => {})
        void saveAiMessagesRef.current(conversation.messages.filter((message): message is WorkspaceMessage & AiChatMessage => message.role !== 'tool')).catch(() => {})
    }
    useEffect(() => {
        const controller = new AbortController()
        setWorkspaceLoading(true)
        setWorkspaceError('')
        const account = `${settings.userId}:${settings.impersonatingUserId || ''}`
        if (workspaceAccountRef.current !== account) {
            workspaceAccountRef.current = account
            pendingMessageSync.current.clear()
            selectedConversationRef.current = ''
            aiMessagesRef.current = []
            updateConversations([])
            setActiveConversationId('')
        }
        runControllerRef.current?.abort()
        void fetchAiWorkspace(settings, controller.signal).then(async values => {
            const savedId = await AsyncStorage.getItem(preferenceKey).catch(() => '')
            if (controller.signal.aborted) return
            persistedConversationIds.current = new Set(values.map(item => item.id))
            for (const pending of pendingMessageSync.current.values()) {
                const conversation = values.find(item => item.id === pending.conversationId)
                if (conversation) conversation.messages = [...conversation.messages.filter(item => item.id !== pending.message.id), pending.message].sort((a, b) => a.createdAt - b.createdAt)
            }
            const available = values.filter(item => !item.archivedAt)
            const next = available.length ? values : [newConversation(), ...values]
            updateConversations(next)
            const preferred = [selectedConversationRef.current, savedId].find(id => next.some(item => item.id === id && !item.archivedAt))
            selectConversation(preferred || next.find(item => !item.archivedAt)!.id, next)
        }).catch(cause => {
            if (!controller.signal.aborted) setWorkspaceError(cause instanceof Error ? cause.message : 'Could not load conversations.')
        }).finally(() => { if (!controller.signal.aborted) setWorkspaceLoading(false) })
        return () => controller.abort()
    }, [settings.siteBaseUrl, settings.authToken, settings.userId, settings.impersonatingUserId, settings.selectedOrganizationId, workspaceRevision])

    function updatePortal(items: PromptPortalItem[]) { portalItemsRef.current = items; setPortalItems(items) }
    useEffect(() => {
        const controller = new AbortController()
        let timer: ReturnType<typeof setTimeout> | undefined
        if (portalConversationRef.current !== activeConversationId) {
            portalConversationRef.current = activeConversationId
            updatePortal([])
        }
        setPortalError('')
        setPortalReady(false)
        setPortalRefreshing(false)
        if (selectedAgent !== 'chatgpt' || !canUseChatGpt || !activeConversationId || !persistedConversationIds.current.has(activeConversationId)) return () => controller.abort()
        const refresh = async () => {
            setPortalRefreshing(true)
            try {
                const items = await fetchChatGptActivity(settings, activeConversationId, controller.signal)
                if (controller.signal.aborted) return
                updatePortal(items)
                setPortalError('')
                setPortalUncertain(false)
                setPortalReady(true)
            } catch (cause) {
                if (!controller.signal.aborted) setPortalError(cause instanceof Error ? cause.message : 'Could not refresh ChatGPT activity.')
            } finally {
                if (!controller.signal.aborted) {
                    setPortalRefreshing(false)
                    timer = setTimeout(() => void refresh(), portalItemsRef.current.some(item => item.status === 'queued' || item.status === 'running') ? 4000 : 15000)
                }
            }
        }
        void refresh()
        return () => { controller.abort(); if (timer) clearTimeout(timer) }
    }, [selectedAgent, canUseChatGpt, activeConversationId, settings.siteBaseUrl, settings.authToken, settings.userId, portalRevision])

    async function ensureConversation(title: string) {
        let conversation = conversationsRef.current.find(item => item.id === selectedConversationRef.current)
        if (!conversation) {
            conversation = newConversation()
            updateConversations([conversation, ...conversationsRef.current])
            selectConversation(conversation.id)
        }
        if (!persistedConversationIds.current.has(conversation.id)) {
            conversation = await createAiConversation(settings, { ...conversation, title: title.slice(0, 72) || 'New chat' })
            persistedConversationIds.current.add(conversation.id)
            updateConversations(conversationsRef.current.map(item => item.id === conversation!.id ? conversation! : item))
        }
        return conversation
    }
    async function saveMessages(next: WorkspaceMessage[], persist = true) {
        const id = selectedConversationRef.current
        const previous = aiMessagesRef.current
        aiMessagesRef.current = next
        updateConversations(conversationsRef.current.map(item => item.id === id ? { ...item, messages: next, updatedAt: new Date().toISOString() } : item))
        if (!persist) return
        await saveAiMessagesRef.current(next.filter((message): message is WorkspaceMessage & AiChatMessage => message.role !== 'tool')).catch(() => {})
        if (!persistedConversationIds.current.has(id)) return
        const changed = next.filter(message => JSON.stringify(previous.find(item => item.id === message.id)) !== JSON.stringify(message))
        for (const message of changed) pendingMessageSync.current.set(`${id}:${message.id}`, { conversationId: id, message })
        try { await syncPendingMessages() }
        catch (cause) { if (mountedRef.current) setWorkspaceError(cause instanceof Error ? cause.message : 'Chat history could not be synced.') }
    }
    function syncPendingMessages() {
        const next = messageSyncQueue.current.catch(() => {}).then(async () => {
            await Promise.all([...pendingMessageSync.current.entries()].map(async ([key, entry]) => {
                await persistAiMessage(settings, entry.conversationId, entry.message)
                if (pendingMessageSync.current.get(key) === entry) pendingMessageSync.current.delete(key)
            }))
        })
        messageSyncQueue.current = next
        return next
    }
    async function refreshWorkspace() {
        try {
            await syncPendingMessages()
            setWorkspaceRevision(value => value + 1)
        } catch (cause) { setWorkspaceError(cause instanceof Error ? cause.message : 'Chat history could not be synced.') }
    }
    function startNewConversation() {
        const existing = conversationsRef.current.find(item => !persistedConversationIds.current.has(item.id) && !item.messages.length)
        const conversation = existing || newConversation()
        if (!existing) updateConversations([conversation, ...conversationsRef.current])
        selectConversation(conversation.id)
    }

    async function refreshDesktopStatus(explicit = false) {
        setDesktopIssue('')
        setRemoteBusy('pc')
        try {
            setDesktopStatus(await fetchDesktopAgentStatus(settings))
        } catch (cause) {
            setDesktopStatus(null)
            if (explicit) setDesktopIssue(cause instanceof Error ? cause.message : 'Desktop connection failed.')
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
                    createdAt: nextAiMessageTimestamp(aiMessagesRef.current),
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
                    createdAt: nextAiMessageTimestamp(aiMessagesRef.current),
                },
            ])
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : 'Mac Codex prompt failed.'
            setDesktopIssue(message)
            await saveMessages([
                ...aiMessagesRef.current,
                { id: `${Date.now()}-assistant`, role: 'assistant', content: message, createdAt: nextAiMessageTimestamp(aiMessagesRef.current), error: true },
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
        if (submittingRef.current || busy || workspaceLoading || readOnly || (selectedAgent === 'chatgpt' && (portalUncertain || (persistedConversationIds.current.has(activeConversationId) && !portalReady)))) return
        if (selectedAgent === 'hanasand' && activeConversation?.messages.some(message => message.pending)) { setWorkspaceError('A response is pending in this conversation. Refresh before sending another prompt.'); return }
        if (!trimmed) { Alert.alert('Empty prompt', 'Type a prompt first.'); return }
        submittingRef.current = true
        setBusy(true)
        setWorkspaceError('')
        const controller = new AbortController()
        runControllerRef.current = controller
        let assistant: WorkspaceMessage | undefined
        let conversation: AiConversation | undefined
        try {
            conversation = await ensureConversation(trimmed)
            if (controller.signal.aborted) return
            const context = conversationContext(conversation.messages, portalItemsRef.current)
            const desktopCodexPrompt = desktopControlPromptFromText(trimmed)
            if (desktopCodexPrompt) {
                await saveMessages([...aiMessagesRef.current, { id: randomUUID(), role: 'user', content: trimmed, createdAt: nextAiMessageTimestamp(aiMessagesRef.current) }])
                setPrompt('')
                await runDesktopCodexPrompt(desktopCodexPrompt)
                return
            }
            if (selectedAgent === 'chatgpt' && canUseChatGpt) {
                try {
                    const items = await submitChatGptPrompt(settings, conversation.id, trimmed, context, controller.signal)
                    if (!controller.signal.aborted) { updatePortal(items); setPrompt(''); setPortalError(''); setPortalRevision(value => value + 1) }
                } catch (cause) {
                    if (!controller.signal.aborted) {
                        setPortalUncertain(true)
                        setPortalError(`${cause instanceof Error ? cause.message : 'Could not confirm submission.'} Refresh activity to check this request before sending again.`)
                    }
                }
                return
            }
            const userMessage: WorkspaceMessage = { id: randomUUID(), role: 'user', content: trimmed, createdAt: nextAiMessageTimestamp(aiMessagesRef.current) }
            assistant = { id: randomUUID(), role: 'assistant', content: 'Connecting to Hanasand GPT…', createdAt: userMessage.createdAt + 1, pending: true, modelName: 'Hanasand GPT' }
            await saveMessages([...aiMessagesRef.current, userMessage, assistant])
            setPrompt('')
            const assistantId = assistant.id
            const reply = await runHanasandPrompt(settings, conversation.id, trimmed, context, content => {
                if (!controller.signal.aborted) void saveMessages(aiMessagesRef.current.map(item => item.id === assistantId ? { ...item, content, pending: true } : item), false)
            }, controller.signal)
            if (!controller.signal.aborted) await saveMessages(aiMessagesRef.current.map(item => item.id === assistantId ? { ...item, content: reply.message, pending: false, durationMs: reply.durationMs, thoughtSummary: reply.thoughtSummary, toolUses: reply.toolUses, fileSummaries: reply.fileSummaries } : item))
        } catch (cause) {
            const content = controller.signal.aborted ? 'The live response connection ended on this device. Refresh the conversation before sending again.' : cause instanceof Error ? cause.message : 'The AI request failed.'
            if (assistant && conversation) {
                const failed = { ...assistant, content, pending: false, error: true }
                if (mountedRef.current && selectedConversationRef.current === conversation.id) await saveMessages(aiMessagesRef.current.map(item => item.id === assistant!.id ? failed : item))
                else await persistAiMessage(settings, conversation.id, failed).catch(() => {})
            } else if (!controller.signal.aborted) setWorkspaceError(content)
        } finally {
            submittingRef.current = false
            if (mountedRef.current) setBusy(false)
            if (runControllerRef.current === controller) runControllerRef.current = null
        }
    }

    return (
        <Screen title='Hanasand AI' subtitle='' scroll={false} contentStyle={styles.aiScreen}>
            <View style={styles.aiRoot}>
                <View style={styles.remoteButtonRow}>
                    <PillButton small label='Conversations' disabled={busy || workspaceLoading} onPress={() => setHistoryVisible(value => !value)} />
                    <PillButton small label='New chat' disabled={busy || workspaceLoading} onPress={startNewConversation} />
                    <PillButton small label={pendingMessageSync.current.size ? 'Retry sync' : 'Refresh'} disabled={busy || workspaceLoading} onPress={() => void refreshWorkspace()} />
                </View>
                {!!activeConversation && <Text numberOfLines={1} style={styles.conversationTitle}>{activeConversation.title}</Text>}
                <InlineNotice message={workspaceError} />
                {workspaceLoading && <Text style={styles.emptyChat}>Loading conversations…</Text>}
                {historyVisible && <ScrollView style={{ maxHeight: 180 }} contentContainerStyle={{ gap: 6 }}>
                    {conversations.filter(item => !item.archivedAt).map(item => <PillButton key={item.id} label={item.title} tone={item.id === activeConversationId ? 'accent' : 'default'} onPress={() => selectConversation(item.id)} />)}
                </ScrollView>}
                {readOnly && <Text style={styles.emptyChat}>This shared conversation has reviewer access.</Text>}
                {selectedAgent === 'chatgpt' && <>
                    <InlineNotice message={portalError} />
                    <View style={styles.remoteButtonRow}>
                        <Text style={[styles.macStatusText, { alignSelf: 'center' }]}>{portalItems.filter(item => item.status === 'queued').length} queued · {portalItems.filter(item => item.status === 'running').length} running</Text>
                        <PillButton small label={portalRefreshing ? 'Refreshing…' : 'Refresh activity'} disabled={portalRefreshing || busy} onPress={() => setPortalRevision(value => value + 1)} />
                    </View>
                </>}

                <Pressable
                    accessibilityRole='button'
                    accessibilityLabel={desktopScreenshotUri ? 'Tap Mac screen preview to click the Mac' : desktopConnectionLabel}
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
                            <Text style={styles.macStatusText}>{desktopConnectionLabel}</Text>
                        </View>
                    )}
                </Pressable>

                <View style={styles.remoteButtonRow}>
                    <PillButton small label={desktopStatus?.ok ? 'Refresh desktop' : 'Connect desktop'} disabled={!!remoteBusy} onPress={() => void refreshDesktopStatus(true)} />
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
                            <Text style={styles.chatRole}>{message.role === 'user' ? 'You' : message.modelName || (selectedAgent === 'chatgpt' ? 'ChatGPT' : 'Hanasand GPT')}</Text>
                            <Text selectable style={styles.chatText}>{message.content || (message.pending ? 'Thinking...' : '')}</Text>
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
                        <Text style={styles.emptyChat}>Start a conversation or choose a previous chat.</Text>
                    )}
                </ScrollView>

                {canUseChatGpt && (
                    <View style={{ flexDirection: 'row', alignSelf: 'flex-start', gap: 8, marginBottom: 2 }}>
                        {([['hanasand', 'Hanasand GPT'], ['chatgpt', 'ChatGPT']] as const).map(([agent, label]) => (
                            <Pressable key={agent} accessibilityRole='button' accessibilityState={{ selected: selectedAgent === agent }} disabled={busy} onPress={() => { setSelectedAgent(agent) }} style={{ borderRadius: 999, borderWidth: 1, borderColor: selectedAgent === agent ? theme.accent : theme.surfaceBorderSoft, backgroundColor: selectedAgent === agent ? theme.accentSoft : theme.ambientNeutral, paddingHorizontal: 12, paddingVertical: 7 }}>
                                <Text style={{ color: theme.text, fontSize: 12, fontWeight: '700' }}>{label}</Text>
                            </Pressable>
                        ))}
                    </View>
                )}
                <View style={styles.promptShell}>
                    <Sparkles color={theme.textMuted} size={15} strokeWidth={2.1} />
                    <TextInput
                        value={prompt}
                        onChangeText={setPrompt}
                        placeholder={selectedAgent === 'chatgpt' ? 'Ask ChatGPT…' : 'Ask Hanasand GPT…'}
                        placeholderTextColor={theme.textSoft}
                        style={styles.promptInput}
                        returnKeyType='send'
                        onSubmitEditing={() => void submitPrompt()}
                    />
                    {prompt.trim() ? (
                        <Pressable
                            disabled={busy || workspaceLoading || readOnly || (selectedAgent === 'chatgpt' && (portalUncertain || (persistedConversationIds.current.has(activeConversationId) && !portalReady)))}
                            accessibilityRole='button'
                            accessibilityLabel='Send prompt'
                            accessibilityState={{ disabled: busy || workspaceLoading || readOnly || (selectedAgent === 'chatgpt' && (portalUncertain || (persistedConversationIds.current.has(activeConversationId) && !portalReady))) }}
                            onPress={() => void submitPrompt()}
                            style={({ pressed }) => [styles.promptArrowButton, busy && styles.disabled, pressed && !busy && styles.pressed]}
                        >
                            {busy ? <ActivityIndicator color={theme.background} size='small' /> : <ArrowUp color={theme.background} size={14} strokeWidth={2.7} />}
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
            minHeight: 44,
            borderRadius: 22,
            borderWidth: 1,
            borderColor: theme.surfaceBorderSoft,
            backgroundColor: `${theme.backgroundRaised}cc`,
            overflow: 'hidden',
        },
        macPreview: { width: '100%', height: 118 },
        macPlaceholder: {
            flex: 1,
            minHeight: 44,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 14,
        },
        conversationTitle: { color: theme.textMuted, fontSize: 12, lineHeight: 16 },
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
