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

extension IDEWorkspace {

    var previewPane: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Label("Share preview", systemImage: "safari")
                    .font(.system(size: 12, weight: .bold))
                Spacer()
                BrowserAgentButton(title: "Back", icon: "chevron.left") {
                    model.previewTab?.goBack()
                }
                BrowserAgentButton(title: "Forward", icon: "chevron.right") {
                    model.previewTab?.goForward()
                }
                BrowserAgentButton(title: "Copy URL", icon: "doc.on.doc") {
                    if let url = model.previewTab?.webView.url?.absoluteString {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(url, forType: .string)
                    }
                }
                BrowserAgentButton(title: "Open", icon: "arrow.up.forward.square") {
                    if let url = model.previewTab?.webView.url {
                        NSWorkspace.shared.open(url)
                    }
                }
                BrowserAgentButton(title: "Reload", icon: "arrow.clockwise") {
                    model.previewTab?.reloadOrStop()
                }
                BrowserAgentButton(title: "Inspect", icon: "scope") {
                    model.previewTab?.refreshAgentElements()
                }
                BrowserAgentButton(title: "Click", icon: "cursorarrow.click") {
                    model.previewTab?.clickAgentSelector()
                }
            }
            .foregroundStyle(theme.text)
            .padding(.horizontal, 12)
            .frame(height: 36)
            .background(theme.backgroundElevated)

            if let tab = model.previewTab {
                VStack(spacing: 0) {
                    NativeBrowserView(tab: tab)
                    if !tab.agentElements.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(tab.agentElements.prefix(12)) { element in
                                    HStack(spacing: 4) {
                                        Button {
                                            tab.agentSelector = element.selector
                                            tab.clickAgentSelector(element.selector)
                                        } label: {
                                            Text(element.label.isEmpty ? element.role : element.label)
                                                .font(.system(size: 10, weight: .bold))
                                                .lineLimit(1)
                                                .foregroundStyle(theme.text)
                                                .padding(.horizontal, 9)
                                                .frame(height: 26)
                                                .background(theme.card)
                                                .clipShape(Capsule())
                                        }
                                        .buttonStyle(.plain)
                                        Button {
                                            NSPasteboard.general.clearContents()
                                            NSPasteboard.general.setString(element.selector, forType: .string)
                                            tab.agentSelector = element.selector
                                            tab.agentStatus = "Copied selector \(element.selector)"
                                        } label: {
                                            Image(systemName: "doc.on.doc")
                                                .font(.system(size: 9, weight: .bold))
                                                .foregroundStyle(theme.textTertiary)
                                                .frame(width: 22, height: 26)
                                                .background(theme.card)
                                                .clipShape(Capsule())
                                        }
                                        .buttonStyle(.plain)
                                    }
                                    .help(element.selector)
                                }
                            }
                            .padding(.horizontal, 8)
                            .padding(.vertical, 6)
                        }
                        .background(theme.commandBar)
                    }
                }
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(theme.background)
    }
}
