import type { Terminal as HeadlessTerminal, ITerminalOptions, ITerminalInitOnlyOptions } from '@xterm/headless'

export type TerminalConstructor = new (options: ITerminalOptions & ITerminalInitOnlyOptions) => HeadlessTerminal

/** Only the two strings used by xterm's platform detection. Restored even on import failure. */
export function withTerminalNavigator<T>(load: () => T): T {
    const globalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    const existing = globalThis.navigator as unknown as Record<string, unknown> | undefined
    const navigator = existing ?? {}
    const descriptors = new Map<string, PropertyDescriptor | undefined>()
    try {
        if (!existing) Object.defineProperty(globalThis, 'navigator', { configurable: true, value: navigator })
        for (const [key, fallback] of [['userAgent', 'ReactNative'], ['platform', '']]) {
            if (typeof navigator[key] === 'string') continue
            descriptors.set(key, Object.getOwnPropertyDescriptor(navigator, key))
            Object.defineProperty(navigator, key, { configurable: true, value: fallback })
        }
        return load()
    } finally {
        for (const [key, descriptor] of descriptors) {
            if (descriptor) Object.defineProperty(navigator, key, descriptor)
            else delete navigator[key]
        }
        if (!existing) {
            if (globalDescriptor) Object.defineProperty(globalThis, 'navigator', globalDescriptor)
            else Reflect.deleteProperty(globalThis, 'navigator')
        }
    }
}

export function loadTerminal(): TerminalConstructor {
    return withTerminalNavigator(() => {
        // Explicit published CJS entry: Metro must not select the package's broken ESM field.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { Terminal } = require('@xterm/headless/lib-headless/xterm-headless.js') as { Terminal: TerminalConstructor }
        return Terminal
    })
}
