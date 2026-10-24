// Native lifecycle policies for Core 6b2a22e6d4895198005824f3dc15615fbd9d9cea VM operations.
import type { AppSettings } from '../../types'
import { name } from './model'
import { ownAccount, vmScope, vmUrl } from './transport'
export const operationKinds = ['create', 'reprovision', 'power', 'failover', 'ssh_sync', 'collect', 'sudo', 'delete', 'restore', 'checkout', 'stop_all', 'service_add', 'service_remove', 'assign', 'host_features', 'setup_plan', 'console'] as const
export type VmOperationKind = typeof operationKinds[number]
export type VmIntent = { token: string; kind: VmOperationKind; target: string }
export function vmIntentScope(s: AppSettings) {
    let service = 'invalid-service'
    try { service = vmUrl(s, '').replace(/\/+$/, '') } catch { /* Invalid configuration never dispatches. */ }
    return JSON.stringify([service, s.userId, s.selectedOrganizationId === 'personal' ? '' : s.selectedOrganizationId || '', ownAccount(s) ? 'own' : 'impersonated'])
}
export class VmIntents {
    private entries = new Map<string, VmIntent>()
    constructor(private capacity = 64) {}
    get(scope: string) { const v = this.entries.get(scope); return v ? { ...v } : undefined }
    claim(scope: string, value: VmIntent) {
        if (!operationKinds.includes(value.kind) || !/^[A-Za-z0-9-]{1,100}$/.test(value.token) || !name(value.target) || this.entries.has(scope) || this.entries.size >= this.capacity) return false
        this.entries.set(scope, { token: value.token, kind: value.kind, target: value.target }); return true
    }
    clear(scope: string, token: string) { if (this.entries.get(scope)?.token !== token) return false; this.entries.delete(scope); return true }
}
const registry = new VmIntents()
// Authority fields mean a positively verified permission/eligibility, never merely HTTP success.
// target means a successful current read of the exact intent target; denied/404/failed reads are false.
export type VmReadSet = { inventory: boolean; target: boolean; management: boolean; platform: boolean; products: boolean; details: boolean; services: boolean }
export function requiredVmReads(kind: VmOperationKind | undefined, reads: VmReadSet) {
    if (!reads.inventory) return false
    if (kind === 'setup_plan') return true
    if (!kind || kind === 'create' || kind === 'reprovision') return reads.target
    if (kind === 'stop_all') return reads.platform
    if (!reads.target) return false
    if (kind === 'checkout') return reads.products
    if (kind === 'delete' || kind === 'restore') return reads.platform
    if (kind === 'collect') return reads.details
    if (kind === 'sudo') return reads.management // This is not credential eligibility; only the reveal endpoint can reauthenticate it.
    if (kind === 'assign') return reads.management
    return reads.management && (!['service_add', 'service_remove'].includes(kind) || reads.services)
}
export type VmReview = Readonly<{ generation: number; inputRevision: number; kind: VmOperationKind; target: string; consoleMayStart?: true }>
export type VmOperation = Readonly<{ generation: number; token: string; kind: VmOperationKind; target: string; signal: AbortSignal; consoleMayStart?: true }>
export type VmRead = Readonly<{ generation: number; manual: boolean; target: string; intent?: string; kind?: VmOperationKind; signal: AbortSignal }>
export class VmController {
    visible = false
    generation = 0
    inputRevision = 0
    reading = false
    writing = false
    needsRead = true
    private session: string
    private scope: string
    private own: boolean
    private pending?: AbortController
    private operation?: VmOperation
    private reviewed?: string
    private privateClearers = new Set<() => void>()
    constructor(settings: AppSettings, private intents = registry) { this.session = vmScope(settings); this.scope = vmIntentScope(settings); this.own = ownAccount(settings) }
    get unknown() { return this.intents.get(this.scope) }
    get locked() { return this.needsRead || !!this.unknown }
    get canAcknowledge() { return !this.needsRead && !!this.unknown && this.reviewed === this.unknown.token }
    current(generation: number) { return this.visible && this.generation === generation }
    idle(generation: number) { return this.current(generation) && !this.reading && !this.writing }
    onClearPrivate(clear: () => void) { this.privateClearers.add(clear); return () => { this.privateClearers.delete(clear) } }
    private clearPrivate() { for (const clear of this.privateClearers) { try { clear() } catch { /* A failed consumer cannot prevent other private state from clearing. */ } } }
    hide() { this.visible = false; this.generation++; this.inputRevision++; this.pending?.abort(); this.operation = undefined; this.reading = false; this.writing = false; this.needsRead = true; this.reviewed = undefined; this.clearPrivate() }
    updateSettings(settings: AppSettings) {
        if (vmScope(settings) === this.session) return false
        this.hide(); this.session = vmScope(settings); this.scope = vmIntentScope(settings); this.own = ownAccount(settings); return true
    }
    context(generation: number) {
        if (!this.idle(generation)) return false
        this.generation++; this.inputRevision++; this.reviewed = undefined; this.clearPrivate(); return true
    }
    switchTarget(generation: number) {
        if (!this.current(generation) || !this.reading || this.writing) return false
        this.pending?.abort()
        this.pending = undefined
        this.reading = false
        this.needsRead = true
        this.generation++; this.inputRevision++; this.reviewed = undefined; this.clearPrivate()
        return true
    }
    edit(generation: number) {
        if (!this.idle(generation) || this.locked) return false
        this.inputRevision++; return true // Draft state is outside this controller; ordinary typing does not renew native hosts.
    }
    sessionCurrent(settings: AppSettings) { return this.visible && this.own && vmScope(settings) === this.session }
    review(generation: number, kind: VmOperationKind, target: string, consoleMayStart = false): VmReview | null {
        if (!this.own || !this.idle(generation) || this.locked || kind === 'console' && !consoleMayStart) return null
        return { generation, inputRevision: this.inputRevision, kind, target: name(target), ...(kind === 'console' ? { consoleMayStart: true as const } : {}) }
    }
    begin(review: VmReview, token: string): VmOperation | null {
        if (!this.own || !this.idle(review.generation) || this.locked || review.inputRevision !== this.inputRevision || review.kind === 'console' && review.consoleMayStart !== true) return null
        const intent = { token, kind: review.kind, target: review.target }
        if (!this.intents.claim(this.scope, intent)) return null
        this.generation++; this.inputRevision++; this.writing = true; this.needsRead = true; this.reviewed = undefined; this.pending = new AbortController(); this.clearPrivate()
        this.operation = { ...intent, generation: this.generation, signal: this.pending.signal, ...(review.consoleMayStart ? { consoleMayStart: true as const } : {}) }
        return this.operation
    }
    operationCurrent(value: VmOperation) { return this.current(value.generation) && this.writing && !value.signal.aborted && this.operation === value }
    async fresh<T>(value: VmOperation, read: (signal: AbortSignal) => Promise<T>, allowed: (value: T) => boolean): Promise<T | null> {
        if (!this.operationCurrent(value)) return null
        const result = await read(value.signal)
        return this.operationCurrent(value) && allowed(result) ? result : null
    }
    finish(value: VmOperation, definiteReceipt: boolean) {
        if (!this.operationCurrent(value)) return false
        if (definiteReceipt) this.intents.clear(this.scope, value.token)
        this.writing = false; this.operation = undefined; this.generation++; this.inputRevision++; return true
    }
    beginRead(generation: number, manual: boolean, selected: string): VmRead | null {
        if (!this.idle(generation)) return null
        const intent = this.unknown, target = intent?.target || selected
        this.generation++; this.inputRevision++; this.reading = true; this.needsRead = true; this.reviewed = undefined; this.pending = new AbortController(); this.clearPrivate()
        return { generation: this.generation, manual, target, intent: intent?.token, kind: intent?.kind, signal: this.pending.signal }
    }
    finishRead(value: VmRead, result: { target: string; authorized: boolean; reads: VmReadSet }) {
        if (!this.current(value.generation)) return false
        const complete = result.authorized && result.target === value.target && requiredVmReads(value.kind, result.reads)
        this.reading = false; this.needsRead = !complete
        if (complete && value.manual && value.intent && this.unknown?.token === value.intent) this.reviewed = value.intent
        this.generation++; this.inputRevision++; return true
    }
    acknowledge(generation: number, token: string) {
        if (!this.idle(generation) || !this.canAcknowledge || !this.intents.clear(this.scope, token)) return false
        this.reviewed = undefined; this.generation++; this.inputRevision++; return true
    }
}
