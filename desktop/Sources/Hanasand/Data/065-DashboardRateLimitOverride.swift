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

struct DashboardRateLimitOverride: Decodable, Identifiable {
    let id: String
    let enabled: Bool
    let method: String
    let route: String
    let scope: String
    let windowMs: Int
    let maxRequests: Int

    var summary: String {
        "\(method) \(route) · \(scope) · \(maxRequests) / \(formatMilliseconds(Double(windowMs)))"
    }
}
