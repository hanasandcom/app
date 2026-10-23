import type { Vm } from './model'
export type VmFilter = { query: string; cpu: string; memory: string; editor: string; lifecycle: 'all' | 'active' | 'deleted'; status: string }
export const defaultVmFilter: VmFilter = { query: '', cpu: '', memory: '', editor: '', lifecycle: 'all', status: '' }
export function memoryGiB(value: string | null): number | null {
    const match = value?.trim().match(/^([\d.]+)\s*(B|KB|KIB|MB|MIB|GB|GIB|TB|TIB)?$/i)
    if (!match) return null
    const amount = Number(match[1]), powers: Record<string, number> = { B: -30, KB: -20, KIB: -20, MB: -10, MIB: -10, GB: 0, GIB: 0, TB: 10, TIB: 10 }
    return Number.isFinite(amount) && amount >= 0 ? amount * 2 ** powers[(match[2] || 'GB').toUpperCase()] : null
}
// Matches Core6b website filters: numeric minima, editor membership, grouped power states and either retention timestamp.
export function filterVms(rows: Vm[], filter: VmFilter): Vm[] {
    const query = filter.query.trim().toLowerCase(), cpu = Number(filter.cpu) || 0, memory = Number(filter.memory) || 0
    return rows.filter(vm => {
        if (!vm.name.toLowerCase().includes(query)) return false
        if (cpu && (Number.parseFloat(vm.limits_cpu || '') || 0) < cpu) return false
        if (memory && (memoryGiB(vm.limits_memory) ?? 0) < memory) return false
        if (filter.editor === 'with' && !vm.access_users.length || filter.editor === 'without' && vm.access_users.length) return false
        if (filter.editor && !['with', 'without'].includes(filter.editor) && !vm.access_users.includes(filter.editor)) return false
        const scheduled = !!(vm.deleted_at || vm.delete_after)
        if (filter.lifecycle === 'deleted' && !scheduled || filter.lifecycle === 'active' && scheduled) return false
        const status = (vm.status || '').toLowerCase()
        if (filter.status === 'running' && !['running', 'frozen', 'starting'].includes(status)) return false
        if (filter.status === 'stopped' && !['stopped', 'shut off'].includes(status)) return false
        return true
    }).sort((a, b) => a.name.localeCompare(b.name))
}
