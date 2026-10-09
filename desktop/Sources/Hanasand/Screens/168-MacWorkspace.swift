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

struct MacWorkspace: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme

    var body: some View {
        FeatureWorkspace(title: "This Mac", subtitle: model.status.message) {
            HStack(spacing: 12) {
                FeatureCard(title: "Host", value: model.status.hostname, icon: "desktopcomputer")
                FeatureCard(title: "Platform", value: model.status.platform, icon: "apple.logo")
                FeatureCard(title: "Uptime", value: "\(Int(model.status.uptimeSeconds / 60)) min", icon: "clock")
            }
            HStack(spacing: 10) {
                ActionButton(title: "Refresh", icon: "arrow.clockwise") {
                    Task { await model.refreshLocalStatus() }
                }
                ActionButton(title: "Copy agent URL", icon: "link") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(model.settings.desktopAgentBaseURL, forType: .string)
                }
            }
            Text(model.status.cwd)
                .font(.system(size: 13, weight: .semibold, design: .monospaced))
                .foregroundStyle(theme.textSecondary)
                .textSelection(.enabled)
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.card)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
    }
}
