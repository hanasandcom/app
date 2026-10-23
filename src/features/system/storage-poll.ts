import type { Storage } from './model'
export type PollScheduler = { later: (callback: () => void, milliseconds: number) => unknown; cancel: (ticket: unknown) => void }
const timerScheduler: PollScheduler = { later: (callback, ms) => setTimeout(callback, ms), cancel: ticket => clearTimeout(ticket as ReturnType<typeof setTimeout>) }
// Observation only: polling never reconciles an uncertain mutation or repeats it.
export function pollStorage(options: {
    load: (signal: AbortSignal) => Promise<Storage>
    current: () => boolean
    busy: () => boolean
    value: () => Storage | null
    data: (value: Storage) => void
    error: (cause: unknown) => void
}, scheduler: PollScheduler = timerScheduler) {
    let stopped = false, request: AbortController | undefined, ticket: unknown
    const schedule = () => {
        if (stopped || !options.current()) return
        const value = options.value()
        ticket = scheduler.later(() => { void read() }, value?.running || value?.queued ? 1000 : 10000)
    }
    async function read() {
        if (stopped || !options.current()) return
        if (options.busy()) { schedule(); return }
        const controller = new AbortController(); request = controller
        try {
            const value = await options.load(controller.signal)
            if (!stopped && !controller.signal.aborted && options.current() && !options.busy()) options.data(value)
        } catch (cause) {
            if (!stopped && !controller.signal.aborted && options.current() && !options.busy()) options.error(cause)
        } finally { if (request === controller) request = undefined; schedule() }
    }
    schedule()
    return () => { stopped = true; scheduler.cancel(ticket); request?.abort() }
}
