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

struct HanasandLoginResponse: Decodable {
    let id: String?
    let token: String?
    let expiresAt: String?
    let error: String?
    let pendingDeletion: Bool?
    let deletionScheduledAt: String?
    let restoreToken: String?

    enum CodingKeys: String, CodingKey {
        case id
        case token
        case expiresAt = "expires_at"
        case error
        case pendingDeletion = "pending_deletion"
        case deletionScheduledAt = "deletion_scheduled_at"
        case restoreToken = "restore_token"
    }
}
