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

struct IDEEditChatCommand {
    enum Kind {
        case replaceLine
        case insertAfterLine
        case patch
    }

    let kind: Kind
    let path: String
    let line: Int
    let text: String

    static func parse(_ prompt: String) -> IDEEditChatCommand? {
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        if let patch = fencedPatch(in: trimmed) {
            return IDEEditChatCommand(kind: .patch, path: "patch.diff", line: 1, text: patch)
        }

        let patterns: [(String, Kind)] = [
            (#"replace\s+line\s+(\d+)\s+(?:of|in)\s+([A-Za-z0-9_./@+\-]+\.[A-Za-z0-9]+)\s+with\s+([\s\S]+)"#, .replaceLine),
            (#"insert\s+(?:below|after)\s+line\s+(\d+)\s+(?:of|in)\s+([A-Za-z0-9_./@+\-]+\.[A-Za-z0-9]+)\s+(?:with\s+)?([\s\S]+)"#, .insertAfterLine),
        ]
        for (pattern, kind) in patterns {
            guard let match = firstMatch(pattern, in: trimmed.lowercased(), original: trimmed),
                  let line = Int(match[1]) else { continue }
            return IDEEditChatCommand(kind: kind, path: match[2], line: line, text: match[3])
        }
        return nil
    }

    static func fencedPatch(in text: String) -> String? {
        guard text.lowercased().contains("apply this patch"),
              let start = text.range(of: "```") else { return nil }
        let afterStart = text[start.upperBound...]
        let codeStart = afterStart.firstIndex(of: "\n").map { text.index(after: $0) } ?? start.upperBound
        guard let end = text[codeStart...].range(of: "```") else { return nil }
        let patch = String(text[codeStart..<end.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
        return patch.isEmpty ? nil : patch
    }

    static func firstMatch(_ pattern: String, in lowerText: String, original: String) -> [String]? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: []) else { return nil }
        let range = NSRange(lowerText.startIndex..<lowerText.endIndex, in: lowerText)
        guard let match = regex.firstMatch(in: lowerText, range: range) else { return nil }
        return (0..<match.numberOfRanges).compactMap { index in
            guard let lowerRange = Range(match.range(at: index), in: lowerText),
                  let originalRange = Range(match.range(at: index), in: original) else { return nil }
            return index <= 2 ? String(lowerText[lowerRange]) : String(original[originalRange])
        }
    }
}
