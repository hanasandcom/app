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

struct AIWorkspace: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme
    @State var showImportHint = true
    let commandFocused: FocusState<Bool>.Binding

    var body: some View {
        VStack(spacing: 0) {
            TopBar()
            aiHeader
            HStack(spacing: 0) {
                VStack(spacing: 0) {
                    if model.aiInlineBrowserVisible, let tab = model.aiBrowserTab {
                        AIChatBrowserPreview(tab: tab)
                            .frame(height: 260)
                            .transition(.move(edge: .top).combined(with: .opacity))
                    }
                    Transcript()
                    ChangedFilesDock()
                    CommandDock(commandFocused: commandFocused)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                if model.aiRightRailMode != .hidden {
                    AIRightRail(mode: model.aiRightRailMode)
                        .frame(width: model.aiRightRailMode == .compact ? 62 : 292)
                        .transition(.move(edge: .trailing).combined(with: .opacity))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .background(theme.background)
        .task {
            await model.loadAIPage()
        }
        .onAppear {
            showImportHint = true
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                withAnimation(.easeInOut(duration: 0.24)) {
                    showImportHint = false
                }
            }
        }
    }

    var aiHeader: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(model.aiMessages.isEmpty ? "New chat" : "Chat")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(theme.text)
                Text("\(model.aiClients.count) model\(model.aiClients.count == 1 ? "" : "s") connected")
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(theme.textTertiary)
                    .lineLimit(1)
            }
            Spacer()
            importContextButton
            Label(model.aiSocketConnected ? "Ready" : "Offline", systemImage: model.aiSocketConnected ? "sparkles" : "bolt.slash")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(model.aiSocketConnected ? theme.textSecondary : theme.textTertiary)
                .padding(.horizontal, 11)
                .frame(height: 30)
                .background(theme.card.opacity(0.78))
                .clipShape(Capsule())
        }
        .padding(.horizontal, 28)
        .frame(height: 68)
        .background(theme.background.opacity(0.98))
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(theme.divider.opacity(0.55))
                .frame(height: 1)
        }
    }

    var importContextButton: some View {
        Button {
            model.openNativeDashboard(path: "/s", label: "Shares")
        } label: {
            HStack(spacing: 7) {
                Image(systemName: "folder.badge.plus")
                    .font(.system(size: 12, weight: .medium))
                if showImportHint {
                    Text("Import context")
                        .font(.system(size: 12, weight: .medium))
                        .transition(.opacity.combined(with: .move(edge: .trailing)))
                }
            }
            .foregroundStyle(theme.textSecondary)
            .padding(.horizontal, showImportHint ? 11 : 8)
            .frame(height: 30)
            .background(theme.card.opacity(0.62))
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .help("Import a repo or attach a share when you need workspace context")
    }

    var chatPane: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if model.aiMessages.isEmpty {
                    EmptyAIChatCard()
                        .frame(maxWidth: .infinity, minHeight: 420, alignment: .center)
                } else {
                    ForEach(model.aiMessages) { message in
                        AIMessageBubble(message: message)
                    }
                    if let edit = model.pendingIDEEdit {
                        AIPendingEditPanel(edit: edit)
                            .frame(maxWidth: 760, alignment: .leading)
                    }
                }
            }
            .frame(maxWidth: 980, alignment: .leading)
            .padding(.horizontal, 42)
            .padding(.vertical, 30)
            .frame(maxWidth: .infinity, alignment: .center)
            .frame(minHeight: 520)
        }
        .background(theme.background)
    }

    var composer: some View {
        HStack(spacing: 10) {
            TextField("Ask Hanasand AI to build, inspect, debug, scaffold, or ship something...", text: $model.prompt, axis: .vertical)
                .textFieldStyle(.plain)
                .font(.system(size: 15, weight: .regular))
                .foregroundStyle(theme.text)
                .lineLimit(1)
                .focused(commandFocused)
                .onSubmit {
                    model.submitAIChatPrompt()
                }

            Button {
                model.submitAIChatPrompt()
            } label: {
                Image(systemName: model.isRunning ? "circle.dotted" : "arrow.up")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(theme.background)
                    .frame(width: 38, height: 38)
                    .background(theme.text.opacity(model.isRunning ? 0.58 : 0.92))
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(model.isRunning || model.prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding(.horizontal, 16)
        .frame(maxWidth: 980, minHeight: 56, alignment: .center)
        .background(theme.card.opacity(0.9))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(theme.divider.opacity(0.7), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.28), radius: 24, x: 0, y: 18)
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 42)
        .padding(.bottom, 22)
    }
}
