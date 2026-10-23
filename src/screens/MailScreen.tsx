import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, BackHandler, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { ChevronDown, Mail, Paperclip, RefreshCw, Search, Star } from 'lucide-react-native'
import * as Sharing from 'expo-sharing'
import type { AppSettings } from '../types'
import { addMailFolder, canSendMail, createMailComposer, editMailComposer, hasMailDraftContent, pickMailAttachments, loadMail, loadMailPage, saveMailAttachment, searchMail, sendMail, updateMail, type MailAction, type MailAttachment, type MailDraft, type MailMessage, type MailOverview, type MailScope } from '../lib/mail-api'
import { GlassCard, InlineNotice, PillButton, Screen, SectionTitle } from '../components/ui'
import { spacing, type ThemePalette } from '../theme/tokens'
import { useAppTheme } from '../theme/context'

const recipients = (items: MailMessage['from']) => items.map(item => item.name ? `${item.name} <${item.email}>` : item.email).join(', ')
const errorMessage = (cause: unknown) => {
    if (!(cause instanceof Error)) return 'Unable to complete this request.'
    if (/socket connection was closed unexpectedly|backend service is unavailable|network request failed|fetch failed/i.test(cause.message)) {
        return 'Mail service is temporarily unavailable. Please try again shortly.'
    }
    return cause.message
}
const senderName = (message: MailMessage) => message.from[0]?.name || message.from[0]?.email || 'Unknown sender'
const senderInitial = (message: MailMessage) => senderName(message).trim().charAt(0).toUpperCase() || '?'
const mailExcerpt = (value: string) => value
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/(?:^|\s)(?:body|html|[.#][A-Za-z_-][\w-]*)\s*\{[^}]*(?:\}|$)/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, String.fromCharCode(39))
    .replace(/\s+/g, ' ')
    .trim()

function formatMailDate(value: string) {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    const now = new Date()
    const sameDay = date.toDateString() === now.toDateString()
    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)
    if (sameDay) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
    return date.getFullYear() === now.getFullYear()
        ? date.toLocaleDateString([], { month: 'short', day: 'numeric' })
        : date.toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' })
}

export function MailScreen({ settings }: { settings: AppSettings }) {
    const theme = useAppTheme()
    const styles = useMemo(() => createStyles(theme), [theme])
    const [overview, setOverview] = useState<MailOverview | null>(null)
    const [scope, setScope] = useState<MailScope>({})
    const [messages, setMessages] = useState<MailMessage[]>([])
    const [cursor, setCursor] = useState<string | null>(null)
    const [selectedMessage, setSelectedMessage] = useState<MailMessage | null>(null)
    const [view, setView] = useState<'list' | 'message' | 'compose'>('list')
    const [loading, setLoading] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [query, setQuery] = useState('')
    const [activeQuery, setActiveQuery] = useState('')
    const [folderName, setFolderName] = useState('')
    const [showAccounts, setShowAccounts] = useState(false)
    const [showFolders, setShowFolders] = useState(false)
    const [moving, setMoving] = useState(false)
    const [composer, setComposer] = useState(() => createMailComposer(''))
    const { draft, idempotencyKey: draftKey } = composer
    const [preparingAttachments, setPreparingAttachments] = useState(false)
    const sequence = useRef(0)
    const busyRef = useRef(false)
    const authenticated = Boolean(settings.authToken && settings.userId)

    useEffect(() => {
        sequence.current += 1
        setScope({})
        setOverview(null)
        setMessages([])
        setSelectedMessage(null)
        setView('list')
        setComposer(createMailComposer(''))
        setQuery('')
        setActiveQuery('')
        setShowAccounts(false)
    }, [settings.userId, settings.impersonationToken])

    useEffect(() => { void refresh() }, [scope.mailboxUser, scope.mailboxId, activeQuery, settings.authToken, settings.userId, settings.impersonationToken])

    useEffect(() => {
        const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
            if (view === 'list') return false
            closeView()
            return true
        })
        return () => subscription.remove()
    }, [view, draft, busy])

    function closeView() {
        if (busy) return
        if (view === 'compose' && hasMailDraftContent(draft)) {
            Alert.alert('Discard draft?', 'Your unsent message will be discarded.', [
                { text: 'Keep editing', style: 'cancel' },
                { text: 'Discard', style: 'destructive', onPress: () => { setComposer(createMailComposer('')); setView(selectedMessage ? 'message' : 'list') } },
            ])
            return
        }
        ++sequence.current
        setLoading(false)
        setView('list')
        setSelectedMessage(null)
    }

    async function refresh(after?: string) {
        const requestId = ++sequence.current
        if (!authenticated) { setLoading(false); return }
        setLoading(true)
        setError('')
        try {
            const page = activeQuery && scope.mailboxUser && scope.mailboxId
                ? await searchMail(settings, scope, activeQuery, after)
                : after ? await loadMailPage(settings, currentScope(), after) : await loadMail(settings, scope)
            if (requestId !== sequence.current) return
            if ('accessibleAccounts' in page) setOverview(page as MailOverview)
            setMessages(previous => after ? [...previous, ...page.messages.filter(item => !previous.some(existing => existing.id === item.id))] : page.messages)
            setCursor(page.nextCursor)
        } catch (cause) {
            if (requestId === sequence.current) setError(errorMessage(cause))
        } finally {
            if (requestId === sequence.current) setLoading(false)
        }
    }

    function currentScope(): MailScope {
        return { mailboxUser: overview?.mailboxUser, mailboxId: overview?.selectedMailboxId }
    }

    async function openMessage(message: MailMessage) {
        if (loading || busy || !overview) return
        const requestId = ++sequence.current
        const mailboxUser = overview.mailboxUser
        setLoading(true)
        setError('')
        setSelectedMessage(null)
        setView('message')
        try {
            const result = await loadMail(settings, currentScope(), message.id)
            if (requestId !== sequence.current) return
            if (!result.selectedMessage) throw new Error('This message is no longer available.')
            setSelectedMessage(result.selectedMessage)
            if (!result.selectedMessage.isRead) {
                await updateMail(settings, mailboxUser, message.id, 'read')
                if (requestId !== sequence.current) return
                setSelectedMessage({ ...result.selectedMessage, isRead: true })
                setMessages(previous => previous.map(item => item.id === message.id ? { ...item, isRead: true } : item))
            }
        } catch (cause) {
            if (requestId === sequence.current) setError(errorMessage(cause))
        } finally {
            if (requestId === sequence.current) setLoading(false)
        }
    }

    async function action(type: MailAction, targetMailboxId?: string) {
        if (busyRef.current || !selectedMessage || !overview) return
        busyRef.current = true
        setBusy(true)
        try {
            await updateMail(settings, overview.mailboxUser, selectedMessage.id, type, targetMailboxId)
            if (['read', 'unread', 'flag', 'unflag'].includes(type)) {
                const next = { ...selectedMessage, isRead: type === 'read' ? true : type === 'unread' ? false : selectedMessage.isRead, isFlagged: type === 'flag' ? true : type === 'unflag' ? false : selectedMessage.isFlagged }
                setSelectedMessage(next)
                setMessages(previous => previous.map(item => item.id === next.id ? next : item))
            } else {
                setSelectedMessage(null)
                setView('list')
            }
            setMoving(false)
            await refresh()
        } catch (cause) { Alert.alert('Mail action failed', errorMessage(cause)) } finally { busyRef.current = false; setBusy(false) }
    }

    async function toggleFlag(message: MailMessage) {
        if (busyRef.current || !overview) return
        busyRef.current = true
        setBusy(true)
        const nextFlagged = !message.isFlagged
        try {
            await updateMail(settings, overview.mailboxUser, message.id, nextFlagged ? 'flag' : 'unflag')
            setMessages(previous => previous.map(item => item.id === message.id ? { ...item, isFlagged: nextFlagged } : item))
        } catch (cause) {
            Alert.alert('Unable to update message', errorMessage(cause))
        } finally {
            busyRef.current = false
            setBusy(false)
        }
    }

    function compose(mode: 'new' | 'reply' | 'replyAll' | 'forward') {
        if (!overview || busy) return
        const nextComposer = createMailComposer(overview.mailboxUser)
        const next = nextComposer.draft
        if (mode !== 'new' && selectedMessage) {
            const message = selectedMessage
            next.subject = `${mode === 'forward' ? 'Fwd' : 'Re'}: ${message.subject.replace(/^(re|fwd):\s*/i, '')}`
            next.textBody = `\n\nOn ${message.receivedAt}, ${recipients(message.from)} wrote:\n${message.textBody || message.preview}`
            if (mode !== 'forward') {
                const reply = message.replyTo.length ? message.replyTo : message.from
                next.to = recipients(reply)
                if (mode === 'replyAll') {
                    const excluded = new Set([...reply.map(item => item.email.toLowerCase()), overview.mailboxAddress.toLowerCase()])
                    next.cc = recipients([...message.to, ...message.cc].filter(item => {
                        const email = item.email.toLowerCase()
                        if (excluded.has(email)) return false
                        excluded.add(email)
                        return true
                    }))
                }
            }
        }
        setComposer(nextComposer)
        setView('compose')
    }

    async function submit() {
        if (busyRef.current || !canSendMail(draft)) return
        busyRef.current = true
        setBusy(true)
        try {
            await sendMail(settings, draft, draftKey)
            setComposer(createMailComposer(''))
            setSelectedMessage(null)
            setView('list')
            Alert.alert('Message sent')
            await refresh()
        } catch (cause) { Alert.alert('Unable to send mail', errorMessage(cause)) } finally { busyRef.current = false; setBusy(false) }
    }

    async function attachFiles() {
        if (busyRef.current) return
        const startedComposer = composer
        busyRef.current = true
        setBusy(true)
        setPreparingAttachments(true)
        try {
            const attachments = await pickMailAttachments(startedComposer.draft)
            if (attachments) setComposer(current => current === startedComposer ? editMailComposer(current, { attachments }) : current)
        } catch (cause) {
            Alert.alert('Unable to attach files', errorMessage(cause))
        } finally {
            busyRef.current = false
            setPreparingAttachments(false)
            setBusy(false)
        }
    }

    async function attachment(item: MailAttachment) {
        if (busyRef.current || !overview) return
        busyRef.current = true
        setBusy(true)
        try {
            if (!await Sharing.isAvailableAsync()) throw new Error('Attachment sharing is unavailable on this device.')
            const uri = await saveMailAttachment(settings, overview.mailboxUser, item)
            await Sharing.shareAsync(uri, { mimeType: item.type || 'application/octet-stream', dialogTitle: item.name })
        } catch (cause) { Alert.alert('Unable to open attachment', errorMessage(cause)) } finally { busyRef.current = false; setBusy(false) }
    }

    function selectAccount(mailboxUser: string) {
        ++sequence.current
        setScope({ mailboxUser })
        setOverview(null)
        setMessages([])
        setCursor(null)
        setQuery('')
        setActiveQuery('')
        setShowAccounts(false)
    }
    function selectFolder(mailboxId: string) {
        ++sequence.current
        setScope({ mailboxUser: overview?.mailboxUser, mailboxId })
        setMessages([])
        setCursor(null)
        setQuery('')
        setActiveQuery('')
        setShowFolders(false)
    }
    const selectedFolder = overview?.mailboxes.find(item => item.id === overview.selectedMailboxId)
    const field = (name: keyof Omit<MailDraft, 'mailboxUser' | 'attachments'>, placeholder: string, multiline = false) => <TextInput accessibilityLabel={placeholder} value={draft[name]} onChangeText={value => { setComposer(current => editMailComposer(current, { [name]: value })) }} editable={!busy} placeholder={placeholder} placeholderTextColor={theme.textSoft} autoCapitalize={['to', 'cc', 'bcc'].includes(name) ? 'none' : 'sentences'} autoCorrect={!['to', 'cc', 'bcc'].includes(name)} multiline={multiline} style={[styles.input, multiline && { minHeight: 240, paddingTop: 14, textAlignVertical: 'top' }]} />

    return (
        <Screen key={view} appearance='quiet' compactHeader={view === 'list'} contentStyle={view === 'list' ? { gap: spacing.sm } : undefined} title={view === 'compose' ? 'New message' : view === 'message' ? 'Message' : (selectedFolder?.name || 'Inbox')} subtitle={view === 'list' ? overview?.mailboxAddress : undefined} left={view !== 'list' ? <PillButton label='Back' small onPress={closeView} disabled={busy} /> : undefined} right={view === 'list' ? <PillButton label='Compose' small tone='accent' onPress={() => compose('new')} disabled={!overview || loading || busy || !overview.canSend} /> : undefined}>
            {!!error && (view !== 'list' || messages.length > 0) && <InlineNotice message={error} />}
            {!!overview?.notice && <InlineNotice message={overview.notice} />}
            {!authenticated && <InlineNotice message='Sign in to load your mail.' />}
            {view === 'compose' && <GlassCard>
                <Text style={styles.muted}>From: {overview?.mailboxAddress}</Text>
                <View style={styles.stack}>{field('to', 'To')}{field('cc', 'Cc')}{field('bcc', 'Bcc')}{field('subject', 'Subject')}{field('textBody', 'Message', true)}
                    <PillButton label={preparingAttachments ? 'Reading files…' : 'Attach files'} disabled={busy} onPress={() => void attachFiles()} />
                    {draft.attachments.map((item, index) => <View key={`${index}:${item.name}`} style={styles.message}>
                        <Text style={{ color: theme.text }}>{item.name}</Text>
                        <Text style={styles.caption}>{Math.ceil(item.size / 1024).toLocaleString()} KB</Text>
                        <PillButton label={`Remove ${item.name}`} small disabled={busy} onPress={() => setComposer(current => editMailComposer(current, { attachments: current.draft.attachments.filter((_, position) => position !== index) }))} />
                    </View>)}
                    <PillButton label={preparingAttachments ? 'Reading files…' : busy ? 'Sending…' : 'Send'} tone='accent' disabled={busy || !canSendMail(draft)} onPress={() => void submit()} />
                </View>
            </GlassCard>}
            {view === 'list' && <>
                <View style={styles.mailControls}>
                    <View style={styles.searchField}>
                        <Search color={theme.textMuted} size={19} />
                        <TextInput accessibilityLabel='Search this folder' value={query} onChangeText={setQuery} onSubmitEditing={() => { setScope(currentScope()); setActiveQuery(query.trim()) }} placeholder='Search mail' placeholderTextColor={theme.textSoft} style={styles.searchInput} returnKeyType='search' editable={!busy} />
                        {!!query.trim() && <Pressable accessibilityRole='button' accessibilityLabel='Search mail' onPress={() => { setScope(currentScope()); setActiveQuery(query.trim()) }} disabled={loading || !overview}><Text style={styles.searchAction}>Search</Text></Pressable>}
                        {!!query && <Pressable accessibilityRole='button' accessibilityLabel='Clear search' onPress={() => { setQuery(''); setActiveQuery('') }} hitSlop={10}><Text style={styles.clearSearch}>×</Text></Pressable>}
                    </View>
                    <View style={styles.mailToolbar}>
                        <Pressable accessibilityRole='button' accessibilityLabel={`Choose mailbox, currently ${overview?.accessibleAccounts.find(account => account.id === overview.mailboxUser)?.name || overview?.mailboxAddress || 'mailbox'}`} accessibilityState={{ expanded: showAccounts }} style={styles.selectorButton} onPress={() => { setShowAccounts(value => !value); setShowFolders(false) }} disabled={!overview || busy}>
                            <Text numberOfLines={1} style={styles.folderLabel}>{overview?.accessibleAccounts.find(account => account.id === overview.mailboxUser)?.name || overview?.mailboxAddress || 'Mailbox'}</Text><ChevronDown color={theme.textMuted} size={16} />
                        </Pressable>
                        <Pressable accessibilityRole='button' accessibilityLabel={`Choose mailbox folder, currently ${selectedFolder?.name || 'Inbox'}`} accessibilityState={{ expanded: showFolders }} style={styles.selectorButton} onPress={() => { setShowFolders(value => !value); setShowAccounts(false) }} disabled={!overview || busy}>
                            <Text numberOfLines={1} style={styles.folderLabel}>{selectedFolder?.name || 'Inbox'}</Text><ChevronDown color={theme.textMuted} size={16} />
                        </Pressable>
                        <Pressable accessibilityRole='button' accessibilityLabel={loading ? 'Refreshing mail' : 'Refresh mail'} onPress={() => void refresh()} disabled={loading || busy} style={styles.iconButton}>
                            <RefreshCw color={loading ? theme.textSoft : theme.textMuted} size={18} />
                        </Pressable>
                    </View>
                    {showAccounts && <View style={styles.folderPanel}>
                        {overview?.accessibleAccounts.map(account => <Pressable key={account.id} accessibilityRole='button' accessibilityLabel={`Mailbox ${account.name || account.address}${account.unreadCount ? `, ${account.unreadCount} unread` : ''}`} accessibilityState={{ selected: overview.mailboxUser === account.id }} style={[styles.folderOption, overview.mailboxUser === account.id && styles.folderOptionSelected]} onPress={() => selectAccount(account.id)} disabled={loading || busy}>
                            <Text numberOfLines={1} style={[styles.folderOptionLabel, overview.mailboxUser === account.id && styles.folderOptionLabelSelected]}>{account.name || account.address}</Text>
                            {!!account.unreadCount && <Text style={styles.folderUnread}>{account.unreadCount}</Text>}
                        </Pressable>)}
                    </View>}
                    {showFolders && <View style={styles.folderPanel}>
                        {overview?.mailboxes.map(box => <Pressable key={box.id} accessibilityRole='button' accessibilityState={{ selected: overview.selectedMailboxId === box.id }} style={[styles.folderOption, overview.selectedMailboxId === box.id && styles.folderOptionSelected]} onPress={() => selectFolder(box.id)} disabled={busy || loading}>
                            <Text style={[styles.folderOptionLabel, overview.selectedMailboxId === box.id && styles.folderOptionLabelSelected]}>{box.name}</Text>
                            {!!box.unreadEmails && <Text style={styles.folderUnread}>{box.unreadEmails}</Text>}
                        </Pressable>)}
                        <View style={styles.newFolderRow}>
                            <TextInput accessibilityLabel='New folder name' value={folderName} onChangeText={setFolderName} placeholder='New folder name' placeholderTextColor={theme.textSoft} style={[styles.input, { flex: 1 }]} editable={!busy} />
                            <PillButton label='Add' small disabled={busy || !folderName.trim()} onPress={() => {
                                if (!overview || busyRef.current) return
                                busyRef.current = true; setBusy(true)
                                void addMailFolder(settings, overview.mailboxUser, folderName.trim()).then(async () => { setFolderName(''); await refresh() }).catch(cause => Alert.alert('Unable to create folder', errorMessage(cause))).finally(() => { busyRef.current = false; setBusy(false) })
                            }} />
                        </View>
                    </View>}
                </View>
                <View style={styles.messageList}>
                    {!messages.length && <View style={styles.emptyState}>
                        <Mail color={theme.textSoft} size={30} strokeWidth={1.6} />
                        <Text style={styles.emptyTitle}>{loading ? 'Loading mail…' : error ? 'Mail is temporarily unavailable' : activeQuery ? 'No matching messages' : 'You’re all caught up'}</Text>
                        <Text style={styles.muted}>{loading ? 'Your messages will appear here.' : error ? 'Refresh to try loading this mailbox again.' : activeQuery ? 'Try another search or clear the search field.' : 'New messages in this mailbox will appear here.'}</Text>
                        {!!error && <PillButton label={loading ? 'Retrying…' : 'Retry'} small disabled={loading || busy} onPress={() => void refresh()} />}
                    </View>}
                    {messages.map(message => <View key={message.id} style={[styles.messageRow, !message.isRead && styles.unreadMessageRow]}>
                        <View style={[styles.avatar, !message.isRead && styles.unreadAvatar]}><Text style={styles.avatarText}>{senderInitial(message)}</Text></View>
                        <Pressable accessibilityRole='button' accessibilityLabel={`${message.isRead ? '' : 'Unread. '}${senderName(message)}. ${message.subject || 'No subject'}. ${mailExcerpt(message.preview)}`} key={`open-${message.id}`} disabled={loading || busy} style={styles.messageContent} onPress={() => void openMessage(message)}>
                            <View style={styles.messageTopline}>
                                <Text numberOfLines={1} style={[styles.sender, !message.isRead && styles.unreadText]}>{senderName(message)}</Text>
                                <Text style={[styles.messageTime, !message.isRead && styles.unreadText]}>{formatMailDate(message.receivedAt)}</Text>
                            </View>
                            <Text numberOfLines={1} style={[styles.subject, !message.isRead && styles.unreadText]}>{message.subject || '(No subject)'}</Text>
                            <Text numberOfLines={2} style={styles.preview}>{mailExcerpt(message.preview) || 'No preview available.'}</Text>
                            {message.hasAttachment && <View style={styles.attachmentHint}><Paperclip color={theme.textSoft} size={12} /><Text style={styles.attachmentText}>Attachment</Text></View>}
                        </Pressable>
                        <Pressable accessibilityRole='button' accessibilityLabel={`${message.isFlagged ? 'Remove star from' : 'Star'} ${message.subject || 'message'}`} accessibilityState={{ selected: message.isFlagged }} disabled={busy} onPress={() => void toggleFlag(message)} hitSlop={8} style={styles.starButton}>
                            <Star color={message.isFlagged ? theme.accent : theme.textSoft} fill={message.isFlagged ? theme.accent : 'transparent'} size={19} strokeWidth={1.8} />
                        </Pressable>
                    </View>)}
                    {!!cursor && <View style={styles.loadMore}><PillButton label={loading ? 'Loading…' : 'Load more messages'} onPress={() => void refresh(cursor)} disabled={loading || busy} /></View>}
                </View>
            </>}
            {view === 'message' && !selectedMessage && <GlassCard><Text style={styles.muted}>{loading ? 'Loading message…' : 'Message unavailable.'}</Text></GlassCard>}
            {view === 'message' && selectedMessage && <>
                <GlassCard>
                    <SectionTitle eyebrow='Message' title={selectedMessage.subject || '(No subject)'} body={recipients(selectedMessage.from)} />
                    <Text selectable style={styles.caption}>To: {recipients(selectedMessage.to)}{selectedMessage.cc.length ? `\nCc: ${recipients(selectedMessage.cc)}` : ''}{`\n${selectedMessage.receivedAt}`}</Text>
                    <View style={styles.row}>
                        <PillButton label='Reply' small disabled={busy || !overview?.canSend} onPress={() => compose('reply')} />
                        <PillButton label='Reply all' small disabled={busy || !overview?.canSend} onPress={() => compose('replyAll')} />
                        <PillButton label='Forward' small disabled={busy || !overview?.canSend} onPress={() => compose('forward')} />
                    </View>
                    <Text selectable style={{ color: theme.text, lineHeight: 23, marginTop: spacing.md }}>{selectedMessage.textBody || selectedMessage.preview || 'No plain text content.'}</Text>
                    {selectedMessage.attachments.map(item => <View key={item.blobId} style={styles.message}><Text style={{ color: theme.text }}>{item.name} · {Math.ceil(item.size / 1024)} KB</Text><PillButton label='Open / Save attachment' small disabled={busy} onPress={() => void attachment(item)} /></View>)}
                </GlassCard>
                <GlassCard><View style={styles.row}>
                    <PillButton label={selectedMessage.isRead ? 'Mark unread' : 'Mark read'} small disabled={busy} onPress={() => void action(selectedMessage.isRead ? 'unread' : 'read')} />
                    <PillButton label={selectedMessage.isFlagged ? 'Unflag' : 'Flag'} small disabled={busy} onPress={() => void action(selectedMessage.isFlagged ? 'unflag' : 'flag')} />
                    <PillButton label='Archive' small disabled={busy} onPress={() => void action('archive')} />
                    <PillButton label={selectedFolder?.role === 'junk' ? 'Not junk' : 'Junk'} small disabled={busy} onPress={() => void action(selectedFolder?.role === 'junk' ? 'ham' : 'junk')} />
                    {selectedFolder?.role === 'trash' && <PillButton label='Restore' small disabled={busy} onPress={() => void action('restore')} />}
                    <PillButton label='Move…' small disabled={busy} onPress={() => setMoving(value => !value)} />
                    <PillButton label='Trash' small tone='danger' disabled={busy} onPress={() => Alert.alert('Move message to Trash?', selectedMessage.subject || '(No subject)', [{ text: 'Cancel', style: 'cancel' }, { text: 'Move to Trash', style: 'destructive', onPress: () => void action('trash') }])} />
                </View>{moving && <View style={styles.stack}>{overview?.mailboxes.filter(box => box.id !== overview.selectedMailboxId).map(box => <PillButton label={box.name} small key={box.id} disabled={busy} onPress={() => void action('move', box.id)} />)}</View>}</GlassCard>
            </>}
        </Screen>
    )
}

