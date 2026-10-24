const IOS_TOP_CUTOUT_FALLBACK = 82

// Keep modal content clear of the Dynamic Island if its host reports a reduced inset.
export function safeAreaTopInset(reportedInset: number, platform: string) {
    const inset = Number.isFinite(reportedInset) ? Math.max(0, reportedInset) : 0
    return platform === 'ios' ? Math.max(inset, IOS_TOP_CUTOUT_FALLBACK) : inset
}

/** Keep the compact native settings drawer below status bars and cutouts, even in a Modal window reporting zero. */
export function safeAreaDrawerTopInset(reportedInset: number, platform: string) {
    const top = safeAreaTopInset(reportedInset, platform)
    return platform === 'ios' ? Math.max(120, top + 32) : top + 32
}
