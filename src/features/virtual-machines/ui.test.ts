import { expect, mock, test } from 'bun:test'
import type { AppSettings } from '../../types'
mock.module('../../lib/api', () => ({ apiFetch: () => { throw new Error('No real transport is allowed') } }))
const { readVmWorkspace } = await import('./read')
const { scoped, parseVm } = await import('./model')
const { VmController, VmIntents } = await import('./controller')
const { vmServices } = await import('./services')
const { freshVmOperation, acceptsVmResult } = await import('./action')
const { canCreateVm } = await import('./authority')
const { filterVms, defaultVmFilter, memoryGiB } = await import('./inventory')
const { applyVmPlan, clearVmSuggestion, withWebsiteField } = await import('./draft')
const { editorValue, saveEditorValue } = await import('./editor-memory')
const { metricSegments } = await import('./metrics')
import type { VmServices } from './services'
import type { VmOperationKind } from './controller'
import type { CreateVmInput, SetupPlan } from './setup'
import type { VmEditorMemory } from './editor-memory'
const settings = { userId: 'synthetic-user', authToken: 'synthetic-token', apiBaseUrl: 'https://api.hanasand.com/api', siteBaseUrl: 'https://hanasand.com', selectedOrganizationId: 'personal', impersonationToken: '', impersonatingUserId: '' } as AppSettings
const vm = (patch = {}) => scoped(settings, parseVm({ name: 'synthetic-vm', owner: settings.userId, status: 'Running', limits_cpu: '4', limits_memory: '4096MiB', ...patch }))
function services(overrides: Partial<VmServices> = {}): VmServices {
    return { ...vmServices, loadInventory: async () => scoped(settings, [vm().value]), loadAccessibleInventory: async () => scoped(settings, []),
        loadVm: async () => vm(), loadPublicServices: async () => scoped(settings, { name: 'synthetic-vm', canManage: true, services: [] }),
        loadPlatformAccess: async () => scoped(settings, { canRead: true, canEdit: true }), loadProducts: async () => scoped(settings, { plans: [{ id: 'failover', name: 'Failover', priceNok: 50, currency: 'NOK', interval: 'month' }], containers: [{ name: 'synthetic-vm', primary_host: 'host', failover_premium: false }] }),
        loadDetails: async () => scoped(settings, null), loadMetrics: async () => scoped(settings, []), organizations: async () => [], ...overrides }
}
const reads = { inventory: true, target: true, management: true, platform: true, products: true, details: true, services: true }
function unlocked(s = settings) {
    const ops = new VmController(s, new VmIntents()); ops.visible = true
    const r = ops.beginRead(ops.generation, false, '')!; ops.finishRead(r, { target: '', authorized: true, reads }); return ops
}
const opening = (kind: VmOperationKind = 'power', s = settings) => { const ops = unlocked(s); return { ops, op: ops.begin(ops.review(ops.generation, kind, 'synthetic-vm')!, 'one')! } }
const fail = async (): Promise<never> => { throw new Error('Unavailable') }
test('complete inventory deduplicates owned/access; initial read is not a connection sync, collection or mutation', async () => {
    let effects = 0
    const ops = unlocked(), read = ops.beginRead(ops.generation, true, '')!
    const result = await readVmWorkspace(settings, read, services({ loadAccessibleInventory: async () => scoped(settings, [vm().value]), syncConnection: async () => { effects++; throw new Error() }, collectDetails: async () => { effects++; throw new Error() }, power: async () => { effects++; throw new Error() } }))
    expect(result.inventory?.value.length).toBe(1); expect(result.reads.inventory).toBe(true); expect(result.reads.target).toBe(true); expect(effects).toBe(0)
})
test('VM inventory renders before slower permission checks finish; target and base reads run together', async () => {
    let finishPlatform!: (value: Awaited<ReturnType<VmServices['loadPlatformAccess']>>) => void
    const platform = new Promise<Awaited<ReturnType<VmServices['loadPlatformAccess']>>>(resolve => { finishPlatform = resolve })
    const ops = new VmController(settings, new VmIntents()); ops.visible = true
    const read = ops.beginRead(ops.generation, false, 'synthetic-vm')!
    const progress: Awaited<ReturnType<typeof readVmWorkspace>>[] = []
    let detailLoaded = false
    const pending = readVmWorkspace(settings, read, services({
        loadPlatformAccess: async () => platform,
        loadDetails: async () => { detailLoaded = true; return scoped(settings, null) },
    }), snapshot => progress.push(snapshot))

    await new Promise(resolve => setTimeout(resolve, 0))
    expect(detailLoaded).toBe(true)
    expect(progress.some(snapshot => snapshot.inventory?.value.length === 1 && !snapshot.reads.platform)).toBe(true)
    finishPlatform(scoped(settings, { canRead: true, canEdit: true }))
    const result = await pending
    expect(result.reads.inventory).toBe(true)
    expect(result.reads.target).toBe(true)
    expect(result.reads.platform).toBe(true)
})
test('each successful inventory survives a sibling failure, but cannot satisfy unknown reconciliation', async () => {
    for (const broken of ['loadInventory', 'loadAccessibleInventory'] as const) {
        const { ops, op } = opening(); ops.finish(op, false)
        const read = ops.beginRead(ops.generation, true, '')!
        const result = await readVmWorkspace(settings, read, services({ [broken]: fail, loadAccessibleInventory: broken === 'loadAccessibleInventory' ? fail : async () => scoped(settings, [vm().value]) }))
        expect(result.inventory?.value.length).toBe(1); expect(result.reads.inventory).toBe(false); expect(result.errors.length).toBe(1)
        ops.finishRead(read, { target: read.target, authorized: true, reads: result.reads }); expect(ops.canAcknowledge).toBe(false)
    }
})
test('exact unknown target is read even when a different VM was selected; failed details remain unavailable', async () => {
    const { ops, op } = opening('collect'); ops.finish(op, false)
    const read = ops.beginRead(ops.generation, true, 'other-vm')!, targets: string[] = []
    const result = await readVmWorkspace(settings, read, services({ loadVm: async (_s, target) => { targets.push(target); return vm() }, loadDetails: fail }))
    expect(targets).toEqual(['synthetic-vm']); expect(result.details).toBeNull(); expect(result.reads.details).toBe(false)
    ops.finishRead(read, { target: read.target, authorized: true, reads: result.reads }); expect(ops.canAcknowledge).toBe(false)
})
test('denied management/platform/product eligibility never becomes positive required authority', async () => {
    const ops = unlocked(), read = ops.beginRead(ops.generation, true, 'synthetic-vm')!
    const result = await readVmWorkspace(settings, read, services({ loadPublicServices: async () => scoped(settings, { name: 'synthetic-vm', canManage: false, services: [] }), loadPlatformAccess: async () => scoped(settings, { canRead: false, canEdit: false }), loadProducts: async () => scoped(settings, { plans: [], containers: [] }) }))
    expect(result.reads.management).toBe(false); expect(result.reads.platform).toBe(false); expect(result.reads.products).toBe(false)
    expect(result.management?.value.services).toEqual([]); expect(result.metrics?.value).toEqual([])
})
test('abort discards late read results without making errors or unavailable measurements into valid data', async () => {
    const ops = unlocked(), read = ops.beginRead(ops.generation, true, '')!
    const pending = readVmWorkspace(settings, read, services({ loadInventory: async () => { ops.hide(); return scoped(settings, [vm().value]) } }))
    const result = await pending
    expect(result.inventory).toBeNull(); expect(result.reads.inventory).toBe(false)
    expect(ops.finishRead(read, { target: '', authorized: true, reads: result.reads })).toBe(false)
})
test('personal creation is own-account only; selected organization needs exact active owner/admin membership', () => {
    const org = { ...settings, selectedOrganizationId: 'org' }, memberships = [{ id: 'org', name: 'Org', role: 'owner', status: 'active' }]
    expect(canCreateVm(settings, null)).toBe(true); expect(canCreateVm(org, null)).toBe(false); expect(canCreateVm(org, memberships)).toBe(true)
    for (const change of [{ status: 'suspended' }, { role: 'member' }, { id: 'other' }]) expect(canCreateVm(org, [{ ...memberships[0], ...change }])).toBe(false)
    for (const imp of [{ impersonationToken: 'imp' }, { impersonatingUserId: 'other' }]) expect(canCreateVm({ ...settings, ...imp }, memberships)).toBe(false)
})
test('fresh preflight rejects current management loss before a sensitive run callback can dispatch', async () => {
    const { ops, op } = opening(); let dispatches = 0
    await expect((async () => { await freshVmOperation(settings, services({ loadPublicServices: async () => scoped(settings, { name: 'synthetic-vm', canManage: false, services: [] }) }), ops, op); dispatches++ })()).rejects.toThrow('permission')
    expect(dispatches).toBe(0)
})
test('fresh lifecycle platform grants are independent of per-VM management', async () => {
    for (const kind of ['delete', 'restore', 'stop_all'] as const) {
        const { ops, op } = opening(kind)
        await expect(freshVmOperation(settings, services({ loadPlatformAccess: async () => scoped(settings, { canRead: true, canEdit: false }) }), ops, op)).rejects.toThrow('Hanasand')
    }
})
test('create and plan preflight reject lost organization membership before dispatch', async () => {
    const s = { ...settings, selectedOrganizationId: 'org' }
    for (const kind of ['create', 'setup_plan'] as const) {
        const { ops, op } = opening(kind, s)
        await expect(freshVmOperation(s, services({ organizations: async () => [{ id: 'org', name: 'Org', role: 'member', status: 'active' }] }), ops, op)).rejects.toThrow('owner or admin')
    }
})
test('resume requires a successful empty stored-detail read; neither failure nor existing data is eligibility', async () => {
    for (const details of [fail, async () => scoped(settings, { name: 'synthetic-vm' } as never)]) {
        const { ops, op } = opening('reprovision')
        await expect(freshVmOperation(settings, services({ loadDetails: details }), ops, op)).rejects.toThrow()
    }
    const { ops, op } = opening('reprovision')
    expect((await freshVmOperation(settings, services(), ops, op)).vm?.value.name).toBe('synthetic-vm')
})
test('hide during a preflight await blocks downstream permission reads and late private reveal after refocus', async () => {
    const { ops, op } = opening(); let grants = 0
    await expect(freshVmOperation(settings, services({ loadVm: async () => { ops.hide(); ops.visible = true; return vm() }, loadPublicServices: async () => { grants++; return scoped(settings, { name: 'synthetic-vm', canManage: true, services: [] }) } }), ops, op)).rejects.toThrow('changed')
    expect(grants).toBe(0); expect(acceptsVmResult(ops, op, settings)).toBe(false)
})
test('private result acceptance rejects completed operation, token rotation and same-VM new operation', () => {
    const { ops, op } = opening('sudo')
    expect(acceptsVmResult(ops, op, settings)).toBe(true)
    expect(acceptsVmResult(ops, op, { ...settings, authToken: 'rotated' })).toBe(false)
    ops.finish(op, true); expect(acceptsVmResult(ops, op, settings)).toBe(false)
})
test('website filter compatibility: numeric minimum CPU, normalized GiB, editor modes, retention and grouped power states', () => {
    const rows = [vm({ name: 'big', limits_cpu: '8', limits_memory: '0.0078125TiB', access_users: ['editor'], status: 'Frozen' }).value,
        vm({ name: 'small', limits_cpu: '2', limits_memory: '2048MiB', status: 'Shut Off', delete_after: 'tomorrow' }).value]
    expect(filterVms(rows, { ...defaultVmFilter, cpu: '4', memory: '4', editor: 'with', status: 'running' }).map(v => v.name)).toEqual(['big'])
    expect(filterVms(rows, { ...defaultVmFilter, editor: 'editor' }).map(v => v.name)).toEqual(['big'])
    expect(filterVms(rows, { ...defaultVmFilter, editor: 'without', lifecycle: 'deleted', status: 'stopped' }).map(v => v.name)).toEqual(['small'])
    expect(filterVms(rows, { ...defaultVmFilter, lifecycle: 'active' }).map(v => v.name)).toEqual(['big'])
    expect(memoryGiB('4096 MiB')).toBe(4); expect(memoryGiB('4294967296B')).toBe(4); expect(memoryGiB(null)).toBeNull()
})
const draft: CreateVmInput = { name: 'synthetic-vm', os: 'ubuntu-24.04', resources: { cpu: '2', memory: '4GiB', disk: '20GiB' }, services: ['nodejs'], website: { title: 'Title', tagline: 'Tag', sections: [{ heading: 'Heading', body: 'Body' }], contactEmail: 'fictional@example.test', gallery: [{ url: 'https://example.test/image', alt: 'Image', caption: 'Caption' }] } }
const plan: SetupPlan = { summary: 'A plan', services: ['minecraft-java'], packages: ['curl'], website: draft.website!, minecraftServerType: 'PAPER', projectFiles: [{ path: 'example.ts', content: 'fictional' }] }
test('title patch preserves gallery, contact and section content', () => {
    const changed = withWebsiteField(draft, { title: 'Changed' })
    expect(changed.title).toBe('Changed'); expect(changed.gallery).toEqual(draft.website!.gallery); expect(changed.contactEmail).toBe('fictional@example.test'); expect(changed.sections).toEqual(draft.website!.sections)
})
test('accepted AI plan never accepts EULA; OS/prompt reset removes all generated setup payload fields', () => {
    const applied = applyVmPlan(draft, plan)
    expect(applied.services).toEqual(plan.services); expect(applied.minecraft_eula_accepted).toBe(false)
    const reset = clearVmSuggestion(applied)
    expect(reset.name).toBe(draft.name); expect(reset.services).toEqual([]); expect(reset.custom_apt_packages).toEqual([])
    expect(reset.project_files).toBeUndefined(); expect(reset.website).toBeUndefined(); expect(reset.minecraft_server_type).toBeUndefined(); expect(reset.minecraft_eula_accepted).toBe(false)
})
test('component-owned resume draft survives read removal/reinstantiation without entering uncertainty metadata', () => {
    const memory: VmEditorMemory = {}
    saveEditorValue(memory, 'draft', draft); saveEditorValue(memory, 'prompt', 'Build my project'); saveEditorValue(memory, 'confirmation', 'synthetic-vm')
    const first = editorValue(memory, 'draft', { ...draft, name: 'discarded' })
    const next = editorValue(memory, 'draft', { ...draft, name: 'new default' })
    expect(first).toEqual(next); expect(next.website?.contactEmail).toBe('fictional@example.test')
    expect(editorValue(memory, 'confirmation', '')).toBe('synthetic-vm')
    const { ops, op } = opening('reprovision'); ops.finish(op, false)
    expect(Object.keys(ops.unknown!)).toEqual(['token', 'kind', 'target'])
})
test('metric graph preserves real zero and splits unavailable gaps instead of inventing a line through them', () => {
    const sample = (n: number | null) => ({ cpu_usage_percent: n } as Parameters<typeof metricSegments>[0][number])
    expect(metricSegments([sample(0), sample(null), sample(50)], 'cpu_usage_percent', 100, 100)).toEqual(['0,100', '100,50'])
    expect(metricSegments([sample(null)], 'cpu_usage_percent')).toEqual([])
})
test('native target current-listener model replaces action/editor hosts at operation boundaries but keeps ordinary typing', () => {
    const ops = unlocked(), targets = new Map<number, () => void>(); let text = 'retained', sends = 0
    const mount = () => { const g = ops.generation; targets.clear(); targets.set(g, () => { if (ops.edit(g)) text = 'queued'; if (ops.review(g, 'power', 'synthetic-vm')) sends++ }); return g }
    const before = mount(); ops.edit(before); expect(ops.generation).toBe(before)
    const op = ops.begin(ops.review(before, 'power', 'synthetic-vm')!, 'native')!
    mount(); targets.get(before)?.(); expect(text).toBe('retained'); expect(sends).toBe(0)
    ops.finish(op, true); mount(); targets.get(before)?.(); expect(text).toBe('retained'); expect(sends).toBe(0)
})
test('actual UI wiring pins host boundaries, private result guards, explicit effect calls and separate terminal/boot sinks', async () => {
    const [screen, detail, create, hook] = await Promise.all(['../../screens/VirtualMachinesScreen.tsx', './DetailPanel.tsx', './CreatePanel.tsx', './useWorkspace.ts'].map(path => Bun.file(new URL(path, import.meta.url)).text()))
    expect(screen).toContain('key={`workspace-controls:${g}`}'); expect(screen).toContain('w.refresh(g, true)')
    expect(screen).toContain('style={{ marginBottom: 16 }}')
    expect(detail).toContain('key={`detail-controls:${g}:${target}`}'); expect(detail).toContain('memory={editorMemory}')
    expect(create).toContain('key={`create:${g}`}'); expect(create).toContain('setDraft(clearVmSuggestion)'); expect(create).toContain('setPackages(\'\'); setSummary(\'\'); setSuggestedKey(\'\')')
    expect(detail).toContain('TerminalSurface key={w.channel.id}'); expect(detail).toContain('w.channel?.close(); w.dismissPrivate()')
    expect(detail).toContain('Boot log · retained tail'); expect(detail).toContain('!acceptsVmResult(w.ops, op, settings)')
    expect(hook).toContain('acceptsVmResult(ops, op, settings)) setSecret'); expect(hook).toContain('acceptsVmResult(ops, op, settings)) setConnection')
    expect(hook).toContain('ops.beginRead(generation, manual, target)'); expect(hook).toContain('ops.finish(op, definite)')
})
