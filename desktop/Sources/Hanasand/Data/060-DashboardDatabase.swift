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

struct DashboardDatabase: Decodable, Identifiable {
    var id: String { name }
    let name: String
    let sizeBytes: Int
    let tableCount: Int
    let activeConnections: Int?
}
