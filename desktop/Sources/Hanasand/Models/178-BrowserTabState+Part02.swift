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

extension BrowserTabState {

    func pressAgentKey(_ key: String) {
        let keyValue = javaScriptString(key)
        let script = """
        (() => {
          const el = document.activeElement || document.body;
          for (const type of ['keydown','keyup']) {
            el.dispatchEvent(new KeyboardEvent(type, { key: \(keyValue), bubbles: true, cancelable: true }));
          }
          if (\(keyValue) === 'Enter' && el.form) el.form.requestSubmit();
          return 'Pressed ' + \(keyValue);
        })();
        """
        evaluateAgentScript("Pressing key", script: script)
    }

    func scrollAgentPage(deltaY: Int) {
        let script = "window.scrollBy({ top: \(deltaY), behavior: 'smooth' }); 'Scrolled \(deltaY > 0 ? "down" : "up")';"
        evaluateAgentScript("Scrolling", script: script)
    }

    func clickAgentPoint() {
        let x = Int(agentX) ?? 0
        let y = Int(agentY) ?? 0
        let script = """
        (() => {
          const el = document.elementFromPoint(\(x), \(y));
          if (!el) return 'No element at \(x),\(y)';
          for (const type of ['pointermove','mousemove','pointerdown','mousedown','pointerup','mouseup','click']) {
            el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: \(x), clientY: \(y) }));
          }
          if (typeof el.click === 'function') el.click();
          return 'Clicked ' + el.tagName.toLowerCase() + ' at \(x),\(y)';
        })();
        """
        evaluateAgentScript("Clicking point", script: script)
    }

    func evaluateAgentScript(_ pendingStatus: String, script: String, completion: ((Any?) -> Void)? = nil) {
        agentStatus = pendingStatus
        webView.evaluateJavaScript(script) { [weak self] result, error in
            Task { @MainActor in
                if let error {
                    self?.agentStatus = error.localizedDescription
                    completion?(nil)
                    return
                }
                if let message = result as? String, !message.isEmpty {
                    self?.agentStatus = message
                } else {
                    self?.agentStatus = "Action complete"
                }
                completion?(result)
            }
        }
    }

    func javaScriptString(_ value: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: value),
              let encoded = String(data: data, encoding: .utf8) else {
            return "''"
        }
        return encoded
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        updateNavigationState(webView)
        isLoading = true
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard navigationAction.targetFrame?.isMainFrame != false else {
            decisionHandler(.allow)
            return
        }
        guard let url = navigationAction.request.url,
              let scheme = url.scheme?.lowercased() else {
            decisionHandler(.cancel)
            return
        }
        if ["http", "https"].contains(scheme), url.host != nil {
            decisionHandler(.allow)
            return
        }
        if let externalURL = BrowserTargetResolver.externalURL(from: url.absoluteString) {
            NSWorkspace.shared.open(externalURL)
        }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        updateNavigationState(webView)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        updateNavigationState(webView)
        isLoading = false
        progress = 1
        title = webView.title?.isEmpty == false ? webView.title! : label
        if title != label && webView.url?.host?.contains("hanasand") == true {
            label = title
        }
        statusText = webView.url?.host ?? "Ready"
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        updateNavigationState(webView)
        isLoading = false
        statusText = error.localizedDescription
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        updateNavigationState(webView)
        isLoading = false
        statusText = error.localizedDescription
    }

    func updateNavigationState(_ webView: WKWebView) {
        canGoBack = webView.canGoBack
        canGoForward = webView.canGoForward
        if let url = webView.url {
            address = url.absoluteString
        }
    }

    func normalizedURL(from value: String) -> URL? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        if let url = URL(string: trimmed), let scheme = url.scheme?.lowercased() {
            guard ["http", "https"].contains(scheme), url.host != nil else { return nil }
            return url
        }

        if trimmed.contains("."),
           let url = URL(string: "https://\(trimmed)") {
            return url
        }

        var components = URLComponents(string: "https://duckduckgo.com/")
        components?.queryItems = [URLQueryItem(name: "q", value: trimmed)]
        return components?.url
    }
}
