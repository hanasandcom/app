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

struct IDEHighlightedCodeView: View {
    @Environment(\.desktopTheme) var theme
    let code: String
    let plugin: IDECodePlugin

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Label("Syntax", systemImage: plugin.icon)
                    .font(.system(size: 11, weight: .black))
                Text(plugin.language)
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(theme.textTertiary)
                Spacer()
            }
            .padding(.horizontal, 12)
            .frame(height: 28)
            .background(theme.commandBar)

            ScrollView {
                Text(highlightedCode)
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                    .padding(12)
            }
            .background(theme.backgroundElevated)
        }
        .overlay(alignment: .top) {
            Rectangle()
                .fill(theme.divider)
                .frame(height: 1)
        }
    }

    var highlightedCode: AttributedString {
        var output = AttributedString("")
        for line in code.components(separatedBy: .newlines) {
            output += highlightedLine(line)
            output += AttributedString("\n")
        }
        return output
    }

    func highlightedLine(_ line: String) -> AttributedString {
        var result = AttributedString("")
        let words = line.split(omittingEmptySubsequences: false, whereSeparator: { $0 == " " || $0 == "\t" })
        var cursor = line.startIndex

        for word in words {
            let wordText = String(word)
            if let range = line[cursor...].range(of: wordText) {
                if cursor < range.lowerBound {
                    result += colored(String(line[cursor..<range.lowerBound]), theme.textSecondary)
                }
                result += colored(wordText, color(for: wordText, fullLine: line))
                cursor = range.upperBound
            }
        }

        if cursor < line.endIndex {
            result += colored(String(line[cursor..<line.endIndex]), theme.textSecondary)
        }

        if line.isEmpty {
            result += AttributedString("")
        }
        return result
    }

    func color(for token: String, fullLine: String) -> Color {
        let trimmed = token.trimmingCharacters(in: .punctuationCharacters)
        if fullLine.trimmingCharacters(in: .whitespaces).hasPrefix("//")
            || fullLine.trimmingCharacters(in: .whitespaces).hasPrefix("#") {
            return theme.textTertiary
        }
        if ["func", "struct", "class", "let", "var", "import", "return", "if", "else", "guard", "case", "switch", "async", "await", "const", "function", "export", "from", "def", "for", "while"].contains(trimmed) {
            return theme.accent
        }
        if token.contains("\"") || token.contains("'") {
            return theme.green
        }
        if Double(trimmed) != nil {
            return theme.danger
        }
        if token.hasPrefix("<") || token.hasSuffix(">") {
            return theme.accent
        }
        return theme.textSecondary
    }

    func colored(_ text: String, _ color: Color) -> AttributedString {
        var attributed = AttributedString(text)
        attributed.foregroundColor = color
        return attributed
    }
}
