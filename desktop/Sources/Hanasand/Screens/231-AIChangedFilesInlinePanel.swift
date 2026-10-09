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

struct AIChangedFilesInlinePanel: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme
    let files: [ChangedFileSummary]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Label("Changed files", systemImage: "plus.forwardslash.minus")
                    .font(.system(size: 11, weight: .black))
                    .foregroundStyle(theme.text)
                Spacer()
                Button("Go IDE") {
                    model.selectedSection = .ide
                }
                .buttonStyle(.plain)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(theme.accent)
            }
            ForEach(files) { file in
                HStack(spacing: 8) {
                    Text(file.status)
                        .font(.system(size: 10, weight: .black, design: .monospaced))
                        .foregroundStyle(tint(for: file))
                        .frame(width: 24, alignment: .leading)
                    Text(file.path)
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                        .foregroundStyle(theme.textSecondary)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    Button("Diff") {
                        model.openIDEFile(file.path, revealDiff: true, source: "AI changed files")
                    }
                    .buttonStyle(.plain)
                    Button("Preview") {
                        model.previewChangedFile(file.path)
                    }
                    .buttonStyle(.plain)
                    Button("Open") {
                        model.openIDEFile(file.path, source: "AI changed files")
                    }
                    .buttonStyle(.plain)
                }
                .font(.system(size: 11, weight: .bold))
                .padding(.horizontal, 10)
                .frame(height: 30)
                .background(theme.field)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
        }
        .padding(10)
        .background(theme.backgroundElevated.opacity(0.78))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(theme.divider, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    func tint(for file: ChangedFileSummary) -> Color {
        if file.status.contains("D") { return theme.danger }
        if file.status.contains("A") || file.status.contains("?") { return theme.green }
        return theme.accent
    }
}
