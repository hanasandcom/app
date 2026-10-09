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

    func moveQueuedPrompt(_ item: QueuedPrompt, before target: QueuedPrompt) {
        guard item.id != target.id,
              let sourceIndex = promptQueue.firstIndex(where: { $0.id == item.id }) else { return }
        let moving = promptQueue.remove(at: sourceIndex)
        let targetIndex = promptQueue.firstIndex(where: { $0.id == target.id }) ?? promptQueue.endIndex
        promptQueue.insert(moving, at: targetIndex)
    }

    func removeQueuedPrompt(_ item: QueuedPrompt) {
        promptQueue.removeAll { $0.id == item.id }
    }

    func finishPromptRun() {
        isRunning = false
        currentTaskState = "Idle"
        runNextQueuedPrompt()
    }

    func runPrompt(_ trimmed: String) {
        guard !trimmed.isEmpty, !isRunning else { return }
        if let approval = approvalForPrompt(trimmed) {
            requestApproval(approval)
            return
        }
        isRunning = true
        currentTaskState = "Running"
        append(meta: "You", body: trimmed, kind: .user)
        recordRun(title: "Prompt", detail: trimmed, kind: .user)

        let lowered = trimmed.lowercased()
        if (lowered.contains("start") || lowered.contains("boot")) && lowered.contains("server") {
            currentTaskState = "Starting server"
            Task { [weak self] in
                guard let self else { return }
                defer { self.finishPromptRun() }
                await self.runServerAction(self.settings.serverStartPath)
            }
        } else if lowered.contains("server") && (lowered.contains("log") || lowered.contains("tail")) {
            currentTaskState = "Loading logs"
            Task { [weak self] in
                guard let self else { return }
                defer { self.finishPromptRun() }
                await self.checkServerLogs()
            }
        } else if lowered == "status" || lowered.contains("status") || lowered.contains("pc") || lowered.contains("this mac") {
            recordCommand("status")
            finishPromptRun()
        } else if lowered == "vpn" || lowered.contains("open vpn") || lowered.contains("connect vpn") || lowered.contains("cisco") {
            openVPN()
            finishPromptRun()
        } else if let browserCommand = BrowserChatCommand.parse(trimmed) {
            switch browserCommand.kind {
            case .open:
                let resolved = BrowserTargetResolver.resolve(browserCommand.target)
                openInlineBrowser(url: resolved.url, title: resolved.title, source: "Control prompt")
                append(meta: "Browser", body: "Opened \(resolved.title) in the built-in browser.", kind: .command)
                recordRun(title: "Browser", detail: resolved.url, kind: .command)
            case .popOut:
                let resolved = BrowserTargetResolver.resolve(browserCommand.target)
                popOutBrowser(url: resolved.url, title: resolved.title, minified: false, source: "Control prompt")
                append(meta: "Browser", body: "Popped out \(resolved.title).", kind: .command)
                recordRun(title: "Browser pop out", detail: resolved.url, kind: .command)
            case .popOutCurrent:
                popOutBrowser(source: "Control prompt")
                append(meta: "Browser", body: "Popped out the current browser page.", kind: .command)
                recordRun(title: "Browser pop out", detail: browserActiveAddress, kind: .command)
            }
            finishPromptRun()
        } else if lowered.contains("mail") || lowered.contains("inbox") {
            selectedSection = .mail
            currentTaskState = "Loading mail"
            Task { [weak self] in
                guard let self else { return }
                defer { self.finishPromptRun() }
                await self.loadMailOverview()
            }
        } else if lowered.contains("note") {
            openNativeDashboard(path: "/notes", label: "Notes")
            finishPromptRun()
        } else if lowered.contains("document") || lowered.contains("pdf") || lowered.contains("scan") {
            selectedSection = .documents
            append(meta: "Navigation", body: "Opened Documents.", kind: .command)
            recordRun(title: "Documents", detail: "Opened document workflow", kind: .command)
            finishPromptRun()
        } else if lowered.contains("image") || lowered.contains("photo") {
            selectedSection = .images
            append(meta: "Navigation", body: "Opened Images.", kind: .command)
            recordRun(title: "Images", detail: "Opened image review workflow", kind: .command)
            finishPromptRun()
        } else if lowered.contains("share") {
            openNativeDashboard(path: "/s", label: "Shares")
            finishPromptRun()
        } else if lowered.contains("link") {
            openNativeDashboard(path: "/g", label: "Links")
            finishPromptRun()
        } else if lowered.contains("backup") {
            openNativeDashboard(path: "/db/backups", label: "Backups")
            finishPromptRun()
        } else if lowered.contains("vulnerabil") || lowered.contains("security scan") {
            openNativeDashboard(path: "/vulnerabilities", label: "Vulnerabilities")
            finishPromptRun()
        } else if lowered.contains("traffic") {
            openNativeDashboard(path: "/traffic", label: "Traffic")
            finishPromptRun()
        } else if lowered.contains("server") || lowered.contains("logs") {
            Task { [weak self] in
                guard let self else { return }
                defer { self.finishPromptRun() }
                await self.checkServerLogs()
            }
        } else if lowered.contains("models") {
            Task { [weak self] in
                guard let self else { return }
                defer { self.finishPromptRun() }
                await self.loadAiModels()
            }
        } else if lowered == "update" || lowered.contains("update") {
            recordCommand("update")
            currentTaskState = "Checking updates"
            finishPromptRun()
        } else {
            Task { [weak self] in
                guard let self else { return }
                defer { self.finishPromptRun() }

                do {
                    let response = try await HanasandAIClient(
                        apiURL: settings.resolvedAIEndpoint,
                        token: authTokenForRequests,
                        userId: userIDForRequests
                    ).send(
                        prompt: trimmed,
                        context: status.aiContext
                    )
                    append(meta: response.meta, body: response.body, kind: .command)
                    recordRun(title: response.meta, detail: response.body, kind: .command)
                } catch {
                    append(meta: "AI error", body: error.localizedDescription, kind: .error)
                    recordRun(title: "AI error", detail: error.localizedDescription, kind: .error)
                }
            }
        }
    }

    func runStatusCommand() {
        recordCommand("status")
    }
}
