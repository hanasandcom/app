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

struct DashboardRateLimitRulePayload: Encodable {
    let windowMs: Int
    let maxRequests: Int

    init(rule: DashboardRateLimitRule) {
        self.windowMs = rule.windowMs
        self.maxRequests = rule.maxRequests
    }

    init(windowMs: Int, maxRequests: Int) {
        self.windowMs = windowMs
        self.maxRequests = maxRequests
    }
}
