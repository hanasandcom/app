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

struct HanasandAIClient {
    let session: URLSession
    let apiURL: URL
    let token: String
    let userId: String

    init(apiURL configuredURL: URL? = nil, token configuredToken: String = "", userId configuredUserId: String = "", session: URLSession = .shared) {
        self.session = session
        let environment = ProcessInfo.processInfo.environment
        let configured = environment["HANASAND_AI_API"] ?? "https://api.hanasand.com/api/tools/ai"
        apiURL = configuredURL ?? URL(string: configured) ?? URL(string: "https://api.hanasand.com/api/tools/ai")!
        token = configuredToken.isEmpty ? (environment["HANASAND_API_TOKEN"] ?? environment["HANASAND_AUTH_TOKEN"] ?? "") : configuredToken
        userId = configuredUserId.isEmpty ? (environment["HANASAND_USER_ID"] ?? "") : configuredUserId
    }

    func send(prompt: String, context: String) async throws -> HanasandAIResponse {
        let (data, response) = try await performRequest(prompt: prompt, context: context, includeUserId: true)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 200
        if status == 401 && !token.isEmpty && !userId.isEmpty {
            let (retryData, retryResponse) = try await performRequest(prompt: prompt, context: context, includeUserId: false)
            return try decodeResponse(data: retryData, response: retryResponse)
        }

        return try decodeResponse(data: data, response: response)
    }

    func performRequest(prompt: String, context: String, includeUserId: Bool) async throws -> (Data, URLResponse) {
        var request = URLRequest(url: apiURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "local"
        request.setValue("Hanasand Desktop/\(version)", forHTTPHeaderField: "User-Agent")
        if !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if includeUserId && !userId.isEmpty {
            request.setValue(userId, forHTTPHeaderField: "id")
        }
        request.httpBody = try JSONEncoder().encode(AIRequest(prompt: prompt, context: context))

        return try await session.data(for: request)
    }

    func decodeResponse(data: Data, response: URLResponse) throws -> HanasandAIResponse {
        let status = (response as? HTTPURLResponse)?.statusCode ?? 200
        let payload = try? JSONDecoder().decode(AIToolPayload.self, from: data)

        guard (200..<300).contains(status) else {
            throw HanasandAIError.httpStatus(status, payload?.error, rateLimitSnapshot(response: response, payload: payload))
        }

        let text = payload?.message
            ?? payload?.suggestion
            ?? payload?.error
            ?? String(data: data, encoding: .utf8)
            ?? "No response."
        let meta = payload?.status == "configured_later" ? "Hanasand AI" : "Hanasand AI"

        return HanasandAIResponse(meta: meta, body: text)
    }

    struct AIRequest: Encodable {
        let prompt: String
        let context: String
    }

    struct AIToolPayload: Decodable {
        let status: String?
        let message: String?
        let suggestion: String?
        let error: String?
        let retryAfterMs: Double?
        let resetAt: String?
    }

    func rateLimitSnapshot(response: URLResponse, payload: AIToolPayload?) -> AIRateLimitSnapshot? {
        guard let http = response as? HTTPURLResponse else { return nil }

        let hourlyLimit = http.intHeader("x-api-key-rate-limit-hour") ?? http.intHeader("x-rate-limit-limit")
        let hourlyRemaining = http.intHeader("x-api-key-rate-limit-hour-remaining") ?? http.intHeader("x-rate-limit-remaining")
        let hourlyResetAt = http.dateHeader("x-api-key-rate-limit-hour-reset") ?? http.dateHeader("x-rate-limit-reset")
        let dailyLimit = http.intHeader("x-api-key-rate-limit-day")
        let dailyRemaining = http.intHeader("x-api-key-rate-limit-day-remaining")
        let dailyResetAt = http.dateHeader("x-api-key-rate-limit-day-reset")

        let retryAfterSeconds = http.doubleHeader("retry-after")
        var blockedUntil = payload?.resetDate
        if blockedUntil == nil, let retryAfterMs = payload?.retryAfterMs {
            blockedUntil = Date().addingTimeInterval(max(1, retryAfterMs / 1000))
        }
        if blockedUntil == nil, let retryAfterSeconds {
            blockedUntil = Date().addingTimeInterval(max(1, retryAfterSeconds))
        }
        if blockedUntil == nil, http.statusCode == 429 {
            blockedUntil = hourlyResetAt ?? dailyResetAt ?? Date().addingTimeInterval(15 * 60)
        }

        let snapshot = AIRateLimitSnapshot(
            blockedUntil: blockedUntil,
            hourlyLimit: hourlyLimit,
            hourlyRemaining: hourlyRemaining,
            hourlyResetAt: hourlyResetAt,
            dailyLimit: dailyLimit,
            dailyRemaining: dailyRemaining,
            dailyResetAt: dailyResetAt
        )
        return snapshot.hasQuotaDetails ? snapshot : nil
    }
}

private extension HanasandAIClient.AIToolPayload {
    var resetDate: Date? {
        guard let resetAt else { return nil }
        return ISO8601DateFormatter().date(from: resetAt)
    }
}

private extension HTTPURLResponse {
    func header(_ name: String) -> String? {
        for (key, value) in allHeaderFields {
            guard String(describing: key).caseInsensitiveCompare(name) == .orderedSame else { continue }
            return String(describing: value)
        }
        return nil
    }

    func intHeader(_ name: String) -> Int? {
        guard let value = header(name)?.trimmingCharacters(in: .whitespacesAndNewlines) else { return nil }
        return Int(value)
    }

    func doubleHeader(_ name: String) -> Double? {
        guard let value = header(name)?.trimmingCharacters(in: .whitespacesAndNewlines) else { return nil }
        return Double(value)
    }

    func dateHeader(_ name: String) -> Date? {
        guard let value = header(name)?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
        if let milliseconds = Double(value), milliseconds > 1_000_000_000_000 {
            return Date(timeIntervalSince1970: milliseconds / 1000)
        }
        if let seconds = Double(value), seconds > 1_000_000_000 {
            return Date(timeIntervalSince1970: seconds)
        }
        return ISO8601DateFormatter().date(from: value)
    }
}
