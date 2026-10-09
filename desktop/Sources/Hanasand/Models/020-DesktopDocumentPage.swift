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

struct DesktopDocumentPage: Identifiable, Hashable {
    let id = UUID()
    var title: String
    var image: NSImage
    var sourceURL: URL?
}
