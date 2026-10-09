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

struct DashboardBackupFile: Decodable, Identifiable {
    var id: String { "\(service)-\(file)-\(location ?? "unknown")" }
    let service: String
    let file: String
    let mtime: String?
    let size: String?
    let location: String?
}
