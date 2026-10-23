import { useState } from 'react'
import { Switch, Text, TextInput, View } from 'react-native'
import { PillButton } from '../../components/ui'
import { useAppTheme } from '../../theme/context'
import type { RateRoute } from '../../lib/rate-limits'

export function RateText({ children }: { children: React.ReactNode }) {
    const theme = useAppTheme()
    return <Text style={{ color: theme.textMuted }}>{children}</Text>
}
export function RateField({ label, value, onChange, disabled = false, numeric = false, placeholder }: {
    label: string; value: string; onChange: (value: string) => void; disabled?: boolean; numeric?: boolean; placeholder?: string
}) {
    const theme = useAppTheme()
    return <View style={{ gap: 5 }}>
        <Text style={{ color: theme.text }}>{label}</Text>
        <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} editable={!disabled}
            keyboardType={numeric ? 'number-pad' : 'default'} autoCapitalize='none' autoCorrect={false}
            placeholder={placeholder} placeholderTextColor={theme.textMuted}
            style={{ color: theme.text, borderWidth: 1, borderColor: theme.surfaceBorder, borderRadius: 12, padding: 12, opacity: disabled ? 0.6 : 1 }} />
    </View>
}
export function RateToggle({ label, value, onChange, disabled }: {
    label: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean
}) {
    const theme = useAppTheme()
    return <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ color: theme.text, flex: 1 }}>{label}</Text>
        <Switch accessibilityLabel={label} value={value} onValueChange={onChange} disabled={disabled} />
    </View>
}
export function RateRouteFields({ method, route, routes, disabled, onChange }: {
    method: string; route: string; routes: RateRoute[]; disabled: boolean
    onChange: (value: RateRoute) => void
}) {
    const [query, setQuery] = useState('')
    const matches = routes.filter((item) => `${item.method} ${item.route}`.toLowerCase().includes(query.toLowerCase()))
    return <View style={{ gap: 8 }}>
        <RateField label='HTTP method' value={method} disabled={disabled} onChange={(value) => onChange({ method: value.toUpperCase(), route })} />
        <RateField label='Route' value={route} disabled={disabled} onChange={(value) => onChange({ method, route: value })} />
        {!disabled && <>
            <RateField label='Find a registered route' value={query} onChange={setQuery} placeholder='Method or path' />
            {!!query && <>
                <RateText>{matches.length} matching routes. Showing up to 12.</RateText>
                {matches.slice(0, 12).map((item) => <PillButton key={`${item.method}:${item.route}`} small
                    label={`${item.method} ${item.route}`} onPress={() => { onChange(item); setQuery('') }} />)}
            </>}
        </>}
    </View>
}
export const numberText = (value: number | null) => value === null || !Number.isFinite(value) ? '' : String(value)
export const fieldNumber = (value: string) => /^\d+$/.test(value.trim()) ? Number(value) : Number.NaN
export const newRateId = () => `native-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
