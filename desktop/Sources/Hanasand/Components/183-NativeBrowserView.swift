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

struct NativeBrowserView: NSViewRepresentable {
    @ObservedObject var tab: BrowserTabState

    func makeNSView(context: Context) -> WKWebView {
        tab.webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {}
}
