import type { AppSettings } from '../../types'
import * as api from './api'
import { watchSystem } from './live'
export function systemServices(settings: AppSettings) {
    return {
        access: (signal: AbortSignal) => api.loadAccess(settings, signal),
        telemetry: (signal: AbortSignal) => api.loadTelemetry(settings, signal),
        storage: (signal: AbortSignal) => api.loadStorage(settings, signal),
        logs: (name: string, signal: AbortSignal) => api.loadRuntimeLogs(settings, name, signal),
        restart: (...args: Parameters<typeof api.restartContainer> extends [AppSettings, ...infer R] ? R : never) => api.restartContainer(settings, ...args),
        cleanup: (...args: Parameters<typeof api.clearStorage> extends [AppSettings, ...infer R] ? R : never) => api.clearStorage(settings, ...args),
        live: (signal: AbortSignal, observer: Parameters<typeof watchSystem>[2]) => watchSystem(settings, signal, observer),
    }
}
export type SystemServices = ReturnType<typeof systemServices>
