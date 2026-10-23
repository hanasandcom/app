import type { ReactNode } from 'react'
import { Text, TextInput, View } from 'react-native'
import { useAppTheme } from '../../theme/context'

export function ThesisText({ children, muted = false, heading = false }: { children: ReactNode; muted?: boolean; heading?: boolean }) {
    const theme = useAppTheme()
    return <Text selectable style={{ color: muted ? theme.textMuted : theme.text, fontSize: heading ? 18 : 14, lineHeight: heading ? 25 : 21, fontWeight: heading ? '600' : '400' }}>{children}</Text>
}
export function ThesisField({ label, value, onChange, enabled = true, multiline = false, host = 0, numeric = false }: { label: string; value: string; onChange: (value: string) => void; enabled?: boolean; multiline?: boolean; host?: number; numeric?: boolean }) {
    const theme = useAppTheme()
    return (
        <View style={{ gap: 5 }}>
            <ThesisText muted>{label}</ThesisText>
            <TextInput
                key={`${label}:${host}`}
                accessibilityLabel={label}
                value={value}
                editable={enabled}
                onChangeText={onChange}
                multiline={multiline}
                keyboardType={numeric ? 'decimal-pad' : 'default'}
                autoCapitalize='none'
                autoCorrect={false}
                style={{ color: theme.text, borderColor: theme.surfaceBorder, borderWidth: 1, borderRadius: 12, minHeight: multiline ? 120 : 48, padding: 12, textAlignVertical: 'top', backgroundColor: theme.surfaceStrong }}
            />
        </View>
    )
}
export function Actions({ children }: { children: ReactNode }) { return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View> }
