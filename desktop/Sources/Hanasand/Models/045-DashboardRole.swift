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

struct DashboardRole: Decodable, Identifiable {
    let id: String
    let name: String?
    let description: String?
    let priority: Int?
    let createdBy: String?
    let createdAt: String?
    let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case description
        case priority
        case createdBy = "created_by"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    var displayName: String { name?.isEmpty == false ? name! : id }
}
