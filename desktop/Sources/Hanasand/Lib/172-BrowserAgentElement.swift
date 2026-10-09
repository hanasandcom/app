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

struct BrowserAgentElement: Identifiable, Decodable {
    let id: Int
    let role: String
    let label: String
    let selector: String
    let x: Double
    let y: Double
}
