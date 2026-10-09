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

struct QueuedPrompt: Identifiable {
    let id = UUID()
    var text: String
    let createdAt = Date()
}
