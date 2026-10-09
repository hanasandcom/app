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

struct DashboardApiKeyUpdatePayload: Encodable {
    let ownerId: String
    let name: String
    let tier: String
    let description: String?
    let enabled: Bool
    let expiresAt: String?
    let scopes: [DashboardApiKeyScopePayload]

    init(key: DashboardApiKeySummary, enabled: Bool) {
        self.ownerId = key.ownerId
        self.name = key.name
        self.tier = key.tier
        self.description = key.description
        self.enabled = enabled
        self.expiresAt = key.expiresAt
        self.scopes = key.scopes.map { DashboardApiKeyScopePayload(scope: $0) }
    }
}
