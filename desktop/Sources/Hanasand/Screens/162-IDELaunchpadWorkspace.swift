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

struct IDELaunchpadWorkspace: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme

    var body: some View {
        FeatureWorkspace(title: "IDE", subtitle: "Code and files.") {
            HStack(spacing: 14) {
                Label(URL(fileURLWithPath: model.status.cwd).lastPathComponent, systemImage: "folder")
                    .lineLimit(1)
                    .help(model.status.cwd)
                Label(model.status.ok ? "Agent online" : "Agent offline", systemImage: "terminal")
                    .foregroundStyle(model.status.ok ? theme.green : theme.textTertiary)
            }
            .font(.system(size: 12, weight: .medium))
            ActionGrid(actions: [
                .route("AI Workspace", "Models, repositories, conversations, and previews.", "sparkles", "/system/ai"),
                .route("Shares", "Shares and hosted files.", "folder.badge.gearshape", "/s"),
                .route("Links", "Create and inspect /g shortcut links.", "link", "/g"),
                .route("Load Tests", "Recent public load-test runs.", "speedometer", "/dashboard/tests"),
                .task("Reveal working directory", "Open the active local folder in Finder.", "folder") { model in
                    NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: model.status.cwd)])
                },
            ])
        }
    }
}
