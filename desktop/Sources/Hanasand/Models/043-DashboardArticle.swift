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

struct DashboardArticle: Decodable, Identifiable {
    struct Metadata: Decodable {
        let image: String?
        let description: String?
        let wordCount: Int?
        let estimatedMinutes: Int?
    }

    let id: String
    let size: Int?
    let created: String?
    let modified: String?
    let metadata: Metadata?
    let title: String
    let content: String?

    var publishedLabel: String {
        formatDateText(modified, fallback: formatDateText(created, fallback: "No timestamp"))
    }

    var readingLabel: String {
        guard let minutes = metadata?.estimatedMinutes else { return "No estimate" }
        return "\(minutes) min read"
    }
}
