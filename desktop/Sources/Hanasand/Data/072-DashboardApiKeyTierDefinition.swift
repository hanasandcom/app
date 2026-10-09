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

struct DashboardApiKeyTierDefinition: Decodable, Identifiable {
    let id: String
    let label: String
    let description: String
    let defaultLimits: DashboardApiKeyPeriodLimits
}
