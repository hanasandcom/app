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

struct DashboardServiceStatus: Decodable {
    let overall: String
    let generatedAt: String?
    let checks: [ServiceCheck]

    enum CodingKeys: String, CodingKey {
        case overall
        case generatedAt = "generated_at"
        case checks
    }

    var generatedLabel: String {
        formatDateText(generatedAt, fallback: "No timestamp")
    }
}
