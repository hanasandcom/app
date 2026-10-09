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

struct DashboardRateLimitRule: Decodable {
    let windowMs: Int
    let maxRequests: Int

    var summary: String {
        "\(maxRequests) / \(formatMilliseconds(Double(windowMs)))"
    }
}
