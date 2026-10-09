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

struct DesktopShell: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.colorScheme) var colorScheme
    @AppStorage("hanasand.desktop.sidebarWidth") var sidebarWidth = 260.0
    @FocusState var commandFocused: Bool

    var body: some View {
        let theme = DesktopTheme(preference: model.appearancePreference, systemScheme: colorScheme)

        Group {
            if model.hasHanasandAuth {
                HStack(spacing: 0) {
                    if model.sidebarVisible {
                        Sidebar()
                            .frame(width: sidebarWidth)
                            .transition(.move(edge: .leading).combined(with: .opacity))
                        SidebarResizeHandle(width: $sidebarWidth)
                    }
                    MainWorkspace(commandFocused: $commandFocused)
                }
            } else {
                HanasandLoginGate()
            }
        }
        .background(theme.background)
        .foregroundStyle(theme.text)
        .environment(\.desktopTheme, theme)
        .preferredColorScheme(model.appearancePreference.preferredColorScheme)
        .background(WindowFrameRestorer(storageKey: "hanasand.desktop.windowFrame"))
        .toolbar {
            ToolbarItemGroup {
                Button {
                    withAnimation(.spring(response: 0.24, dampingFraction: 0.9)) {
                        model.sidebarVisible.toggle()
                    }
                } label: {
                    Image(systemName: "sidebar.left")
                }
                .help("Toggle Sidebar")

                Button {
                    model.selectedSection = .control
                    model.focusCommand.toggle()
                } label: {
                    Image(systemName: "command")
                }
                .help("Open Control")

                Button {
                    model.copyCurrentContext()
                } label: {
                    Image(systemName: "doc.on.doc")
                }
                .help("Copy Current Context")
            }
            ToolbarItemGroup(placement: .primaryAction) {
                Button {
                    Task { await model.refreshLocalStatus() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .help("Refresh This Mac")

                Button {
                    Task { await model.checkServerLogs() }
                } label: {
                    Image(systemName: "doc.text.magnifyingglass")
                }
                .help("Server Logs")
            }
        }
        .onChange(of: model.focusCommand) {
            commandFocused = true
        }
    }
}
