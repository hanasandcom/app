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

struct DashboardRateLimitOverview: Decodable {
    let settings: DashboardRateLimitSettings
    let routes: [DashboardRateLimitRoute]
    let tierPresets: [DashboardApiKeyTierDefinition]?
}
