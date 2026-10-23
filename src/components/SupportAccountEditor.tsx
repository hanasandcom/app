import { useEffect, useRef, useState } from 'react'
import { Text } from 'react-native'
import { GlassCard, PillButton, SectionTitle } from './ui'
import { SupportDeskInput } from './SupportDeskFilters'
import { useAppTheme } from '../theme/context'

export function SupportAccountEditor({ disabled, active, clearRevision, onDirty, onReview }: {
    disabled: boolean; active: boolean; clearRevision: number; onDirty: () => boolean
    onReview: (field: 'password' | 'email', value: string) => void
}) {
    const theme = useAppTheme(), mounted = useRef(true)
    useEffect(() => () => { mounted.current = false }, [])
    const [password, setPassword] = useState(''), [email, setEmail] = useState('')
    useEffect(() => { setPassword(''); setEmail('') }, [active, clearRevision])
    return <GlassCard style={{ gap: 12 }}>
        <SectionTitle eyebrow='Selected customer' title='Account changes' />
        <Text style={{ color: theme.textMuted, lineHeight: 20 }}>
            A password change signs the customer out of existing sessions. These fields clear when you leave or background this screen.
        </Text>
        <SupportDeskInput label='Customer new password' value={password} secureTextEntry maxLength={1024}
            editable={!disabled} onChangeText={value => { if (mounted.current && onDirty()) setPassword(value) }} />
        <PillButton label='Review password change' disabled={disabled || !password}
            onPress={() => onReview('password', password)} />
        <SupportDeskInput label='Customer new email address' value={email} keyboardType='email-address'
            editable={!disabled} maxLength={254} onChangeText={value => { if (mounted.current && onDirty()) setEmail(value) }} />
        <PillButton label='Review email change' disabled={disabled || !email}
            onPress={() => onReview('email', email.trim())} />
    </GlassCard>
}
