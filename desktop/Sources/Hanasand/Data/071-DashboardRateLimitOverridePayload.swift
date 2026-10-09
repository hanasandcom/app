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

struct DashboardRateLimitOverridePayload: Encodable {
    let id: String
    let enabled: Bool
    let method: String
    let route: String
    let scope: String
    let windowMs: Int
    let maxRequests: Int

    init(override: DashboardRateLimitOverride) {
        self.id = override.id
        self.enabled = override.enabled
        self.method = override.method
        self.route = override.route
        self.scope = override.scope
        self.windowMs = override.windowMs
        self.maxRequests = override.maxRequests
    }

    init(override: DashboardRateLimitOverride, enabled: Bool) {
        self.id = override.id
        self.enabled = enabled
        self.method = override.method
        self.route = override.route
        self.scope = override.scope
        self.windowMs = override.windowMs
        self.maxRequests = override.maxRequests
    }

    init(id: String, enabled: Bool, method: String, route: String, scope: String, windowMs: Int, maxRequests: Int) {
        self.id = id
        self.enabled = enabled
        self.method = method
        self.route = route
        self.scope = scope
        self.windowMs = windowMs
        self.maxRequests = maxRequests
    }
}
