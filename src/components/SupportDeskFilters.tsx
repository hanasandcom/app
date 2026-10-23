import { Text, TextInput, View, type TextInputProps } from 'react-native'
import { emptyDeskFilters, type DeskFilters } from '../lib/support-desk'
import { GlassCard, PillButton, SectionTitle } from './ui'
import { useAppTheme } from '../theme/context'

export function SupportDeskInput({ label, ...props }: TextInputProps & { label: string }) {
    const theme = useAppTheme()
    return <View style={{ gap: 6 }}>
        <Text style={{ color: theme.textMuted, fontSize: 13 }}>{label}</Text>
        <TextInput {...props} accessibilityLabel={label} autoCapitalize='none' autoCorrect={false}
            spellCheck={false} autoComplete='off' placeholderTextColor={theme.textSoft}
            style={{ color: theme.text, borderWidth: 1, borderColor: theme.surfaceBorderSoft,
                borderRadius: 12, padding: 12, minHeight: props.multiline ? 88 : 44 }} />
    </View>
}
export function SupportDeskFilters({ filters, disabled, onChange, onApply }: {
    filters: DeskFilters; disabled: boolean; onChange: (filters: DeskFilters) => void; onApply: () => void
}) {
    const theme = useAppTheme()
    const choices = (field: 'status' | 'stars' | 'feedback', values: Array<[string, string]>) =>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {values.map(([value, label]) => <PillButton small key={value} label={label} disabled={disabled}
                tone={filters[field] === value ? 'accent' : 'default'}
                onPress={() => onChange({ ...filters, [field]: value })} />)}
        </View>
    return <GlassCard style={{ gap: 12 }}>
        <SectionTitle eyebrow='Queue' title='Find conversations' />
        <SupportDeskInput label='Search support conversations' value={filters.search} maxLength={160}
            editable={!disabled} onChangeText={search => onChange({ ...filters, search })} />
        {choices('status', [['open', 'Open'], ['resolved', 'Resolved'], ['all', 'All statuses']])}
        {choices('stars', [['all', 'All ratings'], ['rated', 'Rated'], ['unrated', 'Unrated'],
            ...[1, 2, 3, 4, 5].map(value => [String(value), `${value} stars`] as [string, string])])}
        {choices('feedback', [['all', 'All feedback'], ['comment', 'With comment'], ['none', 'No comment']])}
        <SupportDeskInput label='Created from (YYYY-MM-DD)' value={filters.from} maxLength={10}
            editable={!disabled} onChangeText={from => onChange({ ...filters, from })} />
        <SupportDeskInput label='Created through (YYYY-MM-DD)' value={filters.to} maxLength={10}
            editable={!disabled} onChangeText={to => onChange({ ...filters, to })} />
        <Text style={{ color: theme.textMuted, fontSize: 12 }}>
            Search, dates and feedback are checked across server records. Status filters the latest returned 100 conversations.
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <PillButton label='Apply filters' disabled={disabled} onPress={onApply} />
            <PillButton label='Clear filters' disabled={disabled} onPress={() => onChange({ ...emptyDeskFilters })} />
        </View>
    </GlassCard>
}
