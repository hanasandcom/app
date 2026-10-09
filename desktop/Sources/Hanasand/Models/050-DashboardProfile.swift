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

struct DashboardProfile: Decodable, Identifiable {
    let id: String
    let name: String?
    let avatar: String?
    let active: Bool?
    let roles: [DashboardRole]?
    let token: String?
    let expiresAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case avatar
        case active
        case roles
        case token
        case expiresAt = "expires_at"
    }

    var displayName: String { name?.isEmpty == false ? name! : id }
}
