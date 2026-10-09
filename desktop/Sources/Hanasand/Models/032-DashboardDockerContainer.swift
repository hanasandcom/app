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

struct DashboardDockerContainer: Decodable, Identifiable {
    let id: String
    let name: String?
    let status: String?
    let cpu: Double?
    let memory: Double?
    let createdAt: String?

    var displayName: String {
        let clean = (name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return clean.isEmpty ? String(id.prefix(12)) : clean
    }

    var statusLabel: String {
        (status ?? "unknown").capitalized
    }

    var cpuLabel: String {
        guard let cpu else { return "Unknown" }
        return "\(String(format: "%.1f", cpu))%"
    }

    var memoryLabel: String {
        guard let memory else { return "Unknown" }
        return "\(String(format: "%.0f", memory)) MB"
    }

    var createdLabel: String {
        guard let createdAt else { return "No timestamp" }
        return formatDateText(createdAt, fallback: createdAt)
    }

    var isRunning: Bool {
        (status ?? "").localizedCaseInsensitiveContains("running")
    }

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case status
        case cpu
        case memory
        case createdAt = "created_at"
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
        name = try? container.decode(String.self, forKey: .name)
        status = try? container.decode(String.self, forKey: .status)
        if let value = try? container.decode(Double.self, forKey: .cpu) {
            cpu = value
        } else if let string = try? container.decode(String.self, forKey: .cpu) {
            cpu = Double(string.trimmingCharacters(in: CharacterSet(charactersIn: "% ")))
        } else {
            cpu = nil
        }
        if let value = try? container.decode(Double.self, forKey: .memory) {
            memory = value
        } else if let string = try? container.decode(String.self, forKey: .memory) {
            memory = Double(string.replacingOccurrences(of: "MB", with: "").trimmingCharacters(in: .whitespacesAndNewlines))
        } else {
            memory = nil
        }
        createdAt = try? container.decode(String.self, forKey: .createdAt)
    }
}
