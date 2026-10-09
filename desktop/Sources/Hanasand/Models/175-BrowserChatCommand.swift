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

struct BrowserChatCommand {
    enum Kind {
        case open
        case popOut
        case popOutCurrent
    }

    let kind: Kind
    let target: String

    static func parse(_ rawPrompt: String) -> BrowserChatCommand? {
        let prompt = rawPrompt.trimmingCharacters(in: .whitespacesAndNewlines)
        let lower = prompt.lowercased()

        if ["pop out browser", "popout browser", "pop out current browser", "popout current browser"].contains(lower) {
            return BrowserChatCommand(kind: .popOutCurrent, target: "")
        }

        for prefix in ["pop out ", "popout "] where lower.hasPrefix(prefix) {
            let target = String(prompt.dropFirst(prefix.count)).cleanBrowserTargetSuffix()
            guard !target.isEmpty else { return BrowserChatCommand(kind: .popOutCurrent, target: "") }
            return BrowserChatCommand(kind: .popOut, target: target)
        }

        for prefix in ["open ", "go to ", "browse ", "show "] where lower.hasPrefix(prefix) {
            let target = String(prompt.dropFirst(prefix.count)).cleanBrowserTargetSuffix()
            guard !target.isEmpty else { return nil }
            if target.lowercased().contains(" pop out") || target.lowercased().contains(" popout") {
                return BrowserChatCommand(kind: .popOut, target: target.replacingOccurrences(of: " pop out", with: "", options: .caseInsensitive).replacingOccurrences(of: " popout", with: "", options: .caseInsensitive))
            }
            return BrowserChatCommand(kind: .open, target: target)
        }

        return nil
    }
}
