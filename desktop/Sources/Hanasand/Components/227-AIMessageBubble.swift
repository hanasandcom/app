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

struct AIMessageBubble: View {
    @Environment(\.desktopTheme) var theme
    @EnvironmentObject var model: DesktopAgentModel
    let message: AIChatMessage
    @State var isHovered = false
    @State var didCopy = false

    var body: some View {
        if message.isReconnectNotice {
            AIReconnectNoticeView(message: message)
        } else {
            standardMessage
        }
    }

    var standardMessage: some View {
        VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 6) {
            HStack {
                if message.role == .user {
                    Spacer(minLength: 120)
                }
                VStack(alignment: .leading, spacing: 8) {
                    if message.role == .assistant && message.isPending {
                        if !message.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            AIMessageContentView(
                                content: message.content,
                                isError: message.isError
                            )
                        }
                        AIWorkingProgressView(message: message)
                    } else {
                        AIMessageContentView(
                            content: message.content,
                            isError: message.isError
                        )
                    }

                    if message.role == .assistant {
                        let referencedFiles = AIFileReferenceParser.references(in: message.content, changedFiles: model.changedFileSummary)
                        if !referencedFiles.isEmpty {
                            AIChangedFilesInlinePanel(files: Array(referencedFiles.prefix(6)))
                        }
                    }
                }
                .padding(message.role == .user ? 14 : 0)
                .frame(maxWidth: message.role == .user ? 720 : 900, alignment: .leading)
                .background(message.role == .user ? theme.cardRaised : Color.clear)
                .overlay {
                    if message.role == .user {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(theme.divider, lineWidth: 1)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: message.role == .user ? 14 : 0, style: .continuous))
                if message.role == .assistant {
                    Spacer(minLength: 120)
                }
            }
            if isHovered && !message.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                copyButton
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .onHover { hovering in
            withAnimation(.easeInOut(duration: 0.12)) {
                isHovered = hovering
            }
        }
    }

    var copyButton: some View {
        Button {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(message.content, forType: .string)
            didCopy = true
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                didCopy = false
            }
        } label: {
            Label(didCopy ? "Copied" : "Copy", systemImage: didCopy ? "checkmark" : "doc.on.doc")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(theme.textTertiary)
                .padding(.horizontal, 9)
                .frame(height: 24)
                .background(theme.card.opacity(0.62))
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}

struct AIWorkingProgressView: View {
    @Environment(\.desktopTheme) var theme
    @EnvironmentObject var model: DesktopAgentModel
    let message: AIChatMessage

    var body: some View {
        TimelineView(.periodic(from: message.createdAt, by: 1)) { timeline in
            VStack(alignment: .leading, spacing: 14) {
                Text("\(pendingLabel) for \(elapsedText(at: timeline.date))")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(theme.textTertiary)

                Rectangle()
                    .fill(theme.divider)
                    .frame(height: 1)

                if shouldShowLeadIn {
                    Text(message.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? leadInText : message.content)
                        .font(.system(size: 14, weight: .regular))
                        .foregroundStyle(theme.text)
                        .lineSpacing(3)
                        .textSelection(.enabled)
                }

                VStack(alignment: .leading, spacing: 12) {
                    let events = Array(visibleEvents.suffix(8))
                    if !events.isEmpty {
                        ForEach(events) { event in
                            AIWorkingStepRow(event: event)
                        }
                    }
                }
            }
            .frame(maxWidth: 900, alignment: .leading)
        }
    }

    var leadInText: String {
        if let firstTool = visibleEvents.first(where: { $0.kind == .tool }) {
            return "I’m on it. I’m working through \(firstTool.humanReadableTarget) now, and I’ll keep the concrete files, commands, and results visible here."
        }
        return ""
    }

    var pendingLabel: String {
        visibleEvents.isEmpty ? "Thinking" : "Working"
    }

    var shouldShowLeadIn: Bool {
        !message.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !visibleEvents.isEmpty
    }

    var visibleEvents: [AITraceEvent] {
        model.aiTrace.filter { event in
            if event.kind == .system || event.kind == .thought { return false }
            if event.kind == .error && event.title.lowercased().contains("socket") { return false }
            let clean = event.detail.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            return !clean.isEmpty || event.kind == .file || event.kind == .tool
        }
    }

    func elapsedText(at date: Date) -> String {
        let seconds = max(1, Int(date.timeIntervalSince(message.createdAt).rounded()))
        if seconds < 60 { return "\(seconds)s" }
        return "\(seconds / 60)m \(seconds % 60)s"
    }
}

struct AIWorkingStepRow: View {
    @Environment(\.desktopTheme) var theme
    let event: AITraceEvent?

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(summary)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(summaryColor)
                .lineLimit(3)
                .textSelection(.enabled)

            if let command {
                Text(command)
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    .foregroundStyle(theme.text)
                    .lineLimit(3)
                    .textSelection(.enabled)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .background(theme.cardRaised.opacity(0.82))
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            }

