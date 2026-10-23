import type { VmMetric } from './model'
export function metricSegments(rows: VmMetric[], field: 'cpu_usage_percent' | 'ram_used_mb', width = 280, height = 80): string[] {
    const values = rows.map(row => row[field]), valid = values.filter((v): v is number => v !== null && Number.isFinite(v) && v >= 0)
    const ceiling = field === 'cpu_usage_percent' ? Math.max(100, ...valid) : Math.max(1, ...valid)
    const segments: string[] = []; let points: string[] = []
    const flush = () => { if (points.length) segments.push(points.join(' ')); points = [] }
    values.forEach((value, index) => {
        if (value === null || !Number.isFinite(value) || value < 0) { flush(); return }
        points.push(`${rows.length <= 1 ? width / 2 : index * width / (rows.length - 1)},${height - value / ceiling * height}`)
    })
    flush(); return segments
}
