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

    func clearControlRunHistory() {
        runHistory = []
        currentTaskState = "History cleared"
        append(meta: "Run history", body: "Cleared local control-plane history.", kind: .note)
    }

    var serverReachabilitySummary: String {
        guard !serverReachability.isEmpty else { return "Unchecked" }
        let reachable = serverReachability.filter { $0.isReachable == true }.count
        let blocked = serverReachability.filter { $0.isReachable == false }.count
        if blocked > 0 {
            return "\(blocked) blocked"
        }
        return "\(reachable) reachable"
    }

    var serverReachabilityCheckedText: String {
        guard let checkedAt = serverReachability.map(\.checkedAt).max() else { return "Never checked" }
        return "Checked \(DateFormatter.localizedString(from: checkedAt, dateStyle: .none, timeStyle: .short))"
    }

    var remoteDesktopTargetSummary: String {
        let host = settings.rdpHost.trimmingCharacters(in: .whitespacesAndNewlines)
        let user = settings.rdpUser.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !host.isEmpty else { return "No target configured" }
        return user.isEmpty ? host : "\(user)@\(host)"
    }

    func resetNativeLayout() {
        UserDefaults.standard.removeObject(forKey: "hanasand.desktop.sidebarWidth")
        UserDefaults.standard.removeObject(forKey: "hanasand.desktop.windowFrame")
        sidebarVisible = true
        selectedSection = .control
        currentTaskState = "Layout reset"
        append(meta: "Layout", body: "Reset sidebar, window frame, and active section.", kind: .note)
    }

    func toggleFullScreen() {
        NSApplication.shared.keyWindow?.toggleFullScreen(nil)
    }

    func zoomWindow() {
        NSApplication.shared.keyWindow?.zoom(nil)
    }

    func minimizeWindow() {
        NSApplication.shared.keyWindow?.miniaturize(nil)
    }

    func openMiniBrowser(url: String = "https://www.youtube.com/@fern-tv", title: String = "Fern", minified: Bool = false) {
        MiniBrowserWindowController.shared.open(url: url, title: title, minified: minified)
        selectedSection = .browser
        append(meta: "Mini browser", body: minified ? "Opened minified \(title)." : "Opened floating \(title).", kind: .command)
    }

    func openInlineBrowser(url rawValue: String, title rawTitle: String? = nil, source: String = "Agent") {
        let resolved = BrowserTargetResolver.resolve(rawValue)
        let title = rawTitle?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false ? rawTitle! : resolved.title
        browserActiveAddress = resolved.url
        browserActiveTitle = title
        browserOpenRequest = BrowserOpenRequest(title: title, url: resolved.url)
        selectedSection = .browser
        append(meta: "Browser", body: "\(source) opened \(resolved.url) in the built-in browser.", kind: .command)
    }

    func popOutBrowser(url rawValue: String? = nil, title rawTitle: String? = nil, minified: Bool = false, source: String = "Agent") {
        let resolved: (url: String, title: String)
        if let rawValue, !rawValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let target = BrowserTargetResolver.resolve(rawValue)
            resolved = (target.url, rawTitle?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false ? rawTitle! : target.title)
        } else {
            resolved = (browserActiveAddress, rawTitle?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false ? rawTitle! : browserActiveTitle)
        }
        browserActiveAddress = resolved.url
        browserActiveTitle = resolved.title
        openMiniBrowser(url: resolved.url, title: resolved.title, minified: minified)
        append(meta: "Browser", body: "\(source) popped out \(resolved.url).", kind: .command)
    }

    func openAIInlineBrowser(url rawValue: String, title rawTitle: String? = nil, source: String = "AI") {
        let resolved = BrowserTargetResolver.resolve(rawValue)
        let title = rawTitle?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false ? rawTitle! : resolved.title
        browserActiveAddress = resolved.url
        browserActiveTitle = title
        if let aiBrowserTab {
            aiBrowserTab.load(resolved.url)
        } else {
            aiBrowserTab = BrowserTabState(label: title, url: resolved.url)
        }
        aiInlineBrowserVisible = true
        selectedSection = .command
        append(meta: "AI browser", body: "\(source) opened \(resolved.url) inline.", kind: .command)
    }

    func toggleAIRightRailFromHeader() {
        aiRightRailMode = aiRightRailMode == .hidden ? .expanded : .hidden
    }

    func toggleAIRightRailWidth() {
        aiRightRailMode = aiRightRailMode == .compact ? .expanded : .compact
    }

    func openIDEFile(_ rawPath: String, line: Int? = nil, revealDiff: Bool = false, source: String = "Agent") {
        let resolvedPath = resolveWorkspacePath(rawPath)
        ideOpenRequest = IDEOpenRequest(path: resolvedPath, line: line, revealDiff: revealDiff)
        selectedSection = .ide
        append(meta: "IDE", body: "\(source) opened \(resolvedPath)\(line.map { ":\($0)" } ?? "").", kind: .command)
    }

    func createPendingIDEEdit(_ command: IDEEditChatCommand, source: String = "AI chat") {
        let resolvedPath = resolveWorkspacePath(command.path)
        guard FileManager.default.fileExists(atPath: resolvedPath),
              let original = try? String(contentsOfFile: resolvedPath, encoding: .utf8) else {
            aiMessages.append(AIChatMessage(role: .assistant, content: "I could not find \(command.path) to prepare that edit."))
            append(meta: "IDE edit", body: "Missing file \(resolvedPath)", kind: .error)
            return
        }

        let edit = IDEPendingEdit.prepare(command: command, path: resolvedPath, original: original)
        pendingIDEEdit = edit
        aiMessages.append(AIChatMessage(role: .assistant, content: "Prepared an edit preview for \(URL(fileURLWithPath: resolvedPath).lastPathComponent). Review it below, then apply it when ready."))
        append(meta: "IDE edit", body: "\(source) prepared \(edit.title)", kind: .command)
    }

    func applyPendingIDEEdit() {
        guard let edit = pendingIDEEdit else { return }
        do {
            switch edit.kind {
            case .patch:
                let patchURL = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("hanasand-\(edit.id.uuidString).patch")
                try edit.replacement.write(to: patchURL, atomically: true, encoding: .utf8)
                let result = Self.executeShellWithStatus("git apply \(Self.shellQuoted(patchURL.path))", cwd: FileManager.default.currentDirectoryPath)
                guard result.exitCode == 0 else {
                    aiMessages.append(AIChatMessage(role: .assistant, content: "Patch failed:\n\(result.output)", isError: true))
                    return
                }
            case .replaceLine, .insertAfterLine:
                try edit.updated.write(toFile: edit.path, atomically: true, encoding: .utf8)
            }
            openIDEFile(edit.path, line: edit.line, revealDiff: true, source: "AI edit")
            aiMessages.append(AIChatMessage(role: .assistant, content: "Applied \(edit.title) and opened the file in the IDE."))
            pendingIDEEdit = nil
        } catch {
            aiMessages.append(AIChatMessage(role: .assistant, content: error.localizedDescription, isError: true))
        }
    }

    func discardPendingIDEEdit() {
        pendingIDEEdit = nil
        aiMessages.append(AIChatMessage(role: .assistant, content: "Discarded the pending file edit."))
    }
}
