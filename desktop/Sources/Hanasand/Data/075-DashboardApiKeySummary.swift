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

struct DashboardApiKeySummary: Decodable, Identifiable {
    let id: String
    let ownerId: String
    let name: String
    let tier: String
    let description: String?
    let enabled: Bool
    let keyPrefix: String
    let createdAt: String?
    let updatedAt: String?
    let expiresAt: String?
    let lastUsedAt: String?
    let scopes: [DashboardApiKeyScopeRule]

    var statusLabel: String {
        enabled ? "Enabled" : "Disabled"
    }

    var createdLabel: String {
        formatDateText(createdAt, fallback: "No timestamp")
    }

    var lastUsedLabel: String {
        formatDateText(lastUsedAt, fallback: "Never used")
    }
}
