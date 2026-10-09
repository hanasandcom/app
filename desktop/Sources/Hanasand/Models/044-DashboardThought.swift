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

struct DashboardThought: Decodable, Identifiable {
    let id: String
    let title: String
    let createdAt: String?
    let createdBy: String?
    let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case createdAt = "created_at"
        case createdBy = "created_by"
        case updatedAt = "updated_at"
    }

    var updatedLabel: String {
        formatDateText(updatedAt, fallback: formatDateText(createdAt, fallback: "No timestamp"))
    }
}
