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

enum AIFileReferenceParser {
    static func references(in content: String, changedFiles: [ChangedFileSummary]) -> [ChangedFileSummary] {
        var output = changedFiles
        let existing = Set(output.map(\.path))
        let patterns = [
            #"`([^`\n]+\.[A-Za-z0-9]+)`"#,
            #"([A-Za-z0-9_./@+\-]+\.(?:swift|ts|tsx|js|jsx|json|md|css|html|py|sh|yml|yaml))(?::(\d+))?"#,
        ]
        for pattern in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern, options: []) else { continue }
            let range = NSRange(content.startIndex..<content.endIndex, in: content)
            for match in regex.matches(in: content, range: range) {
                guard let pathRange = Range(match.range(at: 1), in: content) else { continue }
                let path = String(content[pathRange]).trimmingCharacters(in: CharacterSet(charactersIn: "`.,) "))
                guard path.contains("."), !existing.contains(path), !output.contains(where: { $0.path == path }) else { continue }
                output.append(ChangedFileSummary(id: "mentioned-\(path)", status: "~", path: path))
            }
        }
        return output
    }
}
