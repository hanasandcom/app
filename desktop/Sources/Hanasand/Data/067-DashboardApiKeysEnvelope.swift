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

struct DashboardApiKeysEnvelope: Decodable {
    let apiKeys: [DashboardApiKeySummary]
}
