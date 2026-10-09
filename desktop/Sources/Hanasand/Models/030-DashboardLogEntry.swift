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

struct DashboardLogEntry: Decodable, Identifiable {
    let id: String
    let service: String
    let host: String?
    let level: String
    let message: String
    let metadata: JSONValue?
    let createdAt: String
    let source: String?

    var createdLabel: String {
        formatDateText(createdAt, fallback: createdAt)
    }

    var isError: Bool {
        level == "error" || level == "fatal"
    }

    enum CodingKeys: String, CodingKey {
        case id
        case service
        case host
        case level
        case message
        case metadata
        case createdAt = "created_at"
        case source
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let stringID = try? container.decode(String.self, forKey: .id) {
            id = stringID
        } else if let intID = try? container.decode(Int.self, forKey: .id) {
            id = String(intID)
        } else {
            id = UUID().uuidString
        }
        service = (try? container.decode(String.self, forKey: .service)) ?? "unknown"
        host = try? container.decode(String.self, forKey: .host)
        level = (try? container.decode(String.self, forKey: .level)) ?? "info"
        message = (try? container.decode(String.self, forKey: .message)) ?? ""
        metadata = try? container.decode(JSONValue.self, forKey: .metadata)
        createdAt = (try? container.decode(String.self, forKey: .createdAt)) ?? ""
        source = try? container.decode(String.self, forKey: .source)
    }
}
