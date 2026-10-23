import { expect, test } from 'bun:test'
import { canApplyThesisRead, canEditThesisInput, canReadThesis, thesisActionKey, thesisGoalKey, thesisInputKey } from './policy'
import { ThesisState } from './document'

const base = { title: 'Synthetic', body: 'Initial', revision: 1 }
test('an earlier manual read cannot unlock a later unknown save or restore denied authority', () => {
    const ticket = { operation: 0, authorization: 0 }
    const model = new ThesisState(base)
    model.edit({ ...base, body: 'Local' }); model.beginSave(); model.failed()
    const canApply = canApplyThesisRead(ticket, { operation: model.operation, authorization: 0, pending: model.pending })
    model.receive(base, canApply)
    expect(model.unknown).toBe(true)
    expect(canApplyThesisRead(ticket, { operation: 0, authorization: 1, pending: false })).toBe(false)
})
test('queued precommit Refresh cannot mint a reconciliation ticket, fresh post-error Refresh can', () => {
    let generation = 1, calls = 0
    const refresh = (captured: number) => { if (canReadThesis({ alive: true, generation: captured, currentGeneration: generation, reading: false, saving: false })) calls++ }
    const oldRefresh = () => refresh(1)
    generation++ // failed save renews synchronously before React commits new targets
    oldRefresh(); expect(calls).toBe(0)
    refresh(generation); expect(calls).toBe(1)
})
test('native current-props dispatch drops old delete targets after row and subgoal shifts', () => {
    let rows = ['Header', 'First', 'Second'], host = 1
    let targets = new Map<string, () => void>()
    function render() {
        targets = new Map([[thesisActionKey(host, 1, 0), () => { rows = rows.filter((_, index) => index !== 1); host++; render() }]])
    }
    render()
    const oldTarget = thesisActionKey(host, 1, 0)
    targets.get(oldTarget)!()
    targets.get(oldTarget)?.() // resolve CURRENT listener by retained native target
    expect(rows).toEqual(['Header', 'Second'])
    expect(thesisGoalKey(1, 1, 0, 'First')).not.toBe(thesisGoalKey(2, 1, 0, 'Second'))
    expect(thesisInputKey('Sheet Markdown', 1)).toBe(thesisInputKey('Sheet Markdown', 1))
})
test('ordinary draft edits keep targets stable while context and write boundaries reject queued input', () => {
    const value = { alive: true, generation: 1, currentGeneration: 1, canEdit: true, unknown: false, conflict: false, recovering: false }
    expect(canEditThesisInput(value)).toBe(true)
    expect(canEditThesisInput({ ...value, currentGeneration: 2 })).toBe(false)
    expect(canEditThesisInput({ ...value, unknown: true })).toBe(false)
    expect(canEditThesisInput({ ...value, alive: false })).toBe(false)
})
