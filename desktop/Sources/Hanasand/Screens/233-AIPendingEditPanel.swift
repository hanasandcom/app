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

struct AIPendingEditPanel: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme
    let edit: IDEPendingEdit

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Label(edit.title, systemImage: "square.and.pencil")
                    .font(.system(size: 12, weight: .black))
                    .foregroundStyle(theme.text)
                Spacer()
                Button("Open") {
                    model.openIDEFile(edit.path, line: edit.line, revealDiff: false, source: "Edit preview")
                }
                .buttonStyle(.plain)
                Button("Apply") {
                    model.applyPendingIDEEdit()
                }
                .buttonStyle(.plain)
                .foregroundStyle(theme.green)
                Button("Discard") {
                    model.discardPendingIDEEdit()
                }
                .buttonStyle(.plain)
                .foregroundStyle(theme.danger)
            }
            Text(edit.path)
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundStyle(theme.textTertiary)
                .lineLimit(1)
            Text(edit.preview)
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .foregroundStyle(theme.textSecondary)
                .textSelection(.enabled)
                .lineLimit(12)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.backgroundElevated)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .padding(12)
        .background(theme.card)
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(theme.accent.opacity(0.32), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}
