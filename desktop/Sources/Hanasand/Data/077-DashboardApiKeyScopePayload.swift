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

struct DashboardApiKeyScopePayload: Encodable {
    struct Limits: Encodable {
        let perSecond: Int?
        let perMinute: Int?
        let perHour: Int?
        let perDay: Int?
    }

    let id: String
    let enabled: Bool
    let method: String
    let route: String
    let limits: Limits

    init(scope: DashboardApiKeyScopeRule) {
        self.id = scope.id
        self.enabled = scope.enabled
        self.method = scope.method
        self.route = scope.route
        self.limits = Limits(
            perSecond: scope.limits.perSecond,
            perMinute: scope.limits.perMinute,
            perHour: scope.limits.perHour,
            perDay: scope.limits.perDay
        )
    }

    init(id: String, enabled: Bool, method: String, route: String, limits: Limits) {
        self.id = id
        self.enabled = enabled
        self.method = method
        self.route = route
        self.limits = limits
    }
}
