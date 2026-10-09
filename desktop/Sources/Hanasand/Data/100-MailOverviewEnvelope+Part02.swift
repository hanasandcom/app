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

extension MailOverviewEnvelope {

    struct Account: Decodable, Identifiable {
        let id: String
        let name: String?
        let address: String
    }

    struct Health: Decodable {
        struct Check: Decodable, Identifiable {
            let id: String
            let label: String?
            let status: String?
            let detail: String?
        }

        let status: String
        let checkedAt: String?
        let queueDepth: Int?
        let smtpBannerLatencyMs: Int?
        let checks: [Check]?
    }

    struct Settings: Decodable {
        let host: String?
        let smtpHost: String?
        let smtpPort: Int?
        let imapHost: String?
        let imapPort: Int?
        let managesievePort: Int?
        let username: String?
        let address: String?
    }

    struct Filter: Decodable, Identifiable {
        struct Criteria: Decodable {
            let field: String?
            let contains: String?
        }

        struct Action: Decodable {
            let type: String?
            let mailboxName: String?
            let markRead: Bool?
        }

        let id: Int
        let name: String
        let enabled: Bool?
        let criteria: Criteria?
        let action: Action?
        let createdAt: String?
        let updatedAt: String?

        enum CodingKeys: String, CodingKey {
            case id
            case name
            case enabled
            case criteria
            case action
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }

        var ruleLabel: String {
            let field = criteria?.field ?? "from"
            let contains = criteria?.contains ?? "anything"
            let target = action?.mailboxName ?? "mailbox"
            return "\(field) contains \(contains) -> \(target)"
        }
    }

    struct RecentRecipient: Decodable, Identifiable {
        let email: String
        let name: String?
        let useCount: Int?
        let lastUsedAt: String?

        var id: String { email }

        var displayName: String {
            let cleanName = (name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            return cleanName.isEmpty ? email : "\(cleanName) <\(email)>"
        }
    }
}
