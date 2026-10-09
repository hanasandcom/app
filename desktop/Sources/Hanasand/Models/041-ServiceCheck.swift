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

struct ServiceCheck: Decodable, Identifiable {
    let service: String
    let checkName: String
    let status: String
    let latencyMs: Double?
    let message: String?
    let checkedAt: String?
    let uptime30d: String?

    enum CodingKeys: String, CodingKey {
        case service
        case checkName = "check_name"
        case status
        case latencyMs = "latency_ms"
        case message
        case checkedAt = "checked_at"
        case uptime30d = "uptime_30d"
    }

    var id: String {
        "\(service)-\(checkName)"
    }

    var statusLabel: String {
        status.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "unknown" : status
    }

    var checkLabel: String {
        checkName.replacingOccurrences(of: "_", with: " ")
    }

    var latencyLabel: String {
        guard let latencyMs else { return "Unknown" }
        return "\(Int(latencyMs.rounded())) ms"
    }

    var uptimeLabel: String {
        guard let uptime30d, !uptime30d.isEmpty else { return "0%" }
        return "\(uptime30d)%"
    }

    var checkedLabel: String {
        formatDateText(checkedAt, fallback: "No timestamp")
    }
}
