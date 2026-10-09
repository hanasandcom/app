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

final class BrowserTabState: NSObject, ObservableObject, WKNavigationDelegate, Identifiable {
    let id = UUID(); @Published var label: String; @Published var address = ""; @Published var title: String

    @Published var canGoBack = false; @Published var canGoForward = false; @Published var isLoading = false; @Published var progress = 0.0

    @Published var statusText = "Ready"; @Published var agentSelector = ""; @Published var agentText = ""; @Published var agentX = "120"

    @Published var agentY = "120"; @Published var agentStatus = "Agent controls ready"; @Published var agentElements: [BrowserAgentElement] = []; let webView: WKWebView
    var progressObservation: NSKeyValueObservation?
    var urlObservation: NSKeyValueObservation?

    init(label: String, url: String) {
        self.label = label
        self.title = label

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.allowsBackForwardNavigationGestures = true

        super.init()

        webView.navigationDelegate = self
        progressObservation = webView.observe(\.estimatedProgress, options: [.initial, .new]) { [weak self] view, _ in
            Task { @MainActor in
                self?.progress = view.estimatedProgress
            }
        }
        urlObservation = webView.observe(\.url, options: [.new]) { [weak self] view, _ in
            Task { @MainActor in
                if let url = view.url {
                    self?.address = url.absoluteString
                }
            }
        }
        load(url)
    }
}
