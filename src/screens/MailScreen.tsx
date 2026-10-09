import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Pressable, Text, TextInput, View } from 'react-native'
import type { AppSettings, MailOverview, SavedMailboxConnection } from '../types'
import { createMailbox, fetchMailOverview, postMailAction, sendMailMessage } from '../lib/api'
import { GlassCard, InlineNotice, LabeledInput, PillButton, Screen, SectionTitle } from '../components/ui'
import { spacing, type ThemePalette } from '../theme/tokens'
import { useAppTheme } from '../theme/context'

const emptyOverview: MailOverview = {
    mailboxUser: '',
    mailboxAddress: 'Not connected',
    accessibleAccounts: [],
    mailboxes: [],
    selectedMailboxId: null,
    messages: [],
    selectedMessage: null,
}

export function MailScreen({ settings, mailboxConnections, onSaveMailboxConnections }: { settings: AppSettings; mailboxConnections: SavedMailboxConnection[]; onSaveMailboxConnections: (items: SavedMailboxConnection[]) => void }) {
    const theme = useAppTheme()
    const styles = useMemo(() => createStyles(theme), [theme])
    const [overview, setOverview] = useState<MailOverview>(emptyOverview)
    const [selectedMailboxId, setSelectedMailboxId] = useState<string | null>(null)
    const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)
    const [selectedMailboxUser, setSelectedMailboxUser] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [composeTo, setComposeTo] = useState('')
    const [composeSubject, setComposeSubject] = useState('')
    const [composeBody, setComposeBody] = useState('')
    const [sending, setSending] = useState(false)
    const [mailActionBusy, setMailActionBusy] = useState<'archive' | 'trash' | 'read' | 'flag' | ''>('')
    const [mailboxName, setMailboxName] = useState('')
    const [connectionLabel, setConnectionLabel] = useState('')
    const [connectionEmail, setConnectionEmail] = useState('')
    const [imapHost, setImapHost] = useState('imap.gmail.com')
    const [smtpHost, setSmtpHost] = useState('smtp.gmail.com')
    const loadSequenceRef = useRef(0)

    useEffect(() => {
        void load()
    }, [settings.apiBaseUrl, settings.authToken, settings.userId, selectedMailboxId, selectedMessageId, selectedMailboxUser])

    async function load() {
        const requestId = loadSequenceRef.current + 1
        loadSequenceRef.current = requestId
        if (!settings.apiBaseUrl.trim() || !settings.authToken.trim() || !settings.userId.trim()) {
            setOverview(emptyOverview)
            setError('')
            setSelectedMailboxId(null)
            setSelectedMessageId(null)
            setSelectedMailboxUser(null)
            return
        }
        setLoading(true)
        setError('')
        try {
            const next = await fetchMailOverview(settings, selectedMailboxId, selectedMessageId, selectedMailboxUser)
            if (loadSequenceRef.current !== requestId) return
            setOverview(next)
            setSelectedMailboxId(next.selectedMailboxId)
            setSelectedMailboxUser(next.mailboxUser)
            setSelectedMessageId(next.selectedMessage?.id || next.messages[0]?.id || null)
        } catch (cause) {
            if (loadSequenceRef.current !== requestId) return
            setOverview(emptyOverview)
            setError(cause instanceof Error ? cause.message : 'Unable to load mailbox.')
        } finally {
            if (loadSequenceRef.current === requestId) {
                setLoading(false)
            }
        }
    }

    const selectedMessage = useMemo(() => {
        if (overview.selectedMessage?.id === selectedMessageId) return overview.selectedMessage
        return overview.messages.find(item => item.id === selectedMessageId) || overview.selectedMessage
    }, [overview, selectedMessageId])
    const mailConfigured = Boolean(settings.apiBaseUrl.trim() && settings.authToken.trim() && settings.userId.trim())

    async function action(type: 'archive' | 'trash' | 'read' | 'flag') {
        if (!selectedMessageId || mailActionBusy) return
        if (!mailConfigured) {
            Alert.alert('Login required', 'Log in again to refresh the session used for mail.')
            return
        }
        setMailActionBusy(type)
        try {
            await postMailAction(settings, selectedMessageId, type)
            await load()
        } catch (cause) {
            Alert.alert('Mail action failed', cause instanceof Error ? cause.message : 'Unable to update the message.')
        } finally {
            setMailActionBusy('')
        }
    }

    async function addMailbox() {
        if (!mailboxName.trim()) {
            Alert.alert('Missing folder name', 'Add a folder name first.')
            return
        }
        if (!mailConfigured) {
            Alert.alert('Login required', 'Log in again to refresh the session used for mail.')
            return
        }
        try {
            await createMailbox(settings, mailboxName.trim())
            setMailboxName('')
            await load()
        } catch (cause) {
            Alert.alert('Unable to create mailbox', cause instanceof Error ? cause.message : 'Request failed.')
        }
    }

    async function sendCompose() {
        if (sending) return
        if (!mailConfigured) {
            Alert.alert('Login required', 'Log in again to refresh the session used for mail.')
            return
        }
        if (!composeTo.trim() || !composeSubject.trim()) {
            Alert.alert('Missing fields', 'Add a recipient and subject before sending.')
            return
        }
        setSending(true)
        try {
            const result = await sendMailMessage(settings, {
                mailboxUser: overview.mailboxUser,
                to: composeTo.trim(),
                subject: composeSubject.trim(),
                textBody: composeBody.trim(),
            })
            setComposeTo('')
            setComposeSubject('')
            setComposeBody('')
            if (result) {
                setSelectedMailboxUser(result.mailboxUser || overview.mailboxUser)
                setSelectedMailboxId(result.sentMailboxId || selectedMailboxId)
                setSelectedMessageId(result.sentMessageId || null)
            }
            await load()
        } catch (cause) {
            Alert.alert('Unable to send mail', cause instanceof Error ? cause.message : 'Request failed.')
        } finally {
            setSending(false)
        }
    }

    function saveConnection() {
        if (!connectionLabel.trim() || !connectionEmail.trim()) {
            Alert.alert('Missing connector details', 'Add a label and mailbox email first.')
            return
        }
        const email = connectionEmail.trim().toLowerCase()
        const next = {
            id: mailboxConnections.find(connection => connection.email.toLowerCase() === email)?.id || `${Date.now()}`,
            label: connectionLabel.trim(),
            email,
            imapHost: imapHost.trim(),
            smtpHost: smtpHost.trim(),
        }
        onSaveMailboxConnections([next, ...mailboxConnections.filter(connection => connection.email.toLowerCase() !== email)])
        setConnectionLabel('')
        setConnectionEmail('')
    }

    function removeConnection(connection: SavedMailboxConnection) {
        Alert.alert('Remove mailbox connector?', connection.label, [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Remove',
                style: 'destructive',
                onPress: () => onSaveMailboxConnections(mailboxConnections.filter(item => item.id !== connection.id)),
            },
        ])
    }

    return (
        <Screen title='Mail' subtitle=''>
            <GlassCard>
                <SectionTitle eyebrow='Compose' title='Send mail' body={mailConfigured ? overview.mailboxAddress : 'Auth required'} />
                <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
                    <TextInput value={composeTo} onChangeText={setComposeTo} placeholder='To' autoCapitalize='none' autoCorrect={false} keyboardType='email-address' textContentType='emailAddress' placeholderTextColor={theme.textSoft} style={styles.inlineInput} />
                    <TextInput value={composeSubject} onChangeText={setComposeSubject} placeholder='Subject' autoCapitalize='sentences' autoCorrect placeholderTextColor={theme.textSoft} style={styles.inlineInput} />
                    <TextInput value={composeBody} onChangeText={setComposeBody} placeholder='Message' placeholderTextColor={theme.textSoft} multiline style={[styles.inlineInput, { minHeight: 104, paddingTop: 14, textAlignVertical: 'top' }]} />
                    <PillButton label={sending ? 'Sending...' : 'Send'} onPress={() => void sendCompose()} tone='accent' disabled={sending || !mailConfigured} />
                </View>
            </GlassCard>

            <GlassCard>
                <SectionTitle eyebrow='Inbox' title={loading ? 'Refreshing...' : overview.mailboxAddress} />
                {!!error && (
                    <View style={{ marginTop: spacing.md }}>
                        <InlineNotice message={error} />
                    </View>
                )}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
                    {overview.accessibleAccounts.map(account => (
                        <Pressable
                            key={account.id}
                            accessibilityRole='button'
                            accessibilityLabel={`Open mailbox account ${account.name}`}
                            accessibilityState={{ selected: account.id === overview.mailboxUser }}
                            onPress={() => {
                                setSelectedMailboxUser(account.id)
                                setSelectedMailboxId(null)
                                setSelectedMessageId(null)
                            }}
                            style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: account.id === overview.mailboxUser ? theme.accent : theme.surfaceBorderSoft, backgroundColor: account.id === overview.mailboxUser ? theme.accentSoft : theme.ambientNeutral }}
                        >
                            <Text style={{ color: theme.text, fontWeight: '700' }}>{account.name}</Text>
                        </Pressable>
                    ))}
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
                    {overview.mailboxes.map(box => (
                        <Pressable
                            key={box.id}
                            accessibilityRole='button'
                            accessibilityLabel={`Open folder ${box.name}`}
                            accessibilityState={{ selected: box.id === selectedMailboxId }}
                            onPress={() => {
                                setSelectedMailboxId(box.id)
                                setSelectedMessageId(null)
                            }}
                            style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: box.id === selectedMailboxId ? theme.accentAlt : theme.surfaceBorderSoft, backgroundColor: box.id === selectedMailboxId ? theme.ambientPrimary : theme.ambientNeutral }}
                        >
                            <Text style={{ color: theme.text, fontWeight: '600' }}>{box.name}{box.unreadEmails ? ` · ${box.unreadEmails}` : ''}</Text>
                        </Pressable>
                    ))}
                </View>
            </GlassCard>

            <GlassCard>
                <SectionTitle eyebrow='Messages' title='Tap to read' body='' />
                <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
                    {!overview.messages.length && (
                        <View style={{ borderRadius: 20, padding: 14, borderWidth: 1, borderColor: theme.surfaceBorderSoft, backgroundColor: theme.ambientNeutral }}>
                            <Text style={{ color: theme.text, fontWeight: '700' }}>{mailConfigured ? 'No messages' : 'Connect mail in Utilities'}</Text>
                        </View>
                    )}
                    {overview.messages.map(message => (
                        <Pressable
                            key={message.id}
                            accessibilityRole='button'
                            accessibilityLabel={`Read message ${message.subject || 'No subject'}`}
                            accessibilityState={{ selected: message.id === selectedMessageId }}
                            onPress={() => setSelectedMessageId(message.id)}
                            style={{ borderRadius: 20, padding: 14, borderWidth: 1, borderColor: message.id === selectedMessageId ? theme.accent : theme.surfaceBorderSoft, backgroundColor: message.id === selectedMessageId ? theme.accentSoft : theme.ambientNeutral }}
                        >
                            <Text style={{ color: theme.text, fontWeight: message.isRead ? '600' : '800', marginBottom: 4 }}>{message.subject}</Text>
                            <Text style={{ color: theme.textMuted, marginBottom: 6 }}>{message.preview}</Text>
                            <Text style={{ color: theme.textSoft, fontSize: 12 }}>{message.from.map(item => item.name || item.email).join(', ')}</Text>
                        </Pressable>
                    ))}
                </View>
            </GlassCard>

            {selectedMessage && (
                <GlassCard>
                    <SectionTitle eyebrow='Reading pane' title={selectedMessage.subject} body={selectedMessage.from.map(item => item.name || item.email).join(', ')} />
                    <Text style={{ color: theme.textMuted, lineHeight: 22, marginTop: spacing.md }}>{String('textBody' in selectedMessage ? selectedMessage.textBody : selectedMessage.preview)}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg }}>
                        <PillButton label={mailActionBusy === 'read' ? 'Working...' : 'Mark read'} onPress={() => action('read')} small disabled={loading || !!mailActionBusy} />
                        <PillButton label={mailActionBusy === 'flag' ? 'Working...' : 'Flag'} onPress={() => action('flag')} small disabled={loading || !!mailActionBusy} />
                        <PillButton label={mailActionBusy === 'archive' ? 'Working...' : 'Archive'} onPress={() => action('archive')} small disabled={loading || !!mailActionBusy} />
                        <PillButton label={mailActionBusy === 'trash' ? 'Working...' : 'Trash'} onPress={() => action('trash')} tone='danger' small disabled={loading || !!mailActionBusy} />
                    </View>
                </GlassCard>
            )}

            <GlassCard>
                <SectionTitle eyebrow='Setup' title='Folders + connectors' />
                <View style={{ gap: spacing.md, marginTop: spacing.md }}>
                    <LabeledInput label='New mailbox folder' value={mailboxName} onChangeText={setMailboxName} placeholder='Receipts, Travel, Clients…' />
                    <PillButton label={loading ? 'Working...' : 'Create folder'} onPress={addMailbox} disabled={loading || !mailConfigured} />
                    <LabeledInput label='Connection label' value={connectionLabel} onChangeText={setConnectionLabel} placeholder='Work Gmail' />
                    <LabeledInput label='Mailbox email' value={connectionEmail} onChangeText={setConnectionEmail} placeholder='me@example.com' />
                    <LabeledInput label='IMAP host' value={imapHost} onChangeText={setImapHost} />
                    <LabeledInput label='SMTP host' value={smtpHost} onChangeText={setSmtpHost} />
                    <PillButton label='Save mailbox connector' onPress={saveConnection} tone='accent' />
                    {mailboxConnections.map(connection => (
                        <View key={connection.id} style={{ borderRadius: 18, padding: 14, borderWidth: 1, borderColor: theme.surfaceBorderSoft, backgroundColor: theme.ambientNeutral, gap: 4 }}>
                            <Text style={{ color: theme.text, fontWeight: '700' }}>{connection.label}</Text>
                            <Text style={{ color: theme.textMuted }}>{connection.email}</Text>
                            <Text style={{ color: theme.textSoft, fontSize: 12 }}>{connection.imapHost} · {connection.smtpHost}</Text>
                            <PillButton label='Remove' onPress={() => removeConnection(connection)} tone='danger' small />
                        </View>
                    ))}
                </View>
            </GlassCard>
        </Screen>
    )
}

function createStyles(theme: ThemePalette) {
    return {
        inlineInput: {
            minHeight: 46,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: theme.surfaceBorderSoft,
            backgroundColor: theme.backgroundRaised,
            paddingHorizontal: 14,
            color: theme.text,
            fontSize: 15,
        } as const,
    }
}
