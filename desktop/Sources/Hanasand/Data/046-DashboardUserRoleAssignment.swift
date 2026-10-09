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

struct DashboardUserRoleAssignment: Decodable, Identifiable {
    let id: String
    let name: String?
    let priority: Int?
    let assignedBy: String?
    let assignedAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case priority
        case assignedBy = "assigned_by"
        case assignedAt = "assigned_at"
    }

    var displayName: String { name?.isEmpty == false ? name! : id }
}
