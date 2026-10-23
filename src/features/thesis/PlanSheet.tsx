import { useState } from 'react'
import { View } from 'react-native'
import { GlassCard, PillButton } from '../../components/ui'
import { planModel, statuses, subgoals, updatePlan, writeGoals } from './plan'
import type { TableData } from './workspace'
import { Actions, ThesisField, ThesisText } from './ui'

export function PlanSheet({ data, enabled, host, guard, onChange }: { data: TableData; enabled: boolean; host: number; guard: () => boolean; onChange: (data: TableData) => void }) {
    const [board, setBoard] = useState(false)
    const [sprint, setSprint] = useState('')
    const [expanded, setExpanded] = useState(-1)
    const [newGoal, setNewGoal] = useState('')
    const [limit, setLimit] = useState(30)
    const model = planModel(data), fields = model.fields
    const tasks = model.tasks.filter(({ row }) => !sprint || fields.sprint >= 0 && row[fields.sprint] === sprint)
    function update(row: number, col: number, value: string) { if (enabled && guard()) onChange(updatePlan(data, row, col, value)) }
    const card = ({ row, index }: { row: string[]; index: number }) => (
        <GlassCard key={index}>

            <View style={{ gap: 10 }}>

                <ThesisText heading>{fields.task >= 0 ? row[fields.task] || `Task ${index}` : `Row ${index}`}</ThesisText>

                {(['task', 'hours', 'status', 'sprint', 'progress'] as const).filter(name => fields[name] >= 0).map(name => name === 'status' ? <Actions key={`${host}:${name}`} >{statuses.map(status => <PillButton
                    key={status}
                    label={`${row[fields.status] === status ? '✓ ' : ''}${status}`}
                    disabled={!enabled}
                    onPress={() => update(index, fields.status, status)}
                />)}</Actions> : <ThesisField
                    key={name}
                    host={host}
                    label={`${name} · row ${index}`}
                    value={row[fields[name]] || ''}
                    enabled={enabled}
                    numeric={['hours', 'progress'].includes(name)}
                    onChange={value => update(index, fields[name], value)}
                />)}

                <PillButton
                    label={expanded === index ? 'Hide details' : 'Details and subgoals'}
                    onPress={() => { setExpanded(expanded === index ? -1 : index); setNewGoal('') }}
                />

                {expanded === index && <>
                    {(['notes', 'details', 'subgoals'] as const).filter(name => fields[name] >= 0).map(name => <ThesisField
                        key={name}
                        host={host}
                        label={`${name} · row ${index}`}
                        value={row[fields[name]] || ''}
                        enabled={enabled}
                        multiline
                        onChange={value => update(index, fields[name], value)}
                    />)}
                    {fields.subgoals >= 0 && <View style={{ gap: 8 }}>

                        {subgoals(row[fields.subgoals] || '').map((goal, i) => <Actions key={`${host}:${i}`}>
                            <PillButton
                                label={`${goal.done ? '☑' : '☐'} ${goal.text}`}
                                disabled={!enabled}
                                onPress={() => { const goals = subgoals(row[fields.subgoals]); goals[i].done = !goals[i].done; update(index, fields.subgoals, writeGoals(goals)) }}
                            />
                            <PillButton
                                label='Remove subgoal'
                                disabled={!enabled}
                                onPress={() => update(index, fields.subgoals, writeGoals(subgoals(row[fields.subgoals]).filter((_, at) => at !== i)))}
                            />
                        </Actions>)}

                        <ThesisField
                            label='New subgoal'
                            host={host}
                            value={newGoal}
                            enabled={enabled}
                            onChange={value => { if (guard()) setNewGoal(value) }}
                        />

                        <PillButton
                            key={host}
                            label='Add subgoal'
                            disabled={!enabled || !newGoal.trim()}
                            onPress={() => { if (!guard()) return; update(index, fields.subgoals, writeGoals([...subgoals(row[fields.subgoals]), { done: false, text: newGoal.trim() }])); setNewGoal('') }}
                        />
                    </View>}
                </>}
            </View>
        </GlassCard>
    )
    return <View style={{ gap: 12 }}>

        <ThesisText heading>Project plan</ThesisText>

        <ThesisText>{model.completed}/{model.tasks.length} completed · {model.completedHours}/{model.hours} estimated hours</ThesisText>

        <Actions>
            <PillButton label='Table view' onPress={() => setBoard(false)} />
            <PillButton label='Board view' onPress={() => setBoard(true)} />
        </Actions>

        {fields.sprint >= 0 && <Actions>
            <PillButton label='All sprints' onPress={() => setSprint('')} />
            {[...new Set(model.tasks.map(({ row }) => row[fields.sprint]).filter(Boolean))].map(value => <PillButton key={value} label={value} onPress={() => setSprint(value)} />)}
        </Actions>}

        {board && fields.status >= 0 ? statuses.map(status => <View key={status} style={{ gap: 10 }}>
            <ThesisText heading>{status}</ThesisText>
            {tasks.filter(({ row }) => (row[fields.status] || 'Planned') === status).slice(0, limit).map(card)}
        </View>) : tasks.slice(0, limit).map(card)}

        {tasks.length > limit && <PillButton label='Show more tasks' onPress={() => setLimit(v => v + 30)} />}
    </View>
}
