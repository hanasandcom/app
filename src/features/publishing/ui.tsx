import type { ReactNode } from 'react'
import { Text, TextInput, View } from 'react-native'
import { useAppTheme } from '../../theme/context'

export function PublishingText({ children, muted = false, heading = false }: { children: ReactNode; muted?: boolean; heading?: boolean }) {
    const theme = useAppTheme()
    return <Text selectable style={{ color: muted ? theme.textMuted : theme.text, fontSize: heading ? 18 : 14, fontWeight: heading ? '600' : '400', lineHeight: heading ? 26 : 22 }}>{children}</Text>
}
export function PublishingField({ label, value, onChange, editable, multiline = false, host }: { label: string; value: string; onChange: (value: string) => void; editable: boolean; multiline?: boolean; host: number }) {
    const theme = useAppTheme()
    return <View style={{ gap: 6 }}>
        <PublishingText muted>{label}</PublishingText>
        <TextInput key={`${label}:${host}`} accessibilityLabel={label} value={value} onChangeText={onChange} editable={editable} multiline={multiline} autoCorrect={false} autoCapitalize='none' style={{ color: theme.text, backgroundColor: theme.surfaceStrong, borderColor: theme.surfaceBorder, borderWidth: 1, borderRadius: 12, padding: 12, minHeight: multiline ? 220 : 48, textAlignVertical: 'top' }} />
    </View>
}
export function PublishingActions({ children }: { children: ReactNode }) { return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View> }
