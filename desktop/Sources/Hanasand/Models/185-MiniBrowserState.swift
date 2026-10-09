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

final class MiniBrowserState: ObservableObject {
    let id = UUID()
    @Published var tab: BrowserTabState
    @Published var corner: MiniBrowserCorner = .topRight
    @Published var opacity = 0.92
    @Published var isMinified = false
    var snapToCorner: ((MiniBrowserCorner) -> Void)?
    var cloneWindow: (() -> Void)?
    var toggleFullScreen: (() -> Void)?

    init(title: String, url: String, minified: Bool) {
        tab = BrowserTabState(label: title, url: url)
        isMinified = minified
    }

    func currentURLString() -> String {
        tab.webView.url?.absoluteString ?? tab.address
    }
}
