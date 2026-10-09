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

struct DashboardRateLimitRoute: Decodable, Identifiable {
    var id: String { "\(method) \(route)" }
    let method: String
    let route: String
}
