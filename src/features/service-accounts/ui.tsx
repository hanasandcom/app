import type { ReactNode } from 'react'
import { Text, TextInput, View } from 'react-native'
import { useAppTheme } from '../../theme/context'
export function AccountText({ children, strong = false }: { children: ReactNode; strong?: boolean }) {
    const theme = useAppTheme()
    return <Text selectable style={{ color: strong ? theme.text : theme.textMuted, fontWeight: strong ? '600' : '400', lineHeight: 21 }}>{children}</Text>
}
export function AccountRow({ children }: { children: ReactNode }) { return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View> }
export function AccountField({ label, value, onChange, enabled, max, multiline = false }: { label: string; value: string; onChange: (value: string) => void; enabled: boolean; max: number; multiline?: boolean }) {
    const theme = useAppTheme()
    return <View style={{ gap: 6 }}>
        <AccountText>{label}</AccountText>
        <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} editable={enabled} maxLength={max} multiline={multiline}
            autoCorrect={false} autoCapitalize='none' style={{ color: theme.text, borderColor: theme.surfaceBorder, backgroundColor: theme.surfaceStrong, borderWidth: 1,
                borderRadius: 10, padding: 12, minHeight: multiline ? 100 : 46, textAlignVertical: multiline ? 'top' : 'center' }} />
    </View>
}
