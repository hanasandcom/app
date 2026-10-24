const IOS_TOP_CUTOUT_FALLBACK = 62

// Keep modal content clear of the Dynamic Island if its host reports a reduced inset.
export function safeAreaTopInset(reportedInset: number, platform: string) {
    const inset = Number.isFinite(reportedInset) ? Math.max(0, reportedInset) : 0
    return platform === 'ios' ? Math.max(inset, IOS_TOP_CUTOUT_FALLBACK) : inset
}
