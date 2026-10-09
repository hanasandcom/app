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

struct DashboardVM: Decodable, Identifiable {
    let name: String
    let owner: String?
    let createdBy: String?
    let accessUsers: [String]?
    let status: String?
    let type: String?
    let architecture: String?
    let created: String?
    let lastUsed: String?
    let description: String?
    let cpuLimit: String?
    let memoryLimit: String?
    let ipv4: String?
    let lastChecked: String?

    var id: String { name }

    var statusLabel: String {
        (status ?? "unknown").capitalized
    }

    var ownerLabel: String {
        owner ?? createdBy ?? "Unknown owner"
    }

    var createdLabel: String {
        guard let created else { return "No timestamp" }
        return formatDateText(created, fallback: created)
    }

    var lastUsedLabel: String {
        guard let lastUsed else { return "No activity" }
        return formatDateText(lastUsed, fallback: lastUsed)
    }

    var tags: [String] {
        [type, architecture, ipv4].compactMap { value in
            let clean = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            return clean.isEmpty ? nil : clean
        }
    }

    enum CodingKeys: String, CodingKey {
        case name
        case owner
        case createdBy = "created_by"
        case accessUsers = "access_users"
        case status
        case type
        case architecture
        case created
        case lastUsed = "last_used"
        case description = "config_image_description"
        case cpuLimit = "limits_cpu"
        case memoryLimit = "limits_memory"
        case ipv4 = "device_eth0_ipv4_address"
        case lastChecked = "last_checked"
    }
}
