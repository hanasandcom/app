import { TextInput, View } from 'react-native'
import { useAppTheme } from '../../theme/context'
import { VmText } from './ui'
export function VmField({ label, value, onChange, multiline = false, secret = false, enabled = true, max = 1200 }: {
    label: string; value: string; onChange: (value: string) => void; multiline?: boolean; secret?: boolean; enabled?: boolean; max?: number
}) {
    const theme = useAppTheme()
    return <View style={{ gap: 6 }}>
        <VmText>{label}</VmText>
        <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} editable={enabled} multiline={multiline}
            secureTextEntry={secret} maxLength={max} autoCorrect={false} autoCapitalize='none'
            style={{ color: theme.text, backgroundColor: theme.surfaceStrong, borderColor: theme.surfaceBorder, borderWidth: 1,
                padding: 12, borderRadius: 10, minHeight: multiline ? 100 : 46, textAlignVertical: multiline ? 'top' : 'center' }} />
    </View>
}
