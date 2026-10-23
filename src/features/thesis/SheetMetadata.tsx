import { useState } from 'react'
import { View } from 'react-native'
import { PillButton } from '../../components/ui'
import { tables, type Sheet } from './workspace'
import { ThesisText } from './ui'

export function SheetMetadata({ sheet }: { sheet: Sheet }) {
    const [limit, setLimit] = useState(100)
    return (
        <View style={{ gap: 8 }}>
            <ThesisText muted>Page {sheet.name} · identifier {sheet.id}</ThesisText>
            <ThesisText muted>
                Table insertion: {sheet.settings?.insertTable !== false ? 'on' : 'off'} · History: {sheet.settings?.history !== false ? 'on' : 'off'} · Code review: {(sheet.settings?.codeReview ?? sheet.name?.toLowerCase() === 'code') ? 'on' : 'off'}
            </ThesisText>
            {tables(sheet.body).map((table, index) => (
                <ThesisText key={index} muted>Table {index + 1} column widths: {table.data.widths.join(', ') || 'automatic'}; row heights: {table.data.heights.join(', ') || 'automatic'}</ThesisText>
            ))}
            {sheet.activityLog && <>
                <ThesisText heading>Activity log · initial year {sheet.activityLog.startYear}</ThesisText>
                <ThesisText>{sheet.activityLog.activities.length} dated activities</ThesisText>
                {sheet.activityLog.activities.slice(0, limit).map(activity => (
                    <View key={activity.id} style={{ gap: 4 }}>
                        <ThesisText>{activity.date} · {activity.hours} h · {activity.category}</ThesisText>
                        <ThesisText>{activity.description}</ThesisText>
                        <ThesisText muted>Activity identifier {activity.id}</ThesisText>
                    </View>
                ))}
                {sheet.activityLog.activities.length > limit && <PillButton label='Show 100 more activities' onPress={() => setLimit(v => v + 100)} />}
            </>}
        </View>
    )
}
