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

struct DashboardApiKeyScopeRule: Decodable, Identifiable {
    let id: String
    let enabled: Bool
    let method: String
    let route: String
    let limits: DashboardApiKeyPeriodLimits
}
