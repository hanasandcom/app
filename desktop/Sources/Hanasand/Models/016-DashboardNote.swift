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

struct DashboardNote: Decodable, Identifiable {
    let id: String
    let title: String
    let content: String
    let source: String
    let ownerID: String?
    let createdAt: String?
    let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case content
        case source
        case ownerID = "owner_id"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}
