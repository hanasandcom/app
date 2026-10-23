import { useState } from 'react'
import { View } from 'react-native'
import { GlassCard, InlineNotice, PillButton } from '../../components/ui'
import { bytes, type Storage } from './model'
import { SystemText } from './ui'
export function StoragePanel({ value, canWrite, host, onCleanup }: { value: Storage; canWrite: boolean; host: number; onCleanup: () => void }) {
    const [showImages, setShowImages] = useState(false), [limit, setLimit] = useState(30)
    const busy = value.running || value.queued
    return <GlassCard>
        <View style={{ gap: 12 }}>
            <SystemText heading>Docker storage · Inspur</SystemText>
            {value.stale && <InlineNotice message='Storage figures are out of date. Refresh before cleanup.' />}
            {!!value.error && <InlineNotice message={value.error} />}
            <SystemText>Build cache {bytes(value.cache)} · Reclaimable {bytes(value.reclaimable)}{ '\n' }Cache budget {bytes(value.budget)}</SystemText>
            <SystemText>Nightly cleanup: {value.schedule || 'Unavailable'} · {value.timezone || 'Timezone unavailable'}{ '\n' }Last successful cleanup: {value.lastSuccessAt || 'Not recorded'}{ '\n' }Last reclaimed: {bytes(value.lastFreed)}</SystemText>
            <SystemText>{value.running ? `Running · ${value.phase || 'phase unavailable'} · ${bytes(value.freed)} freed (estimated)` : value.queued ? 'Cleanup queued' : 'Cleanup idle'}{ '\n' }Progress: {value.progressAt || 'Not recorded'}{ '\n' }Checked: {value.checkedAt}</SystemText>
            <PillButton key={`cleanup:${host}`} label={busy ? 'Cleanup in progress' : 'Review storage cleanup'} disabled={!canWrite || busy || value.stale || !!value.error} onPress={onCleanup} />
            <PillButton label={`${showImages ? 'Hide' : 'Show'} unused images (${value.images.length})`} onPress={() => setShowImages(!showImages)} />
            {showImages && <>
                <SystemText>Recent images and two releases per image are kept for rollback. Sizes may include shared layers.</SystemText>
                {value.images.slice(0, limit).map(image => <View key={image.id} style={{ gap: 4 }}>
                    <SystemText>{image.names.join(', ') || image.id}{ '\n' }{bytes(image.bytes)} · {image.reason || (image.eligible ? 'Eligible for cleanup' : 'Retained')}{ '\n' }{image.id}</SystemText>
                </View>)}
                {!value.images.length && <SystemText>No unused images returned.</SystemText>}
                {value.images.length > limit && <PillButton label='Show more unused images' onPress={() => setLimit(n => n + 30)} />}
            </>}
        </View>
    </GlassCard>
}
