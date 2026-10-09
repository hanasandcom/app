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

struct DashboardCertificate: Decodable, Identifiable {
    let id: String
    let publicKey: String
    let name: String
    let owner: String?
    let createdAt: String?
    let createdBy: String?

    enum CodingKeys: String, CodingKey {
        case id
        case publicKey = "public_key"
        case name
        case owner
        case createdAt = "created_at"
        case createdBy = "created_by"
    }

    var keySuffix: String {
        publicKey.split(separator: " ").last.map(String.init) ?? publicKey
    }

    var isManaged: Bool {
        publicKey.hasSuffix("Hanasand API")
    }
}
