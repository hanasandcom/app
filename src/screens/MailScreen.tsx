import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, BackHandler, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import * as Sharing from 'expo-sharing'
import type { AppSettings } from '../types'
import { addMailFolder, canSendMail, createMailComposer, editMailComposer, hasMailDraftContent, pickMailAttachments, loadMail, loadMailPage, saveMailAttachment, searchMail, sendMail, updateMail, type MailAction, type MailAttachment, type MailDraft, type MailMessage, type MailOverview, type MailScope } from '../lib/mail-api'
import { GlassCard, InlineNotice, PillButton, Screen, SectionTitle } from '../components/ui'
import { spacing, type ThemePalette } from '../theme/tokens'
import { useAppTheme } from '../theme/context'

const recipients = (items: MailMessage['from']) => items.map(item => item.name ? `${item.name} <${item.email}>` : item.email).join(', ')
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : 'Unable to complete this request.'

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
        <Screen key={view} title={view === 'compose' ? 'New message' : 'Mail'} subtitle={overview?.mailboxAddress} left={view !== 'list' ? <PillButton label='Back' small onPress={closeView} disabled={busy} /> : undefined} right={view === 'list' ? <PillButton label='Compose' small tone='accent' onPress={() => compose('new')} disabled={!overview || loading || busy || !overview.canSend} /> : undefined}>
            {!!error && <InlineNotice message={error} />}
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
                <GlassCard>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
                        {overview?.accessibleAccounts.map(account => <PillButton key={account.id} small label={`${account.name || account.address}${account.unreadCount ? ` · ${account.unreadCount}` : ''}`} tone={overview.mailboxUser === account.id ? 'accent' : 'default'} onPress={() => selectAccount(account.id)} disabled={loading || busy} />)}
                    </ScrollView>
                    <View style={styles.row}>
                        <PillButton label={`${selectedFolder?.name || 'Folders'} ▾`} small onPress={() => setShowFolders(value => !value)} disabled={!overview || busy} />
                        <PillButton label={loading ? 'Refreshing…' : 'Refresh'} small onPress={() => void refresh()} disabled={loading || busy} />
                    </View>
                    {showFolders && <View style={styles.stack}>
                        {overview?.mailboxes.map(box => <PillButton key={box.id} small label={`${box.name}${box.unreadEmails ? ` · ${box.unreadEmails}` : ''}`} tone={overview.selectedMailboxId === box.id ? 'accent' : 'default'} onPress={() => selectFolder(box.id)} disabled={busy || loading} />)}
                        <TextInput accessibilityLabel='New folder name' value={folderName} onChangeText={setFolderName} placeholder='New folder name' placeholderTextColor={theme.textSoft} style={styles.input} editable={!busy} />
                        <PillButton label='Create folder' small disabled={busy || !folderName.trim()} onPress={() => {
                            if (!overview || busyRef.current) return
                            busyRef.current = true; setBusy(true)
                            void addMailFolder(settings, overview.mailboxUser, folderName.trim()).then(async () => { setFolderName(''); await refresh() }).catch(cause => Alert.alert('Unable to create folder', errorMessage(cause))).finally(() => { busyRef.current = false; setBusy(false) })
                        }} />
                    </View>}
                    <View style={styles.stack}>
                        <TextInput accessibilityLabel='Search this folder' value={query} onChangeText={setQuery} onSubmitEditing={() => { setScope(currentScope()); setActiveQuery(query.trim()) }} placeholder='Search this folder' placeholderTextColor={theme.textSoft} style={styles.input} returnKeyType='search' />
                        <View style={styles.row}><PillButton label='Search' small disabled={loading || !overview} onPress={() => { setScope(currentScope()); setActiveQuery(query.trim()) }} />{!!activeQuery && <PillButton label='Clear' small onPress={() => { setQuery(''); setActiveQuery('') }} />}</View>
                    </View>
                </GlassCard>
                <GlassCard>
                    <SectionTitle eyebrow='Messages' title={activeQuery ? `Results for “${activeQuery}”` : selectedFolder?.name || 'Messages'} />
                    {!messages.length && <Text style={[styles.muted, { marginTop: spacing.md }]}>{loading ? 'Loading mail…' : 'No messages in this folder.'}</Text>}
                    {messages.map(message => <Pressable accessibilityRole='button' accessibilityLabel={`${message.isRead ? '' : 'Unread. '}${message.subject || 'No subject'}`} key={message.id} disabled={loading || busy} style={styles.message} onPress={() => void openMessage(message)}>
                        <Text numberOfLines={1} style={{ color: theme.text, fontWeight: message.isRead ? '500' : '800' }}>{message.isFlagged ? '★ ' : ''}{recipients(message.from)}</Text>
                        <Text numberOfLines={2} style={{ color: theme.text, fontWeight: message.isRead ? '500' : '800' }}>{message.subject || '(No subject)'}</Text>
                        <Text numberOfLines={2} style={styles.muted}>{message.preview}</Text>
                        <Text style={styles.caption}>{message.hasAttachment ? 'Attachment · ' : ''}{message.receivedAt ? new Date(message.receivedAt).toLocaleString() : ''}</Text>
                    </Pressable>)}
                    {!!cursor && <PillButton label={loading ? 'Loading…' : 'Load more'} onPress={() => void refresh(cursor)} disabled={loading || busy} />}
                </GlassCard>
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
    return {
        input: { minHeight: 46, borderRadius: 16, borderWidth: 1, borderColor: theme.surfaceBorderSoft, backgroundColor: theme.backgroundRaised, paddingHorizontal: 14, color: theme.text, fontSize: 15 } as const,
        stack: { gap: spacing.sm, marginTop: spacing.md },
        row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md } as const,
        message: { gap: 5, paddingVertical: spacing.md, borderBottomWidth: 1, borderColor: theme.surfaceBorderSoft },
        muted: { color: theme.textMuted, lineHeight: 21 },
        caption: { color: theme.textSoft, fontSize: 12, marginTop: spacing.sm },
    }
}
