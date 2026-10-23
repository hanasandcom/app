import { useState } from 'react'
import { View } from 'react-native'
import { GlassCard, PillButton } from '../../components/ui'
import { CaseText, Actions, CaseInput, Options, Evidence, CheckFields } from './ui'
import { needsHumanReview, row, text, type CaseItem, type CaseChange } from './model'
import type { CaseController } from './controller'
export type CasePanel = 'overview' | 'comments' | 'events' | 'history' | 'notifications' | 'development'
export function CaseDetail({ item, panel, comment, setComment, ai, setAi, ops, host, writable, save, eventPage, onOpenHealth }: {
    item: CaseItem; panel: CasePanel; comment: string; setComment: (v: string) => void; ai: boolean; setAi: (v: boolean) => void; ops: CaseController; host: number; writable: boolean; save: (v: CaseChange, title: string) => void; eventPage: (page: number) => void; onOpenHealth?: (id: string) => void
}) {
    const [limit, setLimit] = useState(30)
    const [commentSearch, setCommentSearch] = useState(''), [automated, setAutomated] = useState(true)
    if (panel === 'events') return <GlassCard>
        <View style={{ gap: 14 }}>

            <CaseText heading>Underlying check runs</CaseText>
            <CaseText>{item.occurrences} counted occurrences · {item.eventTotal ?? 'Unavailable'} recorded runs · Page {(item.eventPage ?? 0) + 1}</CaseText>

            <CaseText>Events are held at {item.eventSnapshot}. Each run counts once, including its retries.</CaseText>

            {item.events.map((v, i) => <View key={text(v.id) || i} style={{ gap: 5 }}>
                <CaseText heading>{text(v.startedAt)} · {text(v.outcome)}</CaseText>
                <CaseText>{text(v.message) || 'No diagnostic message recorded.'}</CaseText>
                <CaseText>Duration: {v.durationMs == null ? 'Not recorded' : `${v.durationMs} ms`} · Completed: {text(v.completedAt) || 'Not recorded'}{ '\n' }Run ID: {text(v.id)}</CaseText>
                <CheckFields value={row(v.details)} />
            </View>)}

            {!item.events.length && <CaseText>No underlying runs are available for this page.</CaseText>}

            <Actions>
                <PillButton
                    label='Previous events'
                    disabled={!ops.idle(host) || !item.eventPage}
                    onPress={() => eventPage((item.eventPage || 0) - 1)}
                />
                <PillButton
                    label='Next events'
                    disabled={!ops.idle(host) || ((item.eventPage || 0) + 1) * 50 >= (item.eventTotal || 0)}
                    onPress={() => eventPage((item.eventPage || 0) + 1)}
                />
            </Actions>

        </View>
    </GlassCard>
    if (panel === 'history') return <GlassCard>
        <View style={{ gap: 12 }}>
            <CaseText heading>Case history</CaseText>
            {item.history.length ? item.history.slice(0, limit).map((v, i) => <View key={text(v.id) || i}>
                <CaseText heading>{text(v.action).replaceAll('_', ' ')} · {text(v.at)}</CaseText>
                <CaseText>{text(v.actor)}{ '\n' }{text(v.note)}</CaseText>
                <CaseText>{v.fromStatus !== v.toStatus ? `${text(v.fromStatus)} → ${text(v.toStatus)}` : ''}{v.fromSeverity !== v.toSeverity ? ` · Severity ${text(v.fromSeverity)} → ${text(v.toSeverity)}` : ''}{v.action === 'notifications_changed' ? `Notifications ${v.notificationsEnabled ? 'enabled' : 'disabled'}` : ''}</CaseText>
            </View>) : <CaseText>No case history recorded.</CaseText>}
            {item.history.length > limit && <PillButton label='Show more case history' onPress={() => { if (ops.idle(host)) setLimit(n => n + 30) }} />}
        </View>
    </GlassCard>
    if (panel === 'notifications') return <GlassCard>
        <View style={{ gap: 12 }}>
            <CaseText heading>Notification settings and delivery history</CaseText>
            <PillButton
                label={item.notificationsEnabled ? 'Disable notifications' : 'Enable notifications'}
                disabled={!writable}
                onPress={() => save({ notificationsEnabled: !item.notificationsEnabled }, 'Change notifications?')}
            />

            {item.notifications.slice(0, limit).map((v, i) => <View key={text(v.messageId) || i}>
                <CaseText heading>{v.deliveredAt ? `Delivered ${text(v.deliveredAt)}` : 'Delivery pending'}</CaseText>
                <CaseText>{text(v.error)}{ '\n' }{v.nextAttemptAt ? `Next attempt: ${text(v.nextAttemptAt)}` : ''}{ '\n' }{v.messageId ? `Message ID: ${text(v.messageId)}` : ''}</CaseText>
                {v.message ? <Evidence value={row(v.message)} /> : <CaseText>Original message content is unavailable.</CaseText>}
            </View>)}

            {item.notifications.length > limit && <PillButton label='Show more notifications' onPress={() => { if (ops.idle(host)) setLimit(n => n + 30) }} />}
            {!item.notifications.length && <CaseText>No notifications recorded.</CaseText>}

        </View>
    </GlassCard>
    if (panel === 'comments') return <GlassCard>
        <View style={{ gap: 12 }}>
            <CaseText heading>Comments</CaseText>
            <CaseInput label='Search comments' value={commentSearch} onChange={setCommentSearch} ops={ops} host={host} limit={200} />
            <PillButton
                label={automated ? 'Hide automated comments' : 'Show automated comments'}
                onPress={() => { if (ops.idle(host)) setAutomated(!automated) }}
            />

            {item.comments.filter(c => (automated || c.actorType !== 'automation') && `${text(c.author)} ${text(c.body)}`.toLowerCase().includes(commentSearch.toLowerCase())).slice(0, limit).map((v, i) => <View key={text(v.id) || i}>
                <CaseText heading>{text(v.author)} · {text(v.createdAt)}{v.actorType === 'automation' ? ' · Automated' : ''}</CaseText>
                <CaseText>{text(v.body)}</CaseText>
            </View>)}

            {item.comments.filter(c => (automated || c.actorType !== 'automation') && `${text(c.author)} ${text(c.body)}`.toLowerCase().includes(commentSearch.toLowerCase())).length > limit && <PillButton label='Show more comments' onPress={() => { if (ops.idle(host)) setLimit(n => n + 30) }} />}
            {!item.comments.length && <CaseText>No comments yet.</CaseText>}

            <CaseInput label='Comment' disabled={!writable} value={comment} onChange={setComment} ops={ops} host={host} multiline />
            <PillButton label='Add comment' disabled={!writable || !comment.trim()} onPress={() => save({ comment }, 'Add this comment?')} />

        </View>
    </GlassCard>
    if (panel !== 'overview') return null
    return <View style={{ gap: 12 }}>

        <GlassCard>
            <View style={{ gap: 10 }}>
                <CaseText heading>{item.title}</CaseText>
                <CaseText>{item.id} · {item.status.replaceAll('_', ' ')} · {item.severity}{ '\n' }{item.summary}</CaseText>
                <CaseText>First seen: {item.createdAt}{ '\n' }Last seen: {item.lastSeenAt || item.updatedAt}{ '\n' }Recovered: {item.resolvedAt || 'Not recovered'}{ '\n' }Occurrences: {item.occurrences}</CaseText>

                <CaseText>Health checks update recovery automatically. Closing this case does not mark the check as recovered.</CaseText>

                <Options
                    label='Severity'
                    values={['low', 'medium', 'high', 'critical']}
                    value={item.severity}
                    disabled={!writable}
                    choose={severity => save({ severity }, 'Change severity?')}
                />

                <Actions>
                    <PillButton
                        label={['closed', 'resolved'].includes(item.status) ? 'Reopen case' : item.status === 'in_progress' ? 'Set as open' : 'Start progress'}
                        disabled={!writable}
                        onPress={() => save({ status: item.status === 'open' ? 'in_progress' : 'open' }, 'Change case status?')}
                    />
                    {onOpenHealth && <PillButton label='View health check' onPress={() => { if (ops.idle(host)) onOpenHealth(item.automationId) }} />}
                </Actions>

            </View>
        </GlassCard>

        {item.resolution && <GlassCard>
            <View style={{ gap: 8 }}>
                <CaseText heading>{item.resolution.type === 'ai' ? 'Resolved by AI' : item.resolution.type === 'automation' ? 'Recovered automatically' : item.resolution.type === 'unknown' ? 'Resolver not recorded' : 'Resolved by a person'}</CaseText>
                <CaseText>{text(item.resolution.actor) || 'Identity unavailable'} · {text(item.resolution.at)}{ '\n' }{text(item.resolution.note)}</CaseText>
                {item.resolution.confirmedAt ? <CaseText>Confirmed by {text(item.resolution.confirmedBy)} · {text(item.resolution.confirmedAt)}</CaseText> : needsHumanReview(item) && <><CaseText>Awaiting human confirmation.</CaseText><PillButton
                    label='Confirm resolution'
                    disabled={!writable}
                    onPress={() => save({ confirmResolutionId: text(item.resolution?.id) }, 'Confirm this resolution was reviewed?')}
                /></>}
            </View>
        </GlassCard>}

        {!['closed', 'resolved'].includes(item.status) && <GlassCard>
            <View style={{ gap: 8 }}>
                <CaseText heading>Resolve or close</CaseText>
                <CaseInput label='Resolution comment' disabled={!writable} value={comment} onChange={setComment} ops={ops} host={host} multiline />
                <PillButton
                    label={`${ai ? '✓ ' : ''}Resolved by AI — human confirmation required`}
                    disabled={!writable}
                    onPress={() => { if (ops.idle(host)) setAi(!ai) }}
                />
                <Actions>
                    {['resolved', 'closed'].map(status => <PillButton
                        key={status}
                        label={status === 'resolved' ? 'Resolve with comment' : 'Close with comment'}
                        disabled={!writable || !comment.trim()}
                        onPress={() => save({ status, comment, ...(ai ? { resolutionMethod: 'ai' as const } : {}) }, `${status === 'resolved' ? 'Resolve' : 'Close'} this case?`)}
                    />)}
                </Actions>
            </View>
        </GlassCard>}

        <GlassCard>
            <View style={{ gap: 10 }}>
                <CaseText heading>Technical details</CaseText>
                <CaseText>{item.events[0]?.details ? 'Configuration captured for the displayed event.' : 'Current configuration; older events may not have captured configuration.'}</CaseText>
                <CheckFields value={row(item.events[0]?.details || item.currentCheck)} />
                {item.events[0] && <View><CaseText heading>Latest recorded result at {item.eventSnapshot}</CaseText><CaseText>{text(item.events[0].message)}{ '\n' }Duration: {item.events[0].durationMs == null ? 'Not recorded' : `${item.events[0].durationMs} ms`}</CaseText></View>}
                {item.relatedChecks.map((v, i) => <View key={text(v.id) || i}>
                    <CaseText heading>{text(v.name)} · {text(v.outcome)}</CaseText>
                    <CaseText>{text(v.message)}{ '\n' }{text(v.completedAt)}</CaseText>
                </View>)}
            </View>
        </GlassCard>

        {!!Object.keys(item.diskDiagnostics).length && <GlassCard>
            <CaseText heading>Disk usage diagnostics</CaseText>
            <CaseText>Directory sizes can overlap. A partial scan may omit inaccessible or unmeasured directories.</CaseText>
            <Evidence value={item.diskDiagnostics} />
        </GlassCard>}

    </View>
}
