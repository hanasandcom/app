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

struct CommandDock: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme
    let commandFocused: FocusState<Bool>.Binding
    @State var draggingQueuedPromptID: UUID?
    @State var editingQueuedPromptID: UUID?
    @State var editingQueuedPromptText = ""

    var body: some View {
        VStack(spacing: 0) {
            if showHeader {
                HStack(spacing: 0) {
                    Text(headerTitle)
                        .foregroundStyle(theme.textSecondary)
                    Spacer()
                    Button("Status") {
                        model.runStatusCommand()
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(theme.text)
                }
                .font(.system(size: 13, weight: .semibold))
                .padding(.horizontal, 18)
                .frame(width: 760, height: 34)
                .background(theme.commandBar)
                .clipShape(UnevenRoundedRectangle(topLeadingRadius: 22, bottomLeadingRadius: 0, bottomTrailingRadius: 0, topTrailingRadius: 22))
            }

            if !model.promptQueue.isEmpty {
                scheduledTray
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }

            VStack(spacing: 12) {
                TextField(promptPlaceholder, text: $model.prompt, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(theme.text)
                    .lineLimit(2...5)
                    .focused(commandFocused)
                    .onSubmit {
                        model.submitAIChatPrompt()
                    }

                HStack(spacing: 10) {
                    CommandDockQuickButton(title: model.isRunning ? "Send next" : "Send now", icon: model.isRunning ? "arrow.turn.down.right" : "paperplane") {
                        model.submitAIChatPrompt()
                    }
                    CommandDockQuickButton(title: "Dashboard", icon: "gauge.with.dots.needle") {
                        model.recordCommand("open_section_dashboard")
                    }
                    CommandDockQuickButton(title: "AI drill", icon: "graduationcap") {
                        model.submitAppParityTrainingPrompt()
                    }
                    Spacer()
                    ProgressView()
                        .scaleEffect(0.55)
                        .opacity(model.isRunning ? 1 : 0.35)
                    Text(model.status.ok ? "Agent online" : "Agent offline")
                        .foregroundStyle(.secondary)
                    CommandDockQuickButton(title: "Status", icon: "waveform.path.ecg") {
                        model.runStatusCommand()
                    }
                    Button(action: model.submitAIChatPrompt) {
                        Image(systemName: model.isRunning ? "arrow.turn.down.right" : "paperplane.fill")
                            .foregroundStyle(theme.commandPanel)
                            .frame(width: 32, height: 32)
                            .background(canSubmit ? theme.text : theme.textTertiary.opacity(0.45))
                            .clipShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .disabled(!canSubmit)
                    .help(model.isRunning ? "Send this after the current step" : "Send now")
                }
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(theme.textSecondary)
            }
            .padding(.horizontal, 18)
            .padding(.top, 26)
            .padding(.bottom, 22)
            .frame(width: 760)
            .background(theme.commandPanel)
            .clipShape(UnevenRoundedRectangle(
                topLeadingRadius: showHeader || !model.promptQueue.isEmpty ? 0 : 22,
                bottomLeadingRadius: 22,
                bottomTrailingRadius: 22,
                topTrailingRadius: showHeader || !model.promptQueue.isEmpty ? 0 : 22,
                style: .continuous
            ))
            .animation(.easeOut(duration: 0.16), value: model.promptQueue.count)

            Menu {
                Button {
                    NSWorkspace.shared.open(URL(fileURLWithPath: model.status.cwd, isDirectory: true))
                } label: {
                    Label("Reveal working folder", systemImage: "folder")
                }
                Button {
                    model.openNativeDashboard(path: "/system/rates", label: "Rate limits")
                } label: {
                    Label("Open quota controls", systemImage: "gauge.with.needle")
                }
                Divider()
                if let quota = model.aiRateLimit {
                    Text("Hourly quota: \(model.quotaUsageLabel(quota.hourlyUsageFraction))")
                    Text(model.quotaResetLabel(quota.hourlyResetAt, now: model.aiRateLimitClock))
                    Text("Daily quota: \(model.quotaUsageLabel(quota.dailyUsageFraction))")
                    Text(model.quotaResetLabel(quota.dailyResetAt, now: model.aiRateLimitClock))
                } else {
                    Text("Hourly quota: Ready")
                    Text("Daily quota: Ready")
                }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "desktopcomputer")
                    Text(model.quotaFooterTitle(now: model.aiRateLimitClock))
                    Text(model.status.cwd)
                        .lineLimit(1)
                    Image(systemName: "chevron.down")
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(model.isAIRateLimited ? theme.textTertiary : theme.textSecondary)
            .frame(width: 760, alignment: .leading)
            .padding(.top, 14)
            .help("Working folder and quota")
        }
        .padding(.bottom, 20)
    }

    var scheduledTray: some View {
        VStack(spacing: 8) {
            scheduledStack
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(width: 760)
        .background(theme.commandPanel.opacity(0.78))
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(theme.divider.opacity(0.55))
                .frame(height: 1)
        }
        .clipShape(UnevenRoundedRectangle(
            topLeadingRadius: showHeader ? 0 : 22,
            bottomLeadingRadius: 0,
            bottomTrailingRadius: 0,
            topTrailingRadius: showHeader ? 0 : 22,
            style: .continuous
        ))
    }

    var scheduledStack: some View {
        VStack(spacing: 8) {
            ForEach(model.promptQueue) { item in
                ScheduledPromptRow(
                    item: item,
                    isEditing: editingQueuedPromptID == item.id,
                    editingText: $editingQueuedPromptText,
                    draggingQueuedPromptID: $draggingQueuedPromptID,
                    onEdit: {
                        editingQueuedPromptID = item.id
                        editingQueuedPromptText = item.text
                    },
                    onSave: {
                        model.updateQueuedPrompt(item, text: editingQueuedPromptText)
                        editingQueuedPromptID = nil
                        editingQueuedPromptText = ""
                    },
                    onCancelEdit: {
                        editingQueuedPromptID = nil
                        editingQueuedPromptText = ""
                    },
                    onPromote: { model.promoteQueuedPromptAfterNextTool(item) },
                    onDelete: { model.removeQueuedPrompt(item) }
                )
                .onDrop(
                    of: [.text],
                    delegate: QueuedPromptDropDelegate(
                        target: item,
                        model: model,
                        draggingID: $draggingQueuedPromptID
                    )
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    var showHeader: Bool {
        !model.aiMessages.isEmpty || !model.promptQueue.isEmpty
    }

    var headerTitle: String {
        let messageCount = model.aiMessages.count
        let scheduledCount = model.promptQueue.count
        if messageCount > 0 && scheduledCount > 0 {
            return "\(messageCount) message\(messageCount == 1 ? "" : "s") · \(scheduledCount) scheduled"
        }
        if scheduledCount > 0 {
            return "\(scheduledCount) scheduled"
        }
        return "\(messageCount) message\(messageCount == 1 ? "" : "s")"
    }

    var promptPlaceholder: String {
        model.isRunning ? "Schedule a follow-up while Hanasand AI keeps working..." : "Ask Hanasand AI to build, inspect, debug, scaffold, or ship something..."
    }

    var canSubmit: Bool {
        !model.prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

struct ScheduledPromptRow: View {
    @Environment(\.desktopTheme) var theme
    let item: QueuedPrompt
    let isEditing: Bool
    @Binding var editingText: String
    @Binding var draggingQueuedPromptID: UUID?
    let onEdit: () -> Void
    let onSave: () -> Void
    let onCancelEdit: () -> Void
    let onPromote: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "arrow.turn.down.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(theme.textTertiary)
                .frame(width: 20, height: 24)
                .help("Scheduled follow-up")

            if isEditing {
                TextField("Edit scheduled message", text: $editingText, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(theme.text)
                    .lineLimit(1...4)
            } else {
                Text(item.text)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(theme.textSecondary)
                    .lineLimit(3)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            }

            HStack(spacing: 8) {
                if isEditing {
                    rowButton("checkmark", help: "Save edit", action: onSave)
                    rowButton("xmark", help: "Cancel edit", action: onCancelEdit)
                } else {
                    rowButton("arrow.turn.down.right", help: "Send immediately after the next tool step", action: onPromote)
                    rowButton("pencil", help: "Edit scheduled message", action: onEdit)
                    rowButton("trash", help: "Cancel scheduled message", action: onDelete)
                    Image(systemName: "ellipsis")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(theme.textTertiary)
                        .frame(width: 20, height: 24)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(draggingQueuedPromptID == item.id ? theme.accentSoft : theme.card.opacity(0.82))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(theme.divider.opacity(0.72), lineWidth: 1)
        }
        .contentShape(Rectangle())
        .onDrag {
            draggingQueuedPromptID = item.id
            return NSItemProvider(object: item.id.uuidString as NSString)
        }
    }

    func rowButton(_ icon: String, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(theme.textSecondary)
                .frame(width: 20, height: 24)
        }
        .buttonStyle(.plain)
        .help(help)
    }
}
