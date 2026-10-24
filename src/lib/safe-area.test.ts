import { expect, test } from 'bun:test'
import { safeAreaTopInset } from './safe-area'

test('keeps iOS content below the Dynamic Island when the reported inset is too small', () => {
    expect(safeAreaTopInset(0, 'ios')).toBe(82)
    expect(safeAreaTopInset(59, 'ios')).toBe(82)
})

test('preserves larger native insets and other platform values', () => {
    expect(safeAreaTopInset(84, 'ios')).toBe(84)
    expect(safeAreaTopInset(24, 'android')).toBe(24)
    expect(safeAreaTopInset(0, 'web')).toBe(0)
})
