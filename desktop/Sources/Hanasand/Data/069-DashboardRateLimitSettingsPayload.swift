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

struct DashboardRateLimitSettingsPayload: Encodable {
    let enabled: Bool
    let defaults: [String: DashboardRateLimitRulePayload]
    let overrides: [DashboardRateLimitOverridePayload]

    init(
        settings: DashboardRateLimitSettings,
        enabled: Bool,
        defaultOverrides: [String: DashboardRateLimitRulePayload] = [:],
        overridePayloads: [DashboardRateLimitOverridePayload]? = nil
    ) {
        self.enabled = enabled
        self.defaults = settings.defaults.reduce(into: [:]) { result, entry in
            result[entry.key] = defaultOverrides[entry.key] ?? DashboardRateLimitRulePayload(rule: entry.value)
        }
        self.overrides = overridePayloads ?? settings.overrides.map(DashboardRateLimitOverridePayload.init)
    }
}
