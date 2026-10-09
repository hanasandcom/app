import Foundation

struct AIRateLimitSnapshot: Equatable {
    var blockedUntil: Date?
    var hourlyLimit: Int?
    var hourlyRemaining: Int?
    var hourlyResetAt: Date?
    var dailyLimit: Int?
    var dailyRemaining: Int?
    var dailyResetAt: Date?

    var isBlocked: Bool {
        guard let blockedUntil else { return false }
        return blockedUntil > Date()
    }

    var nextResetAt: Date? {
        [hourlyResetAt, dailyResetAt, blockedUntil]
            .compactMap { $0 }
            .filter { $0 > Date() }
            .min()
    }

    func usageFraction(limit: Int?, remaining: Int?) -> Double? {
        guard let limit, let remaining, limit > 0 else { return nil }
        return min(1, max(0, 1 - (Double(remaining) / Double(limit))))
    }

    var hourlyUsageFraction: Double? {
        usageFraction(limit: hourlyLimit, remaining: hourlyRemaining)
    }

    var dailyUsageFraction: Double? {
        usageFraction(limit: dailyLimit, remaining: dailyRemaining)
    }

    var hasQuotaDetails: Bool {
        hourlyUsageFraction != nil || dailyUsageFraction != nil || blockedUntil != nil
    }
}
