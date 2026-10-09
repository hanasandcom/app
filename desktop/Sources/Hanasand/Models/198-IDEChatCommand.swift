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

struct IDEChatCommand {
    let path: String
    let line: Int?
    let revealDiff: Bool

    static func parse(_ prompt: String) -> IDEChatCommand? {
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        let lower = trimmed.lowercased()
        let linePattern = #"line\s+(\d+)\s+(?:of|in)\s+([A-Za-z0-9_./@+\-]+\.[A-Za-z0-9]+)"#
        if let match = firstMatch(linePattern, in: lower),
           let line = Int(match[1]) {
            return IDEChatCommand(path: match[2], line: line, revealDiff: false)
        }

        for prefix in ["open file ", "open ", "show file ", "show "] where lower.hasPrefix(prefix) {
            let target = String(trimmed.dropFirst(prefix.count)).trimmingCharacters(in: .whitespacesAndNewlines)
            guard target.contains(".") || target.contains("/") else { continue }
            return IDEChatCommand(path: target, line: nil, revealDiff: false)
        }

        for prefix in ["diff ", "show diff ", "open diff "] where lower.hasPrefix(prefix) {
            let target = String(trimmed.dropFirst(prefix.count)).trimmingCharacters(in: .whitespacesAndNewlines)
            guard !target.isEmpty else { continue }
            return IDEChatCommand(path: target, line: nil, revealDiff: true)
        }

        return nil
    }

    static func firstMatch(_ pattern: String, in text: String) -> [String]? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: []) else { return nil }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        guard let match = regex.firstMatch(in: text, range: range) else { return nil }
        return (0..<match.numberOfRanges).compactMap { index in
            guard let range = Range(match.range(at: index), in: text) else { return nil }
            return String(text[range])
        }
    }
}
