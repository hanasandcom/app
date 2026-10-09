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

struct AIChatBrowserPreview: View {
    @Environment(\.desktopTheme) var theme
    @ObservedObject var tab: BrowserTabState

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Label(tab.title, systemImage: "globe")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(theme.text)
                    .lineLimit(1)
                Spacer()
                BrowserIconButton(systemName: "scope") {
                    tab.refreshAgentElements()
                }
                .help("Inspect")
                BrowserIconButton(systemName: "arrow.clockwise") {
                    tab.reloadOrStop()
                }
                .help("Reload")
            }
            .padding(.horizontal, 10)
            .frame(height: 34)
            .background(theme.commandBar)
            NativeBrowserView(tab: tab)
            if !tab.agentElements.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(tab.agentElements.prefix(10)) { element in
                            Button {
                                tab.agentSelector = element.selector
                                tab.clickAgentSelector(element.selector)
                            } label: {
                                Text(element.label.isEmpty ? element.role : element.label)
                                    .font(.system(size: 10, weight: .bold))
                                    .lineLimit(1)
                                    .foregroundStyle(theme.text)
                                    .padding(.horizontal, 8)
                                    .frame(height: 24)
                                    .background(theme.card)
                                    .clipShape(Capsule())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(8)
                }
                .background(theme.commandBar)
            }
        }
        .background(theme.backgroundElevated)
    }
}
