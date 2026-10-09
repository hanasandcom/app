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

extension BrowserWorkspace {

    func browserStatusBar(_ browser: BrowserTabState) -> some View {
        HStack(spacing: 8) {
            Image(systemName: browser.webView.url?.scheme == "https" ? "lock.fill" : "globe")
                .font(.system(size: 11, weight: .bold))
            Text(browser.title)
                .lineLimit(1)
            Spacer()
            Text(browser.statusText)
                .lineLimit(1)
        }
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(theme.textTertiary)
        .padding(.horizontal, 18)
        .frame(height: 28)
        .background(theme.commandBar.opacity(0.72))
    }
}
