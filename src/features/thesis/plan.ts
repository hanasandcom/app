import { type TableData } from './workspace'

// Field aliases and subgoal representation match website planSheet.tsx at a71de441.
export const planFields = [
    ['Task', ['task', 'goal', 'item', 'milestone']], ['Hours', ['hours', 'estimate', 'estimated hours', 'effort']],
    ['Notes', ['notes', 'note', 'description']], ['Status', ['status', 'state']], ['Sprint', ['sprint', 'iteration']],
    ['Progress', ['progress', '% complete']], ['Details', ['details', 'detail', 'updates']], ['Subgoals', ['subgoals', 'sub-goals', 'checklist']],
] as const
export const statuses = ['Planned', 'In progress', 'Waiting', 'Completed'] as const
export const subgoals = (value: string) => value.split('\n').map(line => /^\s*-\s*\[([ xX])\]\s*(.*)$/.exec(line)).filter((match): match is RegExpExecArray => !!match).map(match => ({ done: match[1].toLowerCase() === 'x', text: match[2] }))
export const writeGoals = (goals: { done: boolean; text: string }[]) => goals.map(goal => `- [${goal.done ? 'x' : ' '}] ${goal.text}`).join('\n')
export function planModel(data: TableData) {
    const fields = Object.fromEntries(planFields.map(([name, aliases]) => [name.toLowerCase(), data.cells[0].findIndex(header => (aliases as readonly string[]).includes(header.trim().toLowerCase()))])) as Record<'task' | 'hours' | 'notes' | 'status' | 'sprint' | 'progress' | 'details' | 'subgoals', number>
    const tasks = data.cells.slice(1).map((row, index) => ({ row, index: index + 1 })).filter(({ row }) => fields.task < 0 || !/^(?:total|summary)$/i.test(row[fields.task]?.trim() ?? ''))
    const hours = tasks.reduce((sum, { row }) => sum + (fields.hours >= 0 && Number.isFinite(Number(row[fields.hours])) ? Number(row[fields.hours]) : 0), 0)
    const completed = tasks.filter(({ row }) => fields.status >= 0 && row[fields.status] === 'Completed')
    const completedHours = completed.reduce((sum, { row }) => sum + (fields.hours >= 0 && Number.isFinite(Number(row[fields.hours])) ? Number(row[fields.hours]) : 0), 0)
    return { fields, tasks, hours, completed: completed.length, completedHours }
}
export function updatePlan(data: TableData, row: number, col: number, value: string) {
    const cells = data.cells.map(line => [...line])
    cells[row][col] = value
    const { fields } = planModel(data)
    if (col === fields.subgoals && fields.progress >= 0) {
        const goals = subgoals(value)
        if (goals.length) cells[row][fields.progress] = String(Math.round(goals.filter(goal => goal.done).length / goals.length * 100))
    }
    return { ...data, cells }
}