            if let detail {
                Text(detail)
                    .font(.system(size: 12, weight: .regular))
                    .foregroundStyle(theme.textTertiary)
                    .lineLimit(4)
                    .textSelection(.enabled)
            }
        }
    }

    var summary: String {
        guard let event else {
            return "Preparing the run and waiting for the first model event."
        }
        switch event.kind {
        case .system:
            return event.title
        case .thought:
            return event.title
        case .tool:
            if let fileSummary {
                if event.detail.statusToken == "completed" {
                    return "Finished \(fileSummary)"
                }
                return "Editing \(fileSummary)"
            }
            if event.detail.lowercased().contains("error") {
                return "Retrying \(event.humanReadableTarget) with a safer path"
            }
            if event.detail.statusToken == "completed" {
                return "Finished \(event.humanReadableTarget)"
            }
            if event.detail.statusToken == "running" || event.detail.isEmpty {
                return "Working on \(event.humanReadableTarget)"
            }
            return event.humanReadableTarget
        case .file:
            return "File result: \(event.title)"
        case .error:
            return "Error: \(event.title)"
        }
    }

    var command: String? {
        guard let event else { return nil }
        if event.detail.statusToken == "error" || event.detail.lowercased().contains("error") {
            return nil
        }
        if event.title.hasPrefix("Ran command ") {
            return String(event.title.dropFirst("Ran command ".count))
        }
        if event.title.hasPrefix("Started process ") {
            return String(event.title.dropFirst("Started process ".count))
        }
        if let command = event.detail.value(after: "Command:") {
            return command
        }
        let lines = event.detail
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map(String.init)
        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.hasPrefix("Command:") {
                return String(trimmed.dropFirst("Command:".count)).trimmingCharacters(in: .whitespacesAndNewlines)
            }
            if trimmed.hasPrefix("$ ") {
                return String(trimmed.dropFirst(2))
            }
        }
        return nil
    }

    var fileSummary: String? {
        guard let event else { return nil }
        if let writing = event.detail.value(after: "Writing ") {
            return writing
        }
        if let reading = event.detail.value(after: "Reading ") {
            return reading
        }
        if let patching = event.detail.value(after: "Patching ") {
            return patching
        }
        if let creating = event.detail.value(after: "Creating files in ") {
            return creating
        }
        if let wrote = event.detail.value(after: "Wrote ") {
            return wrote
        }
        return nil
    }

    var detail: String? {
        guard let event else { return nil }
        let clean = event.detail.cleanedTraceDetail
        guard !clean.isEmpty else { return nil }
        let lowered = clean.lowercased()
        if lowered == "running" || lowered == "completed" || event.detail.statusToken == "error" || lowered.contains("enoent") || lowered.contains("posix_spawn") {
            return nil
        }
        if clean.hasPrefix("Command:") || clean.hasPrefix("$ ") || clean.hasPrefix("Reading ") || clean.hasPrefix("Writing ") || clean.hasPrefix("Patching ") || clean.hasPrefix("Wrote ") {
            return nil
        }
        return clean
    }

    var summaryColor: Color {
        guard let event else { return theme.textTertiary }
        return event.kind == .error || event.detail.statusToken == "error" ? theme.danger : theme.textTertiary
    }
}

extension String {
    var lowercasedFirst: String {
        guard let first else { return self }
        return String(first).lowercased() + String(dropFirst())
    }

    var cleanedTraceDetail: String {
        var clean = trimmingCharacters(in: .whitespacesAndNewlines)
        let prefixes = ["running · ", "completed · ", "error · "]
        for prefix in prefixes where clean.lowercased().hasPrefix(prefix) {
            clean = String(clean.dropFirst(prefix.count)).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return clean
    }

    var statusToken: String? {
        let clean = trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if clean == "running" || clean.hasPrefix("running ·") { return "running" }
        if clean == "completed" || clean.hasPrefix("completed ·") { return "completed" }
        if clean == "error" || clean.hasPrefix("error ·") { return "error" }
        return nil
    }

    func value(after marker: String) -> String? {
        guard let range = range(of: marker) else { return nil }
        let after = self[range.upperBound...]
        let stops = ["\n", " · ", ". Command:", ". Exit code", ". Alive:"]
            .compactMap { after.range(of: $0)?.lowerBound }
        let stop = stops.min() ?? after.endIndex
        let value = after[..<stop].trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }
}

extension AITraceEvent {
    var humanReadableTarget: String {
        let title = title
            .replacingOccurrences(of: "Scaffolded Next.js app ", with: "")
            .replacingOccurrences(of: "Generated marketing site in ", with: "")
            .replacingOccurrences(of: "Patched file ", with: "")
            .replacingOccurrences(of: "Updated file ", with: "")
            .replacingOccurrences(of: "Read file ", with: "")
        return title.isEmpty ? "this step" : title
    }
}
