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

struct DashboardAuthSession: Decodable, Identifiable {
    var id: Int { tokenID }
    let tokenID: Int
    let userID: String?
    let ip: String?
    let userAgent: String?
    let createdAt: String?
    let lastSeenAt: String?
    let revokedAt: String?

    enum CodingKeys: String, CodingKey {
        case tokenID = "token_id"
        case userID = "id"
        case ip
        case userAgent = "user_agent"
        case createdAt = "created_at"
        case lastSeenAt = "last_seen_at"
        case revokedAt = "revoked_at"
    }

    var deviceLabel: String {
        let agent = userAgent ?? ""
        if agent.range(of: "mobile|iphone|android", options: .regularExpression) != nil {
            return "Mobile"
        }
        if agent.range(of: "curl|node|monitor|playwright", options: .regularExpression) != nil {
            return "Automation"
        }
        return "Desktop"
    }
}
