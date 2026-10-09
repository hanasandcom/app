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

struct IDEInlineDiffView: View {
    @Environment(\.desktopTheme) var theme
    let title: String
    let diff: String
    let hunks: [IDEDiffHunk]
    let close: () -> Void
    let jumpToLine: (Int) -> Void
    @State var sideBySide = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Label(title, systemImage: "plus.forwardslash.minus")
                    .font(.system(size: 11, weight: .black))
                    .foregroundStyle(theme.text)
                    .lineLimit(1)
                Spacer()
                Toggle("Split", isOn: $sideBySide)
                    .toggleStyle(.checkbox)
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(theme.textTertiary)
                ForEach(hunks.prefix(4)) { hunk in
                    Button("Line \(hunk.newLine)") {
                        jumpToLine(hunk.newLine)
                    }
                    .buttonStyle(.plain)
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(theme.accent)
                    .help(hunk.title)
                }
                Button(action: close) {
                    Image(systemName: "xmark")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(theme.textTertiary)
                        .frame(width: 24, height: 24)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 12)
            .frame(height: 30)
            .background(theme.commandBar)

            ScrollView {
                if sideBySide {
                    HStack(alignment: .top, spacing: 10) {
                        Text(sideBySideColumn(prefix: "-"))
                            .foregroundStyle(theme.danger)
                            .frame(maxWidth: .infinity, alignment: .topLeading)
                        Text(sideBySideColumn(prefix: "+"))
                            .foregroundStyle(theme.green)
                            .frame(maxWidth: .infinity, alignment: .topLeading)
                    }
                    .font(.system(size: 11, weight: .semibold, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(12)
                } else {
                    Text(highlightedDiff)
                        .font(.system(size: 11, weight: .semibold, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                        .padding(12)
                }
            }
            .background(theme.backgroundElevated)
        }
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(theme.divider)
                .frame(height: 1)
        }
    }

    func sideBySideColumn(prefix: String) -> String {
        diff.components(separatedBy: .newlines)
            .filter { $0.hasPrefix(prefix) && !$0.hasPrefix(prefix + prefix + prefix) }
            .map { String($0.dropFirst()) }
            .joined(separator: "\n")
    }

    var highlightedDiff: AttributedString {
        var output = AttributedString("")
        for line in diff.components(separatedBy: .newlines) {
            let color: Color
            if line.hasPrefix("+"), !line.hasPrefix("+++") {
                color = theme.green
            } else if line.hasPrefix("-"), !line.hasPrefix("---") {
                color = theme.danger
            } else if line.hasPrefix("@@") {
                color = theme.accent
            } else {
                color = theme.textSecondary
            }
            var attributed = AttributedString(line + "\n")
            attributed.foregroundColor = color
            output += attributed
        }
        return output
    }
}
