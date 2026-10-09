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

struct IDEPendingEdit: Identifiable, Equatable {
    enum Kind {
        case replaceLine
        case insertAfterLine
        case patch
    }

    let id = UUID()
    let kind: Kind
    let title: String
    let path: String
    let line: Int
    let original: String
    let replacement: String
    let updated: String

    var preview: String {
        switch kind {
        case .patch:
            return replacement
        case .replaceLine, .insertAfterLine:
            let oldLines = original.components(separatedBy: .newlines)
            let newLines = updated.components(separatedBy: .newlines)
            let lower = max(1, line - 2)
            let upper = min(max(oldLines.count, newLines.count), line + 3)
            return (lower...upper).map { index in
                let old = oldLines.indices.contains(index - 1) ? oldLines[index - 1] : ""
                let new = newLines.indices.contains(index - 1) ? newLines[index - 1] : ""
                if old == new {
                    return " \(index): \(old)"
                }
                return "-\(index): \(old)\n+\(index): \(new)"
            }.joined(separator: "\n")
        }
    }

    static func prepare(command: IDEEditChatCommand, path: String, original: String) -> IDEPendingEdit {
        var lines = original.components(separatedBy: .newlines)
        let lineIndex = max(0, min(command.line - 1, max(lines.count - 1, 0)))
        let title: String
        switch command.kind {
        case .replaceLine:
            if lines.isEmpty {
                lines = [command.text]
            } else {
                lines[lineIndex] = command.text
            }
            title = "Replace line \(command.line)"
        case .insertAfterLine:
            let insertIndex = min(command.line, lines.count)
            lines.insert(command.text, at: insertIndex)
            title = "Insert after line \(command.line)"
        case .patch:
            title = "Apply patch"
        }
        return IDEPendingEdit(
            kind: Kind(command.kind),
            title: title,
            path: path,
            line: command.line,
            original: original,
            replacement: command.text,
            updated: command.kind == .patch ? original : lines.joined(separator: "\n")
        )
    }
}
