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

struct DashboardSeverityCount: Decodable {
    let critical: Int
    let high: Int
    let medium: Int
    let low: Int
    let unknown: Int
}
