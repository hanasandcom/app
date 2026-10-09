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

struct DesktopImageReviewItem: Identifiable, Hashable {
    let id = UUID()
    var url: URL
    var image: NSImage

    var title: String { url.lastPathComponent }
    var sizeLabel: String {
        "\(Int(image.size.width))x\(Int(image.size.height))"
    }
}
