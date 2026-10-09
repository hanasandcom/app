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

extension DesktopAgentModel {

    func typeRemoteText(_ text: String?) {
        selectedSection = .server
        let value = (text?.removingPercentEncoding ?? text ?? "").trimmingCharacters(in: .newlines)
        guard !value.isEmpty else {
            markRemoteDesktopCommand("Type text failed", detail: "No text was supplied from the Hanasand app.", kind: .error)
            return
        }
        let escapedText = value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        let script = """
        tell application "System Events"
            keystroke "\(escapedText)"
        end tell
        """
        var error: NSDictionary?
        guard NSAppleScript(source: script)?.executeAndReturnError(&error) != nil else {
            markRemoteDesktopCommand(
                "Type text failed",
                detail: error?.description ?? "Could not type text. Grant Accessibility permission if macOS asks.",
                kind: .error
            )
            currentTaskState = "Typing failed"
            return
        }
        markRemoteDesktopCommand("Typed text", detail: "Typed text from the Hanasand app.", kind: .change)
        currentTaskState = "Typed from app"
    }

    func openRemoteControlPermissions() {
        selectedSection = .server
        let urls = [
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        ]
        urls.compactMap(URL.init(string:)).forEach { NSWorkspace.shared.open($0) }
        markRemoteDesktopCommand(
            "Authorize Mac",
            detail: "Opened Screen Recording and Accessibility privacy panes for Hanasand.",
            kind: .command
        )
        currentTaskState = "Waiting for macOS permissions"
    }
}
