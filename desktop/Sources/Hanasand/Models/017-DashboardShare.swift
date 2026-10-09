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

struct DashboardShare: Decodable, Identifiable {
    let id: String
    let name: String?
    let path: String?
    let alias: String?
    let type: String?
    let timestamp: String?
    let updatedAt: String?
    let createdAt: String?
    let content: String?
    let locked: Bool?
    let wordCount: Int?
    let estimatedMinutes: Int?

    var displayName: String {
        let candidates = [name, path, alias, id]
        return candidates.compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }.first { !$0.isEmpty } ?? id
    }

    var subtitle: String {
        [type, alias, path].compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    var updatedLabel: String {
        formatDateText(updatedAt, fallback: formatDateText(timestamp, fallback: createdAt ?? "No timestamp"))
    }

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case path
        case alias
        case type
        case timestamp
        case updatedAt = "updated_at"
        case createdAt = "created_at"
        case content
        case locked
        case wordCount
        case estimatedMinutes
    }
}
