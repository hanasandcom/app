import { useRef, useState } from 'react'
import { Alert, Text, View } from 'react-native'
import { GlassCard, InlineNotice, PillButton, SectionTitle } from './ui'
import { DatabaseInput } from './DatabaseQuery'
import { validateBackupDraft, type BackupAction, type BackupDashboard, type BackupDraft } from '../lib/database-operations'
import { useAppTheme } from '../theme/context'

export function BackupActions({ dashboard, file, disabled, reviewEpoch, onRun }: { dashboard: BackupDashboard; file: string; disabled: boolean; reviewEpoch: number; onRun: (draft: BackupDraft, epoch: number) => void }) {
    const theme = useAppTheme(), [action, setAction] = useState<BackupAction>('backup'), [target, setTarget] = useState('restore_drill_mobile'), [confirmation, setConfirmation] = useState(''), [error, setError] = useState('')
    const draft: BackupDraft = { action, file, targetDatabase: target, confirmation }, fingerprint = JSON.stringify(draft)
    const latest = useRef({ fingerprint, disabled, reviewEpoch }); latest.current = { fingerprint, disabled, reviewEpoch }
    const liveTarget = dashboard.backups[0]?.database, restore = action === 'restore' || action === 'restore-live'
    const labels: Record<BackupAction, string> = { backup: 'Backup now', verify: 'Verify archive', delete: 'Delete archive', restore: 'Restore drill', 'restore-live': 'Restore live database' }
    function review() {
        if (disabled) return
        try { validateBackupDraft(draft, dashboard) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Review the operation.'); return }
        const snapshot = { ...latest.current }
        Alert.alert(`${labels[action]}?`, action === 'backup' ? 'Create and verify a backup of the configured Core database. Retention may remove older archives.' : action === 'verify' ? `Verify ${file}. Verification updates the archive metadata.` : action === 'delete' ? `Permanently delete ${file} and its verification metadata. This cannot be undone.` : action === 'restore' ? `Restore ${file} into isolated ${target.trim().toLowerCase()}, check integrity, then remove the temporary target.` : `Replace ALL data in live ${liveTarget} with ${file}. Database requests may fail during the switch.`, [{ text: 'Cancel', style: 'cancel' }, { text: labels[action], style: action === 'delete' || action === 'restore-live' ? 'destructive' : 'default', onPress: () => {
            if (latest.current.disabled || latest.current.reviewEpoch !== snapshot.reviewEpoch || latest.current.fingerprint !== snapshot.fingerprint) return
            onRun({ ...draft }, snapshot.reviewEpoch)
        } }])
    }
    return <GlassCard style={{ gap: 12 }}><SectionTitle title='Backup operations' eyebrow='Configured Core database' body='Operations continue on the server if this screen closes. Refresh and review the history if a result is uncertain.' /><InlineNotice message={error} /><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{(Object.keys(labels) as BackupAction[]).map(value => <PillButton key={value} small label={labels[value]} disabled={disabled} tone={value === action ? 'accent' : 'default'} onPress={() => { setAction(value); setConfirmation(''); setError('') }} />)}</View>
        {action !== 'backup' && <Text style={{ color: theme.textMuted }}>Selected archive: {file || 'Select an archive below'}</Text>}
        {action === 'restore' && <DatabaseInput label='Isolated target database' value={target} editable={!disabled} onChangeText={value => { setTarget(value); setConfirmation('') }} />}
        {action === 'restore-live' && <InlineNotice message={`This replaces the entire live ${liveTarget || 'database'}. The selected inventory database is not the restore target.`} />}
        {restore && <DatabaseInput label={`Type RESTORE ${action === 'restore' ? target.trim().toLowerCase() : liveTarget || 'database-name'}`} value={confirmation} editable={!disabled} onChangeText={setConfirmation} />}
        <PillButton label={`Review ${labels[action].toLowerCase()}`} tone={action === 'restore-live' || action === 'delete' ? 'danger' : 'accent'} disabled={disabled || action !== 'backup' && !file} onPress={review} />
    </GlassCard>
}
