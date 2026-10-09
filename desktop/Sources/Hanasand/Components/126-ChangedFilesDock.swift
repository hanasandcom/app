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

struct ChangedFilesDock: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme

    var body: some View {
        let visibleFiles = displayFiles
        Group {
            if !visibleFiles.isEmpty {
                VStack(spacing: 0) {
                    HStack(spacing: 8) {
                        Text("Changes")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(theme.textSecondary)
                    Text("+\(visibleFiles.filter { $0.status.contains("A") || $0.status.contains("?") || $0.status == "AI" }.count)")
                        .foregroundStyle(theme.green)
                    Text("-\(visibleFiles.filter { $0.status.contains("D") }.count)")
                        .foregroundStyle(theme.danger)
                        Spacer()
                        Button {
                            model.refreshChangedFilesSummary()
                        } label: {
                            Image(systemName: "arrow.clockwise")
                        }
                        .buttonStyle(.plain)
                        .help("Refresh changed files")
                        Button {
                            model.reviewChangedFiles()
                        } label: {
                            HStack(spacing: 6) {
                                Text("Review changes")
                                Image(systemName: "arrow.up.forward")
                            }
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(theme.text)
                    }
                    .font(.system(size: 12, weight: .medium))
                    .padding(.horizontal, 18)
                    .frame(width: 760, height: 34)
                    .background(theme.commandBar)
                    .clipShape(UnevenRoundedRectangle(
                        topLeadingRadius: 18,
                        bottomLeadingRadius: 0,
                        bottomTrailingRadius: 0,
                        topTrailingRadius: 18,
                        style: .continuous
                    ))

                    VStack(spacing: 0) {
                        ForEach(visibleFiles) { file in
                            HStack(spacing: 10) {
                                Image(systemName: fileIcon(for: file.status))
                                    .font(.system(size: 10, weight: .medium))
                                    .foregroundStyle(fileColor(for: file.status))
                                    .frame(width: 18)
                                Text(file.path)
                                    .font(.system(size: 11, weight: .regular, design: .monospaced))
                                    .foregroundStyle(theme.textSecondary)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                                Spacer()
                                Text(file.status)
                                    .font(.system(size: 10, weight: .regular, design: .monospaced))
                                    .foregroundStyle(theme.textTertiary)
                            }
                            .padding(.horizontal, 18)
                            .frame(height: 30)
                            .background(theme.commandPanel.opacity(0.82))
                            if file.id != visibleFiles.last?.id {
                                Rectangle()
                                    .fill(theme.divider)
                                    .frame(width: 760, height: 1)
                            }
                        }
                    }
                    .frame(width: 760)
                    .clipShape(UnevenRoundedRectangle(topLeadingRadius: 0, bottomLeadingRadius: 18, bottomTrailingRadius: 18, topTrailingRadius: 0))
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.bottom, visibleFiles.isEmpty ? 0 : 10)
        .onAppear {
            model.refreshChangedFilesSummary()
        }
    }

    var displayFiles: [ChangedFileSummary] {
        if !model.changedFileSummary.isEmpty {
            return model.changedFileSummary
        }
        return model.aiTrace.flatMap { event -> [ChangedFileSummary] in
            if event.kind == .file, !event.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return [ChangedFileSummary(id: "ai-\(event.title)", status: "AI", path: event.title)]
            }
            guard event.kind == .tool, event.detail.statusToken == "completed" else { return [] }
            let paths = aiChangedPaths(from: event)
            return paths.map { path in
                ChangedFileSummary(id: "ai-\(path)", status: "AI", path: path)
            }
        }.uniquedByPath()
    }

    func aiChangedPaths(from event: AITraceEvent) -> [String] {
        let candidates = [
            event.detail.value(after: "Wrote "),
            event.detail.value(after: "Writing "),
            event.detail.value(after: "Patching "),
            event.title.hasPrefix("Updated file ") ? String(event.title.dropFirst("Updated file ".count)) : nil,
            event.title.hasPrefix("Patched file ") ? String(event.title.dropFirst("Patched file ".count)) : nil,
        ].compactMap { $0 }

        return candidates.flatMap { value in
            value
                .components(separatedBy: ",")
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty && !$0.lowercased().contains("creating files in") }
        }
    }

    func fileIcon(for status: String) -> String {
        if status.contains("D") { return "minus.circle" }
        if status.contains("A") || status.contains("?") { return "plus.circle" }
        if status.contains("R") { return "arrow.triangle.2.circlepath" }
        return "pencil.circle"
    }

    func fileColor(for status: String) -> Color {
        if status.contains("D") { return theme.danger }
        if status.contains("A") || status.contains("?") || status == "AI" { return theme.green }
        return theme.accent
    }
}

extension Array where Element == ChangedFileSummary {
    func uniquedByPath() -> [ChangedFileSummary] {
        var seen = Set<String>()
        return filter { file in
            if seen.contains(file.path) { return false }
            seen.insert(file.path)
            return true
        }
    }
}
