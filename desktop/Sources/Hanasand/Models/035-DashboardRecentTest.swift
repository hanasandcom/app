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

struct DashboardRecentTest: Decodable, Identifiable {
    let id: String
    let url: String
    let timeout: Int?
    let status: String
    let logs: [String]?
    let errors: [String]?
    let createdAt: String?
    let finishedAt: String?
    let exitCode: Int?
    let visits: Int?
    let summary: JSONValue?
    let latestRunSummary: JSONValue?
    let previousRunSummary: JSONValue?
    let latestRunNumber: Int?
    let p95DeltaMs: Double?

    var createdLabel: String {
        formatDateText(createdAt, fallback: "No timestamp")
    }

    var finishedLabel: String {
        formatDateText(finishedAt, fallback: finishedAt == nil ? "Not finished" : "No timestamp")
    }

    var statusLabel: String {
        status.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "unknown" : status
    }

    var displayURL: String {
        url.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "No URL" : url
    }

    var activeSummary: JSONValue? {
        latestRunSummary ?? summary
    }

    var requestCount: Int? {
        activeSummary?.numberValue(for: ["requests"]).map(Int.init)
    }

    var p95Milliseconds: Double? {
        activeSummary?.numberValue(for: ["duration", "p95"])
    }

    var failureRatePercent: Double? {
        activeSummary?.numberValue(for: ["failureRate"]).map { $0 * 100 }
    }

    var p95DeltaLabel: String? {
        guard let p95DeltaMs, p95DeltaMs != 0 else { return nil }
        return "\(p95DeltaMs >= 0 ? "faster" : "slower") \(Int(abs(p95DeltaMs).rounded()))ms"
    }

    enum CodingKeys: String, CodingKey {
        case id
        case url
        case timeout
        case status
        case logs
        case errors
        case createdAt = "created_at"
        case finishedAt = "finished_at"
        case exitCode = "exit_code"
        case visits
        case summary
        case latestRunSummary = "latest_run_summary"
        case previousRunSummary = "previous_run_summary"
        case latestRunNumber = "latest_run_number"
        case p95DeltaMs = "p95_delta_ms"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let stringID = try? container.decode(String.self, forKey: .id) {
            id = stringID
        } else if let intID = try? container.decode(Int.self, forKey: .id) {
            id = String(intID)
        } else {
            id = UUID().uuidString
        }
        url = (try? container.decode(String.self, forKey: .url)) ?? ""
        timeout = try? container.decode(Int.self, forKey: .timeout)
        status = (try? container.decode(String.self, forKey: .status)) ?? "unknown"
        logs = try? container.decode([String].self, forKey: .logs)
        errors = try? container.decode([String].self, forKey: .errors)
        createdAt = try? container.decode(String.self, forKey: .createdAt)
        finishedAt = try? container.decode(String.self, forKey: .finishedAt)
        exitCode = try? container.decode(Int.self, forKey: .exitCode)
        visits = try? container.decode(Int.self, forKey: .visits)
        summary = try? container.decode(JSONValue.self, forKey: .summary)
        latestRunSummary = try? container.decode(JSONValue.self, forKey: .latestRunSummary)
        previousRunSummary = try? container.decode(JSONValue.self, forKey: .previousRunSummary)
        latestRunNumber = try? container.decode(Int.self, forKey: .latestRunNumber)
        p95DeltaMs = try? container.decode(Double.self, forKey: .p95DeltaMs)
    }
}
