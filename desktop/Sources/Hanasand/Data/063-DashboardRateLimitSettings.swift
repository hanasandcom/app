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

struct DashboardRateLimitSettings: Decodable {
    let enabled: Bool
    let defaults: [String: DashboardRateLimitRule]
    let overrides: [DashboardRateLimitOverride]
    let updatedAt: String?
    let updatedBy: String?
}
