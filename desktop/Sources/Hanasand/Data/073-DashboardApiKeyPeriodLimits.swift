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

struct DashboardApiKeyPeriodLimits: Decodable {
    let perSecond: Int?
    let perMinute: Int?
    let perHour: Int?
    let perDay: Int?

    var summary: String {
        [
            perSecond.map { "\($0)/s" },
            perMinute.map { "\($0)/m" },
            perHour.map { "\($0)/h" },
            perDay.map { "\($0)/d" },
        ].compactMap { $0 }.joined(separator: " · ")
    }
}
