import { useEffect, useRef, useState } from 'react'
import { Alert, Linking, Share, TextInput, View } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { generateSync } from 'otplib'
import { assignDashboardUserRole, deleteShare as deleteShareRequest, fetchAiModels, fetchDashboardRoles, fetchDashboardUserRoles, fetchDashboardUsers, fetchServerText, fetchShareTree, fetchTopDomains, fetchUserShares, runDesktopAgentCommand, setDashboardUserActive, setShareLock, triggerServerAction, createShare as createShareRequest, unassignDashboardUserRole, updateShare as updateShareRequest } from '../lib/api'
import type { AppSettings, AuthenticatorEntry, DashboardRole, DashboardUser, DashboardUserRoleAssignment, GptClient, ShareSummary, ShareTreeItem } from '../types'
import { GlassCard, LabeledInput, NativeTile, PillButton, Screen, SectionTitle } from '../components/ui'
import { spacing, type ThemePalette } from '../theme/tokens'
import { useAppTheme } from '../theme/context'
import { routeShortcuts } from '../data/routes'

function buildAuthenticatorEntryFromUri(payload: string): AuthenticatorEntry | null {
    try {
        if (!payload.startsWith('otpauth://totp/')) return null
        const url = new URL(payload)
        const rawLabel = decodeURIComponent(url.pathname.replace(/^\//, ''))
        const [issuerFromLabel, account] = rawLabel.includes(':') ? rawLabel.split(':', 2) : ['', rawLabel]
        const secret = url.searchParams.get('secret') || ''
        const issuer = url.searchParams.get('issuer') || issuerFromLabel || undefined
        const digits = Number(url.searchParams.get('digits') || '6')
        const period = Number(url.searchParams.get('period') || '30')
        if (!secret) return null
        return {
            id: `${Date.now()}`,
            label: issuer ? `${issuer}${account ? ` · ${account}` : ''}` : account || 'Authenticator code',
            issuer,
            account,
            secret: secret.replace(/\s+/g, ''),
            digits,
            period,
        }
    } catch {
        return null
    }
}

function tokenForEntry(entry: AuthenticatorEntry) {
    try {
        return generateSync({ secret: entry.secret, digits: entry.digits, period: entry.period })
    } catch {
        return 'Invalid secret'
    }
}

export function ControlScreen({
    settings,
    onSaveSettings,
    onImpersonate,
    authenticatorEntries,
    onSaveAuthenticatorEntries,
}: {
    settings: AppSettings
    onSaveSettings: (next: AppSettings) => Promise<void> | void
    onImpersonate: (user: DashboardUser) => Promise<void> | void
    authenticatorEntries: AuthenticatorEntry[]
    onSaveAuthenticatorEntries: (next: AuthenticatorEntry[]) => Promise<void>
}) {
    const theme = useAppTheme()
    const styles = createStyles(theme)
    const [draft, setDraft] = useState(settings)
    const [permission, requestPermission] = useCameraPermissions()
    const [cameraVisible, setCameraVisible] = useState(false)
    const [manualSecret, setManualSecret] = useState('')
    const [manualLabel, setManualLabel] = useState('')
    const [shares, setShares] = useState<ShareSummary[]>([])
    const [shareName, setShareName] = useState('')
    const [shareContent, setShareContent] = useState('')
    const [editingShareId, setEditingShareId] = useState('')
    const [editShareName, setEditShareName] = useState('')
    const [editSharePath, setEditSharePath] = useState('')
    const [editShareContent, setEditShareContent] = useState('')
    const [shareTrees, setShareTrees] = useState<Record<string, ShareTreeItem[]>>({})
    const [domains, setDomains] = useState<Array<{ name: string; tps?: number }>>([])
    const [models, setModels] = useState<GptClient[]>([])
    const [users, setUsers] = useState<DashboardUser[]>([])
    const [roles, setRoles] = useState<DashboardRole[]>([])
    const [selectedUserId, setSelectedUserId] = useState('')
    const [selectedUserRoles, setSelectedUserRoles] = useState<DashboardUserRoleAssignment[]>([])
    const [loadingShares, setLoadingShares] = useState(false)
    const [loadingRoles, setLoadingRoles] = useState(false)
    const [shareActionBusy, setShareActionBusy] = useState('')
    const [roleActionBusy, setRoleActionBusy] = useState('')
    const [serverBusy, setServerBusy] = useState<'start' | 'stop' | 'logs' | ''>('')
    const [serverLogs, setServerLogs] = useState('')
    const [desktopBusy, setDesktopBusy] = useState('')
    const [desktopCommandResult, setDesktopCommandResult] = useState('')
    const [savingSettings, setSavingSettings] = useState(false)
    const [authenticatorBusy, setAuthenticatorBusy] = useState('')
    const cameraLock = useRef(false)
    const [now, setNow] = useState(Date.now())

    useEffect(() => {
        setDraft(settings)
    }, [settings])

    useEffect(() => {
        void refreshNativeData()
    }, [])

    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
    }, [])

    async function refreshNativeData() {
        try {
            const [nextModels, nextDomains] = await Promise.all([
                fetchAiModels(draft).catch(() => []),
                fetchTopDomains(draft).catch(() => []),
            ])
            setModels(nextModels)
            setDomains(nextDomains)
        } catch {
            // keep silent in native status dashboard
        }
    }

    async function loadRoleAdmin() {
        if (loadingRoles) return
        setLoadingRoles(true)
        try {
            const [nextUsers, nextRoles] = await Promise.all([
                fetchDashboardUsers(draft),
                fetchDashboardRoles(draft),
            ])
            setUsers(nextUsers)
            setRoles(nextRoles)
            const nextSelected = selectedUserId && nextUsers.some(user => user.id === selectedUserId)
                ? selectedUserId
                : nextUsers[0]?.id || ''
            setSelectedUserId(nextSelected)
            if (nextSelected) {
                setSelectedUserRoles(await fetchDashboardUserRoles(draft, nextSelected))
            } else {
                setSelectedUserRoles([])
            }
        } catch (cause) {
            Alert.alert('Unable to load role admin', cause instanceof Error ? cause.message : 'Request failed.')
        } finally {
            setLoadingRoles(false)
        }
    }

    async function selectRoleUser(user: DashboardUser) {
        if (roleActionBusy) return
        setSelectedUserId(user.id)
        setRoleActionBusy(`load-${user.id}`)
        try {
            setSelectedUserRoles(await fetchDashboardUserRoles(draft, user.id))
        } catch (cause) {
            Alert.alert('Unable to load user roles', cause instanceof Error ? cause.message : 'Request failed.')
            setSelectedUserRoles([])
        } finally {
            setRoleActionBusy('')
        }
    }

    async function toggleRole(role: DashboardRole) {
        if (!selectedUserId || roleActionBusy) return
        const assigned = selectedUserRoles.some(item => item.roleId === role.id || item.id === role.id || item.name === role.name)
        setRoleActionBusy(role.id)
        try {
            if (assigned) {
                await unassignDashboardUserRole(draft, selectedUserId, role.id)
            } else {
                await assignDashboardUserRole(draft, selectedUserId, role.id)
            }
            setSelectedUserRoles(await fetchDashboardUserRoles(draft, selectedUserId))
        } catch (cause) {
            Alert.alert('Unable to update role', cause instanceof Error ? cause.message : 'Request failed.')
        } finally {
            setRoleActionBusy('')
        }
    }

    async function toggleUserActive(user: DashboardUser) {
        if (roleActionBusy) return
        const nextActive = user.active === false
        setRoleActionBusy(`active-${user.id}`)
        try {
            await setDashboardUserActive(draft, user.id, nextActive)
            setUsers(current => current.map(item => item.id === user.id ? { ...item, active: nextActive } : item))
        } catch (cause) {
            Alert.alert('Unable to update user', cause instanceof Error ? cause.message : 'Request failed.')
        } finally {
            setRoleActionBusy('')
        }
    }

    async function loadShares() {
        setLoadingShares(true)
        try {
            setShares(await fetchUserShares(draft))
        } catch (cause) {
            Alert.alert('Unable to load shares', cause instanceof Error ? cause.message : 'Request failed.')
        } finally {
            setLoadingShares(false)
        }
    }

    async function createShare() {
        if (loadingShares) return
        const name = shareName.trim() || `share-${Date.now()}`
        if (!shareContent.trim()) {
            Alert.alert('Missing share content', 'Add content before creating a share.')
            return
        }
        setLoadingShares(true)
        try {
            const share = await createShareRequest(draft, {
                id: `${Date.now()}`,
                content: shareContent,
                name,
                path: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                type: 'note',
            })
            setShares(current => [share, ...current])
            setShareName('')
            setShareContent('')
        } catch (cause) {
            Alert.alert('Unable to create share', cause instanceof Error ? cause.message : 'Request failed.')
        } finally {
            setLoadingShares(false)
        }
    }

    function beginEditShare(share: ShareSummary) {
        setEditingShareId(share.id)
        setEditShareName(share.name || '')
        setEditSharePath(share.path || '')
        setEditShareContent(share.content || '')
    }

    function upsertShare(next: ShareSummary) {
        setShares(current => current.map(share => share.id === next.id ? { ...share, ...next } : share))
    }

    async function saveShareEdits() {
        if (!editingShareId || shareActionBusy) return
        setShareActionBusy(editingShareId)
        try {
            const updated = await updateShareRequest(draft, editingShareId, {
                name: editShareName.trim() || undefined,
                path: editSharePath.trim() || undefined,
                content: editShareContent,
            })
            upsertShare(updated)
            setEditingShareId('')
        } catch (cause) {
            Alert.alert('Unable to update share', cause instanceof Error ? cause.message : 'Request failed.')
        } finally {
            setShareActionBusy('')
        }
    }

    async function toggleLock(share: ShareSummary) {
        if (shareActionBusy) return
        setShareActionBusy(share.id)
        try {
            upsertShare(await setShareLock(draft, share.id, !share.locked))
        } catch (cause) {
            Alert.alert('Unable to update lock', cause instanceof Error ? cause.message : 'Request failed.')
        } finally {
            setShareActionBusy('')
        }
    }

    async function loadShareTree(share: ShareSummary) {
        if (shareActionBusy) return
        setShareActionBusy(share.id)
        try {
            const tree = await fetchShareTree(draft, share.id)
            setShareTrees(current => ({ ...current, [share.id]: tree }))
        } catch (cause) {
            Alert.alert('Unable to load share tree', cause instanceof Error ? cause.message : 'Request failed.')
        } finally {
            setShareActionBusy('')
        }
    }

    async function deleteShare(share: ShareSummary) {
        if (shareActionBusy) return
        Alert.alert('Delete share?', share.name || share.path || share.id, [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete',
                style: 'destructive',
                onPress: () => {
                    void (async () => {
                        setShareActionBusy(share.id)
                        try {
                            await deleteShareRequest(draft, share.id)
                            setShares(current => current.filter(item => item.id !== share.id))
                            setShareTrees(current => {
                                const next = { ...current }
                                delete next[share.id]
                                return next
                            })
                            if (editingShareId === share.id) setEditingShareId('')
                        } catch (cause) {
                            Alert.alert('Unable to delete share', cause instanceof Error ? cause.message : 'Request failed.')
                        } finally {
                            setShareActionBusy('')
                        }
                    })()
                },
            },
        ])
    }

    function shareTreePreview(items: ShareTreeItem[], depth = 0): string {
        return items.slice(0, 12).map(item => {
            const prefix = `${'  '.repeat(depth)}${item.type === 'folder' ? '>' : '-'}`
            const children = item.children?.length ? `\n${shareTreePreview(item.children, depth + 1)}` : ''
            return `${prefix} ${item.name}${children}`
        }).join('\n')
    }

    async function openVpn() {
        try {
            if (draft.vpnUrlScheme && await Linking.canOpenURL(draft.vpnUrlScheme)) {
                await Linking.openURL(draft.vpnUrlScheme)
                return
            }
            await Linking.openSettings()
        } catch {
            Alert.alert('VPN shortcut unavailable', 'The app could not open the VPN shortcut, so Settings was used as the fallback.')
        }
    }

    async function runServerAction(path: string) {
        const actionPath = path.trim()
        if (serverBusy) return
        if (!draft.serverBaseUrl.trim() || !actionPath) {
            Alert.alert('Missing server setup', 'Add the server base URL and action path first.')
            return
        }

        const action = actionPath === draft.serverStopPath.trim() ? 'stop' : 'start'
        setServerBusy(action)
        try {
            const result = await triggerServerAction(serverUrl(actionPath), draft)
            Alert.alert('Server action finished', result || 'Done')
        } catch (cause) {
            Alert.alert('Server action failed', cause instanceof Error ? cause.message : 'Unable to reach the remote management plane.')
        } finally {
            setServerBusy('')
        }
    }

    function serverUrl(pathOrUrl: string) {
        const trimmed = pathOrUrl.trim()
        if (/^https?:\/\//i.test(trimmed)) return trimmed
        return `${draft.serverBaseUrl.replace(/\/$/, '')}/${trimmed.replace(/^\//, '')}`
    }

    function siteUrl(path: string) {
        return `${draft.siteBaseUrl.trim().replace(/\/+$/, '')}/${path.trim().replace(/^\/+/, '')}`
    }

    async function openRemote(protocol: 'rdp' | 'vnc') {
        const host = protocol === 'rdp' ? draft.remoteDesktopHost.trim() : (draft.vncHost.trim() || draft.remoteDesktopHost.trim())
        if (!host) {
            Alert.alert('Missing host', protocol === 'rdp' ? 'Add an RDP host first.' : 'Add a VNC host first.')
            return
        }

        const target = encodeRemoteTarget(host)
        const url = protocol === 'rdp'
            ? `rdp://full%20address=s:${target}${draft.remoteDesktopUser.trim() ? `&username=s:${encodeRemoteTarget(draft.remoteDesktopUser.trim())}` : ''}`
            : `vnc://${target}`

        try {
            const supported = await Linking.canOpenURL(url)
            if (!supported) {
                Alert.alert(protocol === 'rdp' ? 'RDP app needed' : 'VNC app needed', `No app is registered for ${protocol.toUpperCase()} links on this device.`)
                return
            }
            await Linking.openURL(url)
        } catch (cause) {
            Alert.alert('Remote desktop failed', cause instanceof Error ? cause.message : `Unable to open ${protocol.toUpperCase()}.`)
        }
    }

    async function runDesktopControlCommand(command: string, label: string) {
        if (desktopBusy) return
        setDesktopBusy(command)
        try {
            const result = await runDesktopAgentCommand(draft, command)
            setDesktopCommandResult(result.message || `${label} sent to this Mac.`)
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : `${label} failed.`
            setDesktopCommandResult(message)
            Alert.alert(label, message)
        } finally {
            setDesktopBusy('')
        }
    }

    function encodeRemoteTarget(value: string) {
        return encodeURIComponent(value).replace(/%3A/gi, ':').replace(/%40/gi, '@')
    }

    async function checkServerLogs() {
        if (serverBusy) return
        if (!draft.serverBaseUrl.trim() || !draft.serverLogsPath.trim()) {
            Alert.alert('Missing logs setup', 'Add the server base URL and logs path first.')
            return
        }

        setServerBusy('logs')
        try {
            const logs = await fetchServerText(serverUrl(draft.serverLogsPath), draft)
            setServerLogs(logs.trim().slice(0, 1600) || 'No logs returned.')
        } catch (cause) {
            Alert.alert('Unable to load logs', cause instanceof Error ? cause.message : 'Request failed.')
        } finally {
            setServerBusy('')
        }
    }

    async function openShortcut(path: string) {
        const url = siteUrl(path)
        try {
            await Linking.openURL(url)
        } catch (cause) {
            Alert.alert('Unable to open shortcut', cause instanceof Error ? cause.message : url)
        }
    }

    async function openShare(share: ShareSummary) {
        const sharePath = share.path || share.id
        const url = share.alias
            ? `https://${share.alias}.hanasand.com`
            : siteUrl(`s/${sharePath}`)
        try {
            await Linking.openURL(url)
        } catch (cause) {
            Alert.alert('Unable to open share', cause instanceof Error ? cause.message : url)
        }
    }

    async function shareRemoteSetup() {
        const content = [
            `RDP host: ${draft.remoteDesktopHost || '(set host)'}`,
            `RDP user: ${draft.remoteDesktopUser || '(set user)'}`,
            `VNC host: ${draft.vncHost || '(set host)'}`,
            `Codex remote: ${draft.codexUrl}`,
            `Server plane: ${draft.serverBaseUrl}`,
        ].join('\n')
        try {
            await Share.share({ message: content })
        } catch (cause) {
            Alert.alert('Unable to share setup', cause instanceof Error ? cause.message : 'Share failed.')
        }
    }

    async function saveRemoteSetup() {
        if (savingSettings) return
        setSavingSettings(true)
        try {
            await onSaveSettings(draft)
        } catch (cause) {
            Alert.alert('Save setup failed', cause instanceof Error ? cause.message : 'Settings could not be saved.')
        } finally {
            setSavingSettings(false)
        }
    }

    async function handleScan(payload: string) {
        if (cameraLock.current) return
        cameraLock.current = true
        setCameraVisible(false)
        const entry = buildAuthenticatorEntryFromUri(payload)
        if (entry) {
            await saveAuthenticatorEntry(entry)
        } else {
            Alert.alert('QR scanned', payload)
        }
        setTimeout(() => {
            cameraLock.current = false
        }, 900)
    }

    async function saveAuthenticatorEntry(entry: AuthenticatorEntry) {
        if (authenticatorBusy) return false
        setAuthenticatorBusy(entry.id)
        try {
            const existing = authenticatorEntries.find(item => item.secret.toUpperCase() === entry.secret.toUpperCase())
            const next = existing
                ? authenticatorEntries.map(item => item.id === existing.id ? { ...item, ...entry, id: existing.id } : item)
                : [entry, ...authenticatorEntries]
            await onSaveAuthenticatorEntries(next)
            Alert.alert(existing ? 'Authenticator updated' : 'Authenticator added', entry.label)
            return true
        } catch (cause) {
            Alert.alert('Authenticator save failed', cause instanceof Error ? cause.message : 'Could not save authenticator code.')
            return false
        } finally {
            setAuthenticatorBusy('')
        }
    }

    async function saveManualCode() {
        if (authenticatorBusy) return
        const secret = manualSecret.trim().replace(/\s+/g, '')
        if (!secret) {
            Alert.alert('Missing secret', 'Add a TOTP secret first.')
            return
        }
        const saved = await saveAuthenticatorEntry({
            id: `${Date.now()}`,
            label: manualLabel.trim() || 'Authenticator code',
            secret,
            digits: 6,
            period: 30,
        })
        if (saved) {
            setManualLabel('')
            setManualSecret('')
        }
    }

    async function removeAuthenticatorEntry(id: string) {
        if (authenticatorBusy) return
        const entry = authenticatorEntries.find(item => item.id === id)
        if (!entry) return
        Alert.alert('Delete authenticator code?', entry.label, [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete',
                style: 'destructive',
                onPress: () => {
                    void (async () => {
                        setAuthenticatorBusy(id)
                        try {
                            await onSaveAuthenticatorEntries(authenticatorEntries.filter(item => item.id !== id))
                        } catch (cause) {
                            Alert.alert('Delete failed', cause instanceof Error ? cause.message : 'Could not delete authenticator code.')
                        } finally {
                            setAuthenticatorBusy('')
                        }
                    })()
                },
            },
        ])
    }

    const otpCards = authenticatorEntries.slice(0, 5).map(entry => {
        const token = tokenForEntry(entry)
        const remaining = entry.period - Math.floor((now / 1000) % entry.period)
        return { entry, token, remaining }
    })
    const cdnConfigured = Boolean(draft.cdnBaseUrl.trim() && draft.authToken.trim() && draft.userId.trim())
    const appConfigured = Boolean(draft.apiBaseUrl.trim() && draft.authToken.trim() && draft.userId.trim())
    const selectedUser = users.find(user => user.id === selectedUserId)

    return (
        <Screen title='Utilities' subtitle=''>
            <GlassCard>
                <SectionTitle eyebrow='Utilities' title='QR + authenticator' />
                <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginTop: spacing.md }}>
                    <PillButton label={authenticatorBusy ? 'Working...' : 'Scan QR'} onPress={async () => {
                        if (!permission?.granted) {
                            const next = await requestPermission()
                            if (!next.granted) {
                                Alert.alert('Camera access needed', 'Allow camera access before scanning QR codes.')
                                return
                            }
                        }
                        setCameraVisible(true)
                    }} tone='accent' disabled={!!authenticatorBusy} />
                    {cameraVisible && <PillButton label='Hide camera' onPress={() => setCameraVisible(false)} disabled={!!authenticatorBusy} />}
                </View>
                {cameraVisible && permission?.granted && (
                    <View style={{ marginTop: spacing.md, overflow: 'hidden', borderRadius: 22 }}>
                        <CameraView
                            style={{ height: 220 }}
                            facing='back'
                            autofocus='on'
                            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                            onBarcodeScanned={({ data }) => void handleScan(data)}
                        />
                    </View>
                )}
                <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
                    <TextInput value={manualLabel} onChangeText={setManualLabel} placeholder='Authenticator label' placeholderTextColor={theme.textSoft} style={styles.inlineInput} />
                    <TextInput value={manualSecret} onChangeText={setManualSecret} placeholder='Manual secret' placeholderTextColor={theme.textSoft} style={styles.inlineInput} autoCapitalize='characters' />
                    <PillButton label={authenticatorBusy ? 'Saving...' : 'Add code manually'} onPress={() => void saveManualCode()} small disabled={!!authenticatorBusy} />
                </View>
                <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
                    {otpCards.map(({ entry, token, remaining }) => (
                        <View key={entry.id} style={{ gap: spacing.xs }}>
                            <NativeTile eyebrow='Authenticator' title={entry.label} body={token} meta={`${remaining}s remaining`} />
                            <PillButton label={authenticatorBusy === entry.id ? 'Deleting...' : 'Delete code'} onPress={() => void removeAuthenticatorEntry(entry.id)} tone='danger' small disabled={!!authenticatorBusy} />
                        </View>
                    ))}
                </View>
            </GlassCard>

            <GlassCard>
                <SectionTitle eyebrow='Admin' title='Users and roles' body='Native mobile controls for the same role assignment flow as the dashboard and Desktop app.' />
                <View style={{ gap: spacing.md, marginTop: spacing.md }}>
                    <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
                        <PillButton label={loadingRoles ? 'Loading...' : 'Load users'} onPress={() => void loadRoleAdmin()} tone='accent' disabled={loadingRoles || !appConfigured} />
                        {!!selectedUser && <PillButton label={roleActionBusy === `active-${selectedUser.id}` ? 'Updating...' : selectedUser.active === false ? 'Activate user' : 'Deactivate user'} onPress={() => void toggleUserActive(selectedUser)} tone={selectedUser.active === false ? 'default' : 'danger'} disabled={!!roleActionBusy || !appConfigured} />}
                        {!!selectedUser && selectedUser.id !== settings.userId && <PillButton label={`Impersonate ${selectedUser.id}`} onPress={() => void onImpersonate(selectedUser)} disabled={!!roleActionBusy || !appConfigured} />}
                    </View>
                    <View style={{ gap: spacing.sm }}>
                        {users.slice(0, 6).map(user => (
                            <NativeTile
                                key={user.id}
                                eyebrow={user.active === false ? 'Inactive user' : 'User'}
                                title={user.name || user.id}
                                body={user.role || user.roles?.map(role => role.name || role.id).join(', ') || 'No role summary'}
                                meta={user.id}
                                onPress={() => void selectRoleUser(user)}
                            />
                        ))}
                        {!users.length && (
                            <NativeTile
                                eyebrow='Users'
                                title={appConfigured ? 'No users loaded' : 'Sign in required'}
                                body={appConfigured ? 'Load users to manage role assignments.' : 'Log in again to refresh the session used for admin controls.'}
                                meta='Role admin'
                            />
                        )}
                    </View>
                    {!!selectedUser && (
                        <View style={{ gap: spacing.sm }}>
                            <SectionTitle eyebrow='Selected user' title={selectedUser.name || selectedUser.id} body={`${selectedUserRoles.length} assigned roles`} />
                            {selectedUser.id !== settings.userId && <PillButton label={`Impersonate ${selectedUser.id}`} onPress={() => void onImpersonate(selectedUser)} tone='accent' small disabled={!!roleActionBusy || !appConfigured} />}
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                                {roles.map(role => {
                                    const assigned = selectedUserRoles.some(item => item.roleId === role.id || item.id === role.id || item.name === role.name)
                                    return (
                                        <PillButton
                                            key={role.id}
                                            label={`${assigned ? 'Remove' : 'Assign'} ${role.name || role.id}`}
                                            onPress={() => void toggleRole(role)}
                                            tone={assigned ? 'danger' : 'default'}
                                            small
                                            disabled={!!roleActionBusy || !appConfigured}
                                        />
                                    )
                                })}
                            </View>
                        </View>
                    )}
                </View>
            </GlassCard>

            <GlassCard>
                <SectionTitle eyebrow='Shares' title='Create, edit, lock, and inspect shares' />
                <View style={{ gap: spacing.md, marginTop: spacing.md }}>
                    <TextInput value={shareName} onChangeText={setShareName} placeholder='Share name' placeholderTextColor={theme.textSoft} style={styles.inlineInput} />
                    <TextInput value={shareContent} onChangeText={setShareContent} placeholder='Share content' placeholderTextColor={theme.textSoft} multiline style={[styles.inlineInput, { minHeight: 96, paddingTop: 14, textAlignVertical: 'top' }]} />
                    <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
                        <PillButton label={loadingShares ? 'Working...' : 'Create share'} onPress={() => void createShare()} tone='accent' disabled={loadingShares || !cdnConfigured} />
                        <PillButton label={loadingShares ? 'Loading...' : 'Load my shares'} onPress={() => void loadShares()} disabled={loadingShares || !cdnConfigured} />
                    </View>
                    {!!editingShareId && (
                        <View style={{ gap: spacing.sm }}>
                            <SectionTitle eyebrow='Editing' title={editShareName || editingShareId} body='Save writes back through the same share endpoint the website uses.' />
                            <TextInput value={editShareName} onChangeText={setEditShareName} placeholder='Share name' placeholderTextColor={theme.textSoft} style={styles.inlineInput} />
                            <TextInput value={editSharePath} onChangeText={setEditSharePath} placeholder='Path' placeholderTextColor={theme.textSoft} style={styles.inlineInput} autoCapitalize='none' />
                            <TextInput value={editShareContent} onChangeText={setEditShareContent} placeholder='Content' placeholderTextColor={theme.textSoft} multiline style={[styles.inlineInput, { minHeight: 128, paddingTop: 14, textAlignVertical: 'top' }]} />
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                                <PillButton label={shareActionBusy === editingShareId ? 'Saving...' : 'Save edits'} onPress={() => void saveShareEdits()} tone='accent' disabled={shareActionBusy === editingShareId || !cdnConfigured} />
                                <PillButton label='Cancel edit' onPress={() => setEditingShareId('')} disabled={!!shareActionBusy} />
                            </View>
                        </View>
                    )}
                    <View style={{ gap: spacing.sm }}>
                        {shares.slice(0, 5).map(share => (
                            <View key={share.id} style={{ gap: spacing.xs }}>
                                <NativeTile
                                    eyebrow={share.locked ? 'Locked share' : 'Share'}
                                    title={share.name || share.id}
                                    body={share.path || share.alias || 'Workspace share'}
                                    meta={share.alias ? `${share.alias}.hanasand.com` : share.id}
                                    onPress={() => void openShare(share)}
                                />
                                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                                    <PillButton label='Edit' onPress={() => beginEditShare(share)} small disabled={!!shareActionBusy || !cdnConfigured} />
                                    <PillButton label={share.locked ? 'Unlock' : 'Lock'} onPress={() => void toggleLock(share)} small disabled={shareActionBusy === share.id || !cdnConfigured} />
                                    <PillButton label='Tree' onPress={() => void loadShareTree(share)} small disabled={shareActionBusy === share.id || !cdnConfigured} />
                                    <PillButton label='Delete' onPress={() => void deleteShare(share)} tone='danger' small disabled={shareActionBusy === share.id || !cdnConfigured} />
                                </View>
                                {!!shareTrees[share.id]?.length && (
                                    <NativeTile
                                        eyebrow='Tree'
                                        title={`${shareTrees[share.id].length} top-level items`}
                                        body={shareTreePreview(shareTrees[share.id])}
                                        meta='Loaded from /share/tree'
                                    />
                                )}
                            </View>
                        ))}
                    </View>
                </View>
            </GlassCard>

            <GlassCard>
                <SectionTitle eyebrow='System' title='Status' />
                <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
                    {models.slice(0, 3).map(model => (
                        <NativeTile key={model.name} eyebrow='Model' title={model.name} body={`Status: ${model.model?.status || 'unknown'}`} meta={model.model?.tps ? `${model.model.tps.toFixed(1)} tps` : 'No TPS yet'} />
                    ))}
                    {domains.slice(0, 3).map(domain => (
                        <NativeTile key={domain.name} eyebrow='Traffic' title={domain.name} body='Top active domain' meta={typeof domain.tps === 'number' ? `${domain.tps.toFixed(1)} tps` : 'Live'} />
                    ))}
                    {!!serverLogs && (
                        <NativeTile
                            eyebrow='Logs'
                            title='Latest server logs'
                            body={serverLogs}
                            meta='Fetched from the configured logs path'
                        />
                    )}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                        <PillButton label='Refresh status' onPress={() => void refreshNativeData()} tone='accent' />
                        <PillButton label='Open VPN' onPress={() => void openVpn()} />
                        <PillButton label={serverBusy === 'start' ? 'Starting...' : 'Start server'} onPress={() => void runServerAction(draft.serverStartPath)} disabled={!!serverBusy} />
                        <PillButton label={serverBusy === 'stop' ? 'Stopping...' : 'Stop server'} onPress={() => void runServerAction(draft.serverStopPath)} tone='danger' disabled={!!serverBusy} />
                        <PillButton label={serverBusy === 'logs' ? 'Loading logs...' : 'Check logs'} onPress={() => void checkServerLogs()} disabled={!!serverBusy} />
                    </View>
                </View>
            </GlassCard>

            <GlassCard>
                <SectionTitle eyebrow='Desktop' title='Remote control' />
                <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
                    <NativeTile
                        eyebrow='Loopback agent'
                        title={draft.desktopAgentBaseUrl || 'Desktop agent URL not set'}
                        body={desktopCommandResult || 'Use Hanasand AI on the home screen for desktop tasks. These settings only verify the local bridge.'}
                        meta='No webview. Native app command endpoint.'
                    />
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                        <PillButton label={desktopBusy === 'remote_desktop_status' ? 'Checking...' : 'Status'} onPress={() => void runDesktopControlCommand('remote_desktop_status', 'Desktop status')} disabled={!!desktopBusy} />
                    </View>
                </View>
            </GlassCard>

            <GlassCard>
                <SectionTitle eyebrow='Website' title='Shortcuts' />
                <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
                    {routeShortcuts.map(shortcut => (
                        <NativeTile
                            key={shortcut.path}
                            eyebrow={shortcut.category}
                            title={shortcut.title}
                            body={shortcut.summary}
                            meta={shortcut.path}
                            onPress={() => void openShortcut(shortcut.path)}
                        />
                    ))}
                </View>
            </GlassCard>

            <GlassCard>
                <SectionTitle eyebrow='Remote setup' title='Settings' />
                <View style={{ gap: spacing.md, marginTop: spacing.md }}>
                    <LabeledInput label='API URL' value={draft.apiBaseUrl} onChangeText={value => setDraft(current => ({ ...current, apiBaseUrl: value }))} autoCapitalize='none' autoCorrect={false} keyboardType='url' textContentType='URL' />
                    <LabeledInput label='CDN API URL' value={draft.cdnBaseUrl} onChangeText={value => setDraft(current => ({ ...current, cdnBaseUrl: value }))} autoCapitalize='none' autoCorrect={false} keyboardType='url' textContentType='URL' />
                    <LabeledInput label='Codex URL' value={draft.codexUrl} onChangeText={value => setDraft(current => ({ ...current, codexUrl: value }))} autoCapitalize='none' autoCorrect={false} keyboardType='url' textContentType='URL' />
                    <LabeledInput label='Codex API path' value={draft.codexApiPath} onChangeText={value => setDraft(current => ({ ...current, codexApiPath: value }))} placeholder='/tools/ai' autoCapitalize='none' autoCorrect={false} />
                    <LabeledInput label='Desktop agent URL' value={draft.desktopAgentBaseUrl} onChangeText={value => setDraft(current => ({ ...current, desktopAgentBaseUrl: value }))} placeholder='http://localhost:45731' autoCapitalize='none' autoCorrect={false} keyboardType='url' textContentType='URL' />
                    <LabeledInput label='RDP host' value={draft.remoteDesktopHost} onChangeText={value => setDraft(current => ({ ...current, remoteDesktopHost: value }))} placeholder='mac-or-server.local' autoCapitalize='none' autoCorrect={false} />
                    <LabeledInput label='RDP user' value={draft.remoteDesktopUser} onChangeText={value => setDraft(current => ({ ...current, remoteDesktopUser: value }))} placeholder='eirik' autoCapitalize='none' autoCorrect={false} textContentType='username' />
                    <LabeledInput label='VNC host for this Mac' value={draft.vncHost} onChangeText={value => setDraft(current => ({ ...current, vncHost: value }))} placeholder='mac.local:5900' autoCapitalize='none' autoCorrect={false} />
                    <LabeledInput label='Server base URL' value={draft.serverBaseUrl} onChangeText={value => setDraft(current => ({ ...current, serverBaseUrl: value }))} autoCapitalize='none' autoCorrect={false} keyboardType='url' textContentType='URL' />
                    <LabeledInput label='Start path' value={draft.serverStartPath} onChangeText={value => setDraft(current => ({ ...current, serverStartPath: value }))} autoCapitalize='none' autoCorrect={false} />
                    <LabeledInput label='Stop path' value={draft.serverStopPath} onChangeText={value => setDraft(current => ({ ...current, serverStopPath: value }))} autoCapitalize='none' autoCorrect={false} />
                    <LabeledInput label='Logs path or URL' value={draft.serverLogsPath} onChangeText={value => setDraft(current => ({ ...current, serverLogsPath: value }))} autoCapitalize='none' autoCorrect={false} keyboardType='url' />
                    <LabeledInput label='VPN URL scheme' value={draft.vpnUrlScheme} onChangeText={value => setDraft(current => ({ ...current, vpnUrlScheme: value }))} placeholder='ciscoanyconnect://' autoCapitalize='none' autoCorrect={false} keyboardType='url' />
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                        <PillButton label={savingSettings ? 'Saving...' : 'Save setup'} onPress={() => void saveRemoteSetup()} tone='accent' disabled={savingSettings} />
                        <PillButton label='Open RDP' onPress={() => void openRemote('rdp')} disabled={savingSettings} />
                        <PillButton label='Open VNC' onPress={() => void openRemote('vnc')} disabled={savingSettings} />
                        <PillButton label='Share setup' onPress={() => void shareRemoteSetup()} disabled={savingSettings} />
                    </View>
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
