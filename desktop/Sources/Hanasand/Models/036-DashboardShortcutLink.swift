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

struct DashboardShortcutLink: Decodable, Identifiable {
    let id: String
    let path: String
    let visits: Int?
    let timestamp: String?

    var timestampLabel: String {
        formatDateText(timestamp, fallback: "No timestamp")
    }
}
