import { useState } from 'react'
import { View } from 'react-native'
import { GlassCard, PillButton } from '../../components/ui'
import type { ThesisDocument } from './document'
import { identifiedSheets } from './workspace'
import { MarkdownView } from './MarkdownView'
import { Actions, ThesisText } from './ui'
import { SheetMetadata } from './SheetMetadata'

export function ConflictPanel({ draft, remote, disabled, onResolve }: { draft: ThesisDocument; remote: ThesisDocument; disabled: boolean; onResolve: (useLocal: boolean) => void }) {
    const [showRemote, setShowRemote] = useState(true)
    const value = showRemote ? remote : draft
    return (
        <GlassCard>
            <View style={{ gap: 12 }}>
                <ThesisText heading>Review shared changes</ThesisText>
                <ThesisText>Your draft is kept. Compare both versions before choosing the text to keep.</ThesisText>
                <Actions>
                    <PillButton label='View latest shared version' onPress={() => setShowRemote(true)} />
                    <PillButton label='View my draft' onPress={() => setShowRemote(false)} />
                </Actions>
                <ThesisText heading>{showRemote ? 'Latest shared version' : 'My draft'} · revision {value.revision}</ThesisText>
                {identifiedSheets(value.title, value.body).map(sheet => (
                    <View key={sheet.id} style={{ gap: 8 }}>
                        <ThesisText heading>{sheet.name}</ThesisText>
                        <MarkdownView source={sheet.title + '\n\n' + sheet.body} />
                        <SheetMetadata sheet={sheet} />
                    </View>
                ))}
                <Actions>
                    <PillButton label='Use my draft' disabled={disabled} onPress={() => onResolve(true)} />
                    <PillButton label='Use latest' disabled={disabled} onPress={() => onResolve(false)} />
                </Actions>
            </View>
        </GlassCard>
    )
}
