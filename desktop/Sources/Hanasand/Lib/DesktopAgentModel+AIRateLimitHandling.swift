import AppKit
import ApplicationServices
import Combine
import CryptoKit
import Darwin
import Foundation
import Network
import PDFKit
import SwiftUI
import UniformTypeIdentifiers
import WebKit

extension DesktopAgentModel {

    var isAIRateLimited: Bool {
        guard let blockedUntil = aiRateLimit?.blockedUntil else { return false }
        return blockedUntil > Date()
    }

    func applyAIRateLimit(_ snapshot: AIRateLimitSnapshot) {
        aiRateLimit = snapshot
        aiRateLimitClock = Date()
        aiSummary = "Limit reached"
        scheduleAIRateLimitClock()
    }

    func rateLimitSnapshot(from error: Error) -> AIRateLimitSnapshot? {
        if case HanasandAIError.httpStatus(let status, _, let snapshot) = error, status == 429 {
            return snapshot ?? fallbackRateLimitSnapshot()
        }
        let text = error.localizedDescription
        if text.lowercased().contains("429") || text.lowercased().contains("rate limit") {
            return fallbackRateLimitSnapshot()
        }
        return nil
    }

    func rateLimitSnapshot(from message: String) -> AIRateLimitSnapshot? {
        let lower = message.lowercased()
        guard lower.contains("429") || lower.contains("rate limit") || lower.contains("too many requests") else { return nil }
        return fallbackRateLimitSnapshot()
    }

    func fallbackRateLimitSnapshot() -> AIRateLimitSnapshot {
        AIRateLimitSnapshot(
            blockedUntil: Date().addingTimeInterval(15 * 60),
            hourlyLimit: nil,
            hourlyRemaining: nil,
            hourlyResetAt: Date().addingTimeInterval(15 * 60),
            dailyLimit: nil,
            dailyRemaining: nil,
            dailyResetAt: nil
        )
    }

    func finishRateLimitedAIResponse() {
        isRunning = false
        aiLastDuration = elapsedAIRunText()
        if let index = aiMessages.lastIndex(where: { $0.isPending && $0.role == .assistant }) {
            aiMessages.remove(at: index)
        }
        runNextQueuedPrompt()
    }

    func scheduleAIRateLimitClock() {
        aiRateLimitTask?.cancel()
        aiRateLimitTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                await MainActor.run {
                    guard let self else { return }
                    self.aiRateLimitClock = Date()
                    self.clearExpiredAIRateLimitIfReady()
                }
            }
        }
    }

    func clearExpiredAIRateLimitIfReady() {
        guard let snapshot = aiRateLimit else { return }
        let now = Date()
        if let blockedUntil = snapshot.blockedUntil, blockedUntil > now {
            return
        }

        aiSummary = aiClients.isEmpty ? "Ready" : aiSummary
        if snapshot.nextResetAt == nil {
            aiRateLimit = nil
            aiRateLimitTask?.cancel()
            aiRateLimitTask = nil
        } else {
            aiRateLimit?.blockedUntil = nil
        }
        runNextQueuedPrompt()
    }

    func quotaFooterTitle(now: Date = Date()) -> String {
        guard let snapshot = aiRateLimit else { return "Working locally" }
        if let blockedUntil = snapshot.blockedUntil, blockedUntil > now {
            let seconds = Int(blockedUntil.timeIntervalSince(now).rounded(.up))
            if seconds <= 60 * 60 {
                return "Limit reached, try again in \(max(1, Int(ceil(Double(seconds) / 60)))) minute\(seconds <= 60 ? "" : "s")"
            }
            return "Limit reached, try again at \(Self.quotaTimeFormatter.string(from: blockedUntil))"
        }
        if let resetAt = snapshot.nextResetAt, resetAt > now {
            return "Limited for \(Self.quotaDuration(until: resetAt, now: now))"
        }
        return "Working locally"
    }

    func quotaUsageLabel(_ fraction: Double?) -> String {
        guard let fraction else { return "No recent pressure" }
        switch fraction {
        case ..<0.25:
            return "Fresh"
        case ..<0.5:
            return "Light use"
        case ..<0.75:
            return "Steady use"
        case ..<0.92:
            return "Mostly used"
        default:
            return "Nearly used"
        }
    }

    func quotaResetLabel(_ date: Date?, now: Date = Date()) -> String {
        guard let date, date > now else { return "Ready now" }
        let seconds = Int(date.timeIntervalSince(now).rounded(.up))
        if seconds <= 60 * 60 {
            return "Resets in \(max(1, Int(ceil(Double(seconds) / 60)))) minute\(seconds <= 60 ? "" : "s")"
        }
        return "Resets at \(Self.quotaTimeFormatter.string(from: date))"
    }

    static let quotaTimeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter
    }()

    static func quotaDuration(until date: Date, now: Date) -> String {
        let totalMinutes = max(1, Int(ceil(date.timeIntervalSince(now) / 60)))
        let hours = totalMinutes / 60
        let minutes = totalMinutes % 60
        if hours > 0 {
            return "\(hours) hour\(hours == 1 ? "" : "s") \(minutes) minute\(minutes == 1 ? "" : "s")"
        }
        return "\(minutes) minute\(minutes == 1 ? "" : "s")"
    }
}
