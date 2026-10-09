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

struct DesktopAgentPresence: Decodable {
    let deviceId: String?
    let deviceName: String?
    let endpoints: [String]?
    let updatedAt: String?
    let expiresAt: String?
}
