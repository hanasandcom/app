import { describe, expect, test } from 'bun:test'
import { ThesisState, document } from './document'

const base = { title: 'Thesis', body: 'Initial', revision: 1 }
describe('Thesis document concurrency', () => {
    test('requires valid document and bounds', () => {
        expect(() => document({ ...base, title: 'x\ny' })).toThrow()
        expect(() => document({ ...base, revision: -1 })).toThrow()
        expect(() => document({ ...base, body: 'x'.repeat(1000001) })).toThrow()
    })
    test('accepted save preserves newer typing', () => {
        const state = new ThesisState(base)
        state.edit({ ...base, body: 'First' })
        const sent = state.beginSave()
        state.edit({ ...base, body: 'Newer' })
        state.saved(sent, { ...sent, revision: 2 })
        expect(state.draft.body).toBe('Newer')
        expect(state.draft.revision).toBe(2)
        expect(state.dirty).toBe(true)
    })
    test('unknown outcome cannot retry or unlock from an automatic snapshot', () => {
        const state = new ThesisState(base)
        state.edit({ ...base, body: 'Local' })
        state.beginSave(); state.failed()
        state.receive(base)
        expect(() => state.beginSave()).toThrow()
        state.receive(base, true)
        expect(state.beginSave().body).toBe('Local')
    })
    test('conflict retains draft until explicit rebase or latest', () => {
        const state = new ThesisState(base)
        state.edit({ ...base, body: 'Local' })
        state.receive({ ...base, body: 'Remote', revision: 2 })
        expect(state.draft.body).toBe('Local')
        expect(state.canUndo).toBe(false)
        state.resolve(true)
        expect(state.beginSave()).toEqual({ ...base, body: 'Local', revision: 2 })
    })
    test('undo coalesces ordinary typing without changing base revision', () => {
        const state = new ThesisState(base)
        state.edit({ ...base, body: 'A' }, 'body', 100)
        state.edit({ ...base, body: 'AB' }, 'body', 200)
        state.undo(); expect(state.draft.body).toBe('Initial')
        state.undo(true); expect(state.draft.body).toBe('AB')
    })
})