function createStyles(theme: ThemePalette) {
    return StyleSheet.create({
        input: { minHeight: 46, borderRadius: 16, borderWidth: 1, borderColor: theme.surfaceBorderSoft, backgroundColor: theme.backgroundRaised, paddingHorizontal: 14, color: theme.text, fontSize: 15 } as const,
        stack: { gap: spacing.sm, marginTop: spacing.md },
        row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md } as const,
        message: { gap: 5, paddingVertical: spacing.md, borderBottomWidth: 1, borderColor: theme.surfaceBorderSoft },
        mailControls: { gap: 7, marginBottom: 2 },
        searchField: { minHeight: 50, borderRadius: 25, backgroundColor: theme.surfaceStrong, borderWidth: 1, borderColor: theme.surfaceBorderSoft, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 11 },
        searchInput: { flex: 1, minHeight: 48, color: theme.text, fontSize: 15, paddingVertical: 0 },
        searchAction: { color: theme.accent, fontSize: 13, fontWeight: '700', paddingVertical: 8 },
        clearSearch: { color: theme.textMuted, fontSize: 26, lineHeight: 28, paddingHorizontal: 3 },
        mailToolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40 },
        selectorButton: { minHeight: 34, maxWidth: '46%', borderRadius: 18, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: theme.surfaceStrong },
        folderLabel: { color: theme.text, fontSize: 12, fontWeight: '600', flexShrink: 1 },
        iconButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19 },
        folderPanel: { padding: 8, borderRadius: 16, borderWidth: 1, borderColor: theme.surfaceBorderSoft, backgroundColor: theme.surface },
        folderOption: { minHeight: 42, borderRadius: 11, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
        folderOptionSelected: { backgroundColor: theme.accentSoft },
        folderOptionLabel: { color: theme.textMuted, fontSize: 14 },
        folderOptionLabelSelected: { color: theme.text, fontWeight: '700' },
        folderUnread: { color: theme.accentAlt, fontSize: 12, fontWeight: '700' },
        newFolderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 6, marginTop: 4, borderTopWidth: 1, borderColor: theme.surfaceBorderSoft },
        messageList: { marginHorizontal: -spacing.lg, gap: 0 },
        emptyState: { minHeight: 250, justifyContent: 'center', alignItems: 'center', gap: 10, paddingHorizontal: spacing.xl },
        emptyTitle: { color: theme.text, fontSize: 17, fontWeight: '700' },
        messageRow: { minHeight: 78, borderBottomWidth: 1, borderBottomColor: theme.surfaceBorderSoft, backgroundColor: theme.background, flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: spacing.md, paddingVertical: 11, gap: 11 },
        unreadMessageRow: { backgroundColor: theme.surfaceStrong },
        avatar: { width: 40, height: 40, borderRadius: 20, marginTop: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surfaceStrong },
        unreadAvatar: { backgroundColor: theme.accentSoft },
        avatarText: { color: theme.accentAlt, fontSize: 18, fontWeight: '700' },
        messageContent: { flex: 1, minWidth: 0, gap: 2 },
        messageTopline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
        sender: { flex: 1, color: theme.textMuted, fontSize: 13, fontWeight: '500' },
        messageTime: { color: theme.textSoft, fontSize: 11, fontWeight: '500' },
        subject: { color: theme.textMuted, fontSize: 13, fontWeight: '500' },
        unreadText: { color: theme.text, fontWeight: '700' },
        preview: { color: theme.textSoft, fontSize: 12, lineHeight: 17 },
        attachmentHint: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
        attachmentText: { color: theme.textSoft, fontSize: 10 },
        starButton: { width: 32, height: 40, marginLeft: 1, alignItems: 'center', justifyContent: 'center' },
        loadMore: { paddingVertical: spacing.md, alignItems: 'center' },
        muted: { color: theme.textMuted, lineHeight: 21 },
        caption: { color: theme.textSoft, fontSize: 12, marginTop: spacing.sm },
    })
}
