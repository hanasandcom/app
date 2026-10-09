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

struct AIRightRail: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme
    let mode: AIRightRailMode

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                AIIconButton(title: mode == .compact ? "Expand tools" : "Collapse to icons", icon: mode == .compact ? "sidebar.right" : "sidebar.right") {
                    withAnimation(.easeInOut(duration: 0.18)) {
                        model.toggleAIRightRailWidth()
                    }
                }
                if mode == .expanded {
                    Text("Tools")
                        .font(.system(size: 12, weight: .black))
                        .foregroundStyle(theme.textTertiary)
                    Spacer()
                }
            }
            .frame(maxWidth: .infinity, alignment: mode == .compact ? .center : .leading)

            if mode == .compact {
                compactActions
            } else {
                expandedActions
                runtimePanel
                tracePanel
            }

            Spacer(minLength: 0)
        }
        .padding(mode == .compact ? 8 : 16)
        .frame(maxHeight: .infinity)
        .background(theme.backgroundElevated.opacity(0.96))
        .overlay(alignment: .leading) {
            Rectangle()
                .fill(theme.divider)
                .frame(width: 1)
        }
    }

    var compactActions: some View {
        VStack(spacing: 10) {
            AIIconButton(title: "Reload", icon: "arrow.clockwise") {
                Task { await model.loadAIPage() }
            }
            AIIconButton(title: model.aiInlineBrowserVisible ? "Hide browser" : "Browser", icon: model.aiInlineBrowserVisible ? "rectangle.slash" : "globe") {
                toggleBrowser()
            }
            AIIconButton(title: "Pop out", icon: "rectangle.inset.filled.and.person.filled") {
                model.popOutBrowser(source: "AI toolbar")
            }
            AIIconButton(title: model.isRunning ? "Training" : "App parity", icon: "graduationcap") {
                model.submitAppParityTrainingPrompt()
            }
            .disabled(model.isRunning)
        }
        .frame(maxWidth: .infinity)
    }

    var expandedActions: some View {
        VStack(spacing: 10) {
            AIRailButton(title: "Reload", subtitle: "Refresh runtime", icon: "arrow.clockwise") {
                Task { await model.loadAIPage() }
            }
            AIRailButton(title: model.aiInlineBrowserVisible ? "Hide browser" : "Browser", subtitle: model.aiInlineBrowserVisible ? "Inline browser" : "Open current page", icon: model.aiInlineBrowserVisible ? "rectangle.slash" : "globe") {
                toggleBrowser()
            }
            AIRailButton(title: "Pop out", subtitle: "Floating browser", icon: "rectangle.inset.filled.and.person.filled") {
                model.popOutBrowser(source: "AI toolbar")
            }
            AIRailButton(title: model.isRunning ? "Training" : "App parity", subtitle: "Run drill", icon: "graduationcap") {
                model.submitAppParityTrainingPrompt()
            }
            .disabled(model.isRunning)
        }
    }

    var runtimePanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Runtime")
                .font(.system(size: 10, weight: .black))
                .foregroundStyle(theme.textTertiary)
                .textCase(.uppercase)
            HStack {
                Text("\(model.aiClients.count) model\(model.aiClients.count == 1 ? "" : "s")")
                Spacer()
                Text(model.aiLastDuration)
            }
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(theme.textSecondary)
            ForEach(model.aiClients.sortedForRuntime.prefix(3)) { client in
                AIClientRow(client: client)
            }
        }
        .padding(12)
        .background(theme.card.opacity(0.62))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    var tracePanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Trace")
                .font(.system(size: 10, weight: .black))
                .foregroundStyle(theme.textTertiary)
                .textCase(.uppercase)
            ForEach(model.aiTrace.suffix(3)) { event in
                AITraceRow(event: event)
            }
        }
        .padding(12)
        .background(theme.card.opacity(0.62))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    func toggleBrowser() {
        if model.aiInlineBrowserVisible {
            model.aiInlineBrowserVisible = false
        } else {
            model.openAIInlineBrowser(url: model.browserActiveAddress, title: model.browserActiveTitle, source: "AI toolbar")
        }
    }
}
