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

struct DashboardApiKeyCreatePayload: Encodable {
    let ownerId: String
    let name: String
    let tier: String
    let description: String?
    let enabled: Bool
    let expiresAt: String?
    let scopes: [DashboardApiKeyScopePayload]

    init(
        ownerId: String,
        name: String,
        tier: String,
        description: String?,
        enabled: Bool,
        expiresAt: String?,
        scope: DashboardApiKeyScopePayload
    ) {
        self.ownerId = ownerId
        self.name = name
        self.tier = tier
        self.description = description
        self.enabled = enabled
        self.expiresAt = expiresAt
        self.scopes = [scope]
    }
}
