import { useState } from 'react'
import { Text, TextInput, View } from 'react-native'
import { useAppTheme } from '../../theme/context'
import { PillButton } from '../../components/ui'
import { text, type Row } from './model'
import type { CaseController } from './controller'
export function CaseText({ children, heading = false }: { children: React.ReactNode; heading?: boolean }) {
    const t = useAppTheme()
    return <Text
        selectable
        style={{ color: heading ? t.text : t.textMuted, fontSize: heading ? 18 : 14, fontWeight: heading ? '700' : '400', lineHeight: 23 }}
    >{children}</Text>
}
export function Actions({ children }: { children: React.ReactNode }) { return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View> }
export function CaseInput({ label, value, onChange, ops, host, limit = 5000, multiline = false, disabled = false }: { label: string; value: string; onChange: (v: string) => void; ops: CaseController; host: number; limit?: number; multiline?: boolean; disabled?: boolean }) {
    const t = useAppTheme()
    return <View style={{ gap: 5 }}>
        <CaseText>{label}</CaseText>
        <TextInput
            key={`${label}:${host}`}
            accessibilityLabel={label}
            value={value}
            editable={ops.idle(host) && !ops.unknown && !disabled}
            onChangeText={v => { if (ops.idle(host) && !ops.unknown && !disabled) onChange(v) }}
            multiline={multiline}
            maxLength={limit}
            autoCorrect={false}
            autoCapitalize='none'
            autoComplete='off'
            textContentType='none'
            style={{ color: t.text, borderColor: t.surfaceBorder, borderWidth: 1, borderRadius: 12, padding: 12, minHeight: multiline ? 90 : 46 }}
        />
    </View>
}
export function Options({ label, values, value, choose, disabled = false }: { label: string; values: string[]; value: string; choose: (v: string) => void; disabled?: boolean }) {
    return <View style={{ gap: 6 }}>
        <CaseText>{label}</CaseText>
        <Actions>
            {values.map(v => <PillButton key={v} label={`${value === v ? '✓ ' : ''}${v.replaceAll('_', ' ')}`} disabled={disabled} onPress={() => choose(v)} />)}
        </Actions>
    </View>
}
const label = (v: string) => v.replace(/([A-Z])/g, ' $1').replaceAll('_', ' ')
// Technical evidence is already redacted by Core. Render every bounded field with labels, not a JSON blob.
export function Evidence({ value, depth = 0 }: { value: Row; depth?: number }) {
    const [limit, setLimit] = useState(20)
    const entries = Object.entries(value)
    if (depth > 8) return <CaseText>Further nested evidence cannot be displayed.</CaseText>
    return <View style={{ gap: 8 }}>
        {entries.slice(0, limit).map(([k, v]) => <View key={k} style={{ gap: 3 }}>

            <CaseText heading>{label(k)}</CaseText>

            {v && typeof v === 'object' ? Array.isArray(v) ? v.slice(0, limit).map((item, i) => <View key={i} style={{ paddingLeft: 10 }}>
                {item && typeof item === 'object' && !Array.isArray(item) ? <Evidence value={item as Row} depth={depth + 1} /> : <CaseText>{String(item ?? 'Not recorded')}</CaseText>}
            </View>) : <Evidence value={v as Row} depth={depth + 1} /> : <CaseText>{typeof v === 'boolean' ? v ? 'Yes' : 'No' : v == null ? 'Not recorded' : String(v)}</CaseText>}

        </View>)}
        {(entries.length > limit || entries.some(([, v]) => Array.isArray(v) && v.length > limit)) && <PillButton label='Show more evidence fields' onPress={() => setLimit(n => n + 20)} />}
    </View>
}
export function CheckFields({ value }: { value: Row }) {
    if (!Object.keys(value).length) return <CaseText>Check configuration was not recorded.</CaseText>
    return <View style={{ gap: 4 }}>
        {[
            ['Endpoint', text(value.endpoint) || 'Not recorded'], ['Check type', text(value.checkType) || 'Not recorded'],
            ['Timeout', value.timeoutSeconds == null ? 'Not recorded' : `${value.timeoutSeconds} seconds`], ['Retries', value.retryCount == null ? 'Not recorded' : String(value.retryCount)],
            ['Follow redirects', value.followRedirects == null ? 'Not recorded' : value.followRedirects ? 'Yes' : 'No'], ['Expected result', value.expectedDown || value.upsideDown ? 'Failure / unavailable (inverted)' : 'Successful response'],
        ].map(([k, v]) => <CaseText key={k}>{k}: {v}</CaseText>)}
    </View>
}
