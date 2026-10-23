import { Text, View } from 'react-native'
import { useAppTheme } from '../../theme/context'
export function SystemText({ children, heading = false }: { children: React.ReactNode; heading?: boolean }) {
    const theme = useAppTheme()
    return <Text selectable style={{ color: heading ? theme.text : theme.textMuted, lineHeight: 22, fontSize: heading ? 18 : 14, fontWeight: heading ? '700' : '400' }}>{children}</Text>
}
export function SystemActions({ children }: { children: React.ReactNode }) { return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View> }
