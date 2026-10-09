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

extension String {
    var normalizedBaseURL: URL {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        return URL(string: trimmed).or(URL(string: "https://hanasand.com/api")!)
    }

    var slugifiedPath: String {
        let lowered = lowercased()
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
        let scalars = lowered.unicodeScalars.map { scalar -> Character in
            allowed.contains(scalar) ? Character(scalar) : "-"
        }
        let collapsed = String(scalars)
            .split(separator: "-")
            .joined(separator: "-")
            .trimmingCharacters(in: CharacterSet(charactersIn: "-_"))
        return collapsed.isEmpty ? "desktop-share" : collapsed
    }

    var htmlEscaped: String {
        replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&#39;")
    }

    var websocketBaseURL: URL? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if trimmed.hasPrefix("https://") {
            return URL(string: "wss://\(trimmed.dropFirst("https://".count))")
        }
        if trimmed.hasPrefix("http://") {
            return URL(string: "ws://\(trimmed.dropFirst("http://".count))")
        }
        if trimmed.hasPrefix("ws://") || trimmed.hasPrefix("wss://") {
            return URL(string: trimmed)
        }
        return nil
    }
}
