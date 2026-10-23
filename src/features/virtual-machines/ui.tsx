import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { useAppTheme } from '../../theme/context'
export function VmText({ children, strong = false }: { children: ReactNode; strong?: boolean }) {
    const theme = useAppTheme()
    return <Text selectable style={{ color: strong ? theme.text : theme.textMuted, fontWeight: strong ? '600' : '400', lineHeight: 21 }}>{children}</Text>
}
export function VmRow({ children }: { children: ReactNode }) { return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View> }
export function VmValue({ label, value }: { label: string; value: string | number | null | undefined }) {
    return <VmText>{label}: {value === null || value === undefined || value === '' ? 'Unavailable' : String(value)}</VmText>
}
