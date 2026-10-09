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

enum AIChatContentParser {
    static func segments(from rawContent: String) -> [AIChatContentSegment] {
        let content = rawContent.trimmingCharacters(in: .newlines)
        guard !content.isEmpty else {
            return [AIChatContentSegment(kind: .text, language: "", content: rawContent)]
        }

        if !content.contains("```"), let formatted = JSONChatFormatter.formattedJSON(from: content) {
            return [AIChatContentSegment(kind: .json, language: "json", content: formatted)]
        }

        var segments: [AIChatContentSegment] = []
        var cursor = content.startIndex

        while let fenceStart = content[cursor...].range(of: "```") {
            appendText(String(content[cursor..<fenceStart.lowerBound]), to: &segments)

            let languageStart = fenceStart.upperBound
            var language = ""
            var codeStart = languageStart
            if languageStart < content.endIndex,
               let lineEnd = content[languageStart...].firstIndex(of: "\n") {
                language = String(content[languageStart..<lineEnd]).trimmingCharacters(in: .whitespacesAndNewlines)
                codeStart = content.index(after: lineEnd)
            }

            if let fenceEnd = content[codeStart...].range(of: "```") {
                appendCode(String(content[codeStart..<fenceEnd.lowerBound]), language: language, to: &segments)
                cursor = fenceEnd.upperBound
            } else {
                appendCode(String(content[codeStart...]), language: language, to: &segments)
                cursor = content.endIndex
            }
        }

        if cursor < content.endIndex {
            appendText(String(content[cursor..<content.endIndex]), to: &segments)
        }

        return segments.isEmpty ? [AIChatContentSegment(kind: .text, language: "", content: content)] : segments
    }

    static func appendText(_ text: String, to segments: inout [AIChatContentSegment]) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        if let formatted = JSONChatFormatter.formattedJSON(from: trimmed) {
            segments.append(AIChatContentSegment(kind: .json, language: "json", content: formatted))
        } else {
            segments.append(AIChatContentSegment(kind: .text, language: "", content: trimmed))
        }
    }

    static func appendCode(_ code: String, language: String, to segments: inout [AIChatContentSegment]) {
        let cleanCode = code.trimmingCharacters(in: .newlines)
        let normalizedLanguage = language.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if normalizedLanguage == "json", let formatted = JSONChatFormatter.formattedJSON(from: cleanCode) {
            segments.append(AIChatContentSegment(kind: .json, language: "json", content: formatted))
        } else if let formatted = JSONChatFormatter.formattedJSON(from: cleanCode) {
            segments.append(AIChatContentSegment(kind: .json, language: "json", content: formatted))
        } else {
            segments.append(AIChatContentSegment(kind: .code, language: normalizedLanguage, content: cleanCode))
        }
    }
}
