import { Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { Check, X } from 'lucide-react-native'
import type { Organization } from '../lib/profile-api'
import { useAppTheme } from '../theme/context'
import { InlineNotice, PillButton } from './ui'

export function WorkspacePicker({ open, organizations, selectedId, error, onClose, onSelect, onManage, onRetry }: {
    open: boolean; organizations: Organization[]; selectedId: string; error: string
    onClose: () => void; onSelect: (id: string) => void; onManage: () => void; onRetry: () => void
}) {
    const theme = useAppTheme()
    const options = [{ id: 'personal', name: 'Personal', role: 'Your account' }, ...organizations]
    return <Modal visible={open} transparent animationType='slide' onRequestClose={onClose}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0009' }}>
            <Pressable accessibilityLabel='Close workspace selection' style={{ flex: 1 }} onPress={onClose} />
            <View style={{ maxHeight: '75%', padding: 22, paddingBottom: 36, gap: 16, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: theme.backgroundAlt }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Text style={{ color: theme.text, fontSize: 22, fontWeight: '700' }}>Switch workspace</Text><Pressable accessibilityLabel='Close workspace selection' onPress={onClose}><X color={theme.textMuted} /></Pressable></View>
                <ScrollView>{options.map(item => <Pressable key={item.id} accessibilityRole='button' accessibilityLabel={`Use ${item.name} workspace`} accessibilityState={{ selected: selectedId === item.id }} onPress={() => onSelect(item.id)} style={{ flexDirection: 'row', alignItems: 'center', padding: 16, marginBottom: 8, borderRadius: 16, borderWidth: 1, borderColor: selectedId === item.id ? theme.surfaceBorder : theme.surfaceBorderSoft, backgroundColor: selectedId === item.id ? theme.surfaceStrong : theme.ambientNeutral }}>
                    <View style={{ flex: 1, gap: 5 }}><Text style={{ color: theme.text, fontSize: 15, fontWeight: '700' }}>{item.name}</Text><Text style={{ color: theme.textMuted, fontSize: 12 }}>{item.role || 'Member'}</Text></View>{selectedId === item.id && <Check color={theme.accent} size={18} />}
                </Pressable>)}</ScrollView>
                {!!error && <InlineNotice message={error} />}
                <View style={{ flexDirection: 'row', gap: 10 }}><PillButton label='Manage organizations' onPress={onManage} /><PillButton label='Refresh' onPress={onRetry} small /></View>
            </View>
        </View>
    </Modal>
}
