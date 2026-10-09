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

enum JSONChatFormatter {
    static func formattedJSON(from raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2 else { return nil }

        if let formatted = formattedJSONObject(trimmed) {
            return formatted
        }

        let lines = trimmed
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard lines.count > 1 else { return nil }

        let formattedLines = lines.compactMap { formattedJSONObject($0) }
        guard formattedLines.count == lines.count else { return nil }
        return formattedLines.joined(separator: "\n")
    }

    static func formattedJSONObject(_ raw: String) -> String? {
        guard let first = raw.first,
              first == "{" || first == "[" else { return nil }
        guard let data = raw.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data),
              JSONSerialization.isValidJSONObject(object) else { return nil }
        var options: JSONSerialization.WritingOptions = [.prettyPrinted, .sortedKeys]
        options.insert(.withoutEscapingSlashes)
        guard let formattedData = try? JSONSerialization.data(withJSONObject: object, options: options),
              let formatted = String(data: formattedData, encoding: .utf8) else { return nil }
        return formatted
    }
}
