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

    func runRemoteCodexPrompt(_ text: String?) {
        selectedSection = .control
        let promptText = (text?.removingPercentEncoding ?? text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !promptText.isEmpty else {
            append(meta: "Codex remote", body: "No prompt was supplied from the Hanasand app.", kind: .error)
            recordRun(title: "Codex remote error", detail: "Missing prompt", kind: .error)
            currentTaskState = "Remote Codex prompt missing"
            return
        }

        let requestedAt = Date()
        let runID = "RUN-\(Int(requestedAt.timeIntervalSince1970))"
        let wrappedPrompt = """
        You are running from the Hanasand phone-to-Mac control path.
        Run id: \(runID)

        User prompt:
        \(promptText)

        Before your final answer, create or overwrite /tmp/hanasand-phone-codex-flow.txt with one short line containing the run id and a short summary of what you did.
        """
        let queueURL = URL(fileURLWithPath: "/tmp/hanasand-codex-queue", isDirectory: true)
        let promptURL = queueURL.appendingPathComponent("\(runID).prompt")
        do {
            try FileManager.default.createDirectory(at: queueURL, withIntermediateDirectories: true)
            try wrappedPrompt.write(to: promptURL, atomically: true, encoding: .utf8)
        } catch {
            append(meta: "Codex queue failed", body: error.localizedDescription, kind: .error)
            recordRun(title: "Codex queue failed", detail: error.localizedDescription, kind: .error)
            currentTaskState = "Codex queue failed"
            return
        }

        remoteControlRequests += 1
        remoteControlLastCommand = "Codex prompt"
        remoteControlSummary = "Phone queued Codex on this Mac with run \(runID)."
        currentTaskState = "Codex queued from phone"
        status = AgentStatus.ready(message: "remote Codex queued \(runID)")
        append(meta: "Codex remote", body: "Phone queued Codex run \(runID) at \(promptURL.path).", kind: .command)
        recordRun(title: "Phone Codex", detail: promptText, kind: .command)
    }

    nonisolated static func runCodexProcess(
        codexPath: String,
        repoPath: String,
        outputURL: URL,
        logURL: URL,
        prompt: String
    ) -> (ok: Bool, message: String) {
        guard FileManager.default.isExecutableFile(atPath: codexPath) else {
            return (false, "Codex CLI was not found at \(codexPath).")
        }

        try? FileManager.default.removeItem(at: outputURL)
        try? FileManager.default.removeItem(at: logURL)
        let promptURL = URL(fileURLWithPath: "/tmp/hanasand-phone-codex-prompt.txt")
        try? prompt.write(to: promptURL, atomically: true, encoding: .utf8)

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.currentDirectoryURL = URL(fileURLWithPath: repoPath)
        process.arguments = [
            "-lc",
            "\(shellQuote(codexPath)) exec --cd \(shellQuote(repoPath)) --sandbox workspace-write --full-auto --output-last-message \(shellQuote(outputURL.path)) - < \(shellQuote(promptURL.path)) > \(shellQuote(logURL.path)) 2>&1",
        ]

        do {
            try process.run()
        } catch {
            return (false, error.localizedDescription)
        }

        let deadline = Date().addingTimeInterval(150)
        while process.isRunning && Date() < deadline {
            Thread.sleep(forTimeInterval: 0.25)
        }
        if process.isRunning {
            process.terminate()
            Thread.sleep(forTimeInterval: 0.5)
            if process.isRunning {
                process.interrupt()
            }
        }
        process.waitUntilExit()

        let lastMessage = (try? String(contentsOf: outputURL, encoding: .utf8))
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .flatMap { $0.isEmpty ? nil : $0 }
        let logText = (try? String(contentsOf: logURL, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines)

        if process.terminationStatus == SIGTERM || process.terminationStatus == SIGINT {
            return (false, "Codex did not finish within 150 seconds. Log: \(logText ?? "No output.")")
        }

        guard process.terminationStatus == 0 else {
            return (false, logText?.isEmpty == false ? logText! : "Codex exited with status \(process.terminationStatus).")
        }

        return (true, lastMessage ?? logText ?? "Codex completed.")
    }

    nonisolated static func shellQuote(_ value: String) -> String {
        "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
    }

    func pressRemoteSearch() {
        selectedSection = .server
        let script = """
        tell application "System Events"
            key code 49 using {command down}
        end tell
        """
        var error: NSDictionary?
        guard NSAppleScript(source: script)?.executeAndReturnError(&error) != nil else {
            markRemoteDesktopCommand(
                "Go/Search failed",
                detail: error?.description ?? "Could not press Cmd+Space. Grant Accessibility permission if macOS asks.",
                kind: .error
            )
            currentTaskState = "Go/Search failed"
            return
        }
        markRemoteDesktopCommand("Go/Search", detail: "Pressed Cmd+Space from the Hanasand app.", kind: .change)
        currentTaskState = "Go/Search from app"
    }

    func pressRemoteEnter() {
        selectedSection = .server
        let script = """
        tell application "System Events"
            key code 36
        end tell
        """
        var error: NSDictionary?
        guard NSAppleScript(source: script)?.executeAndReturnError(&error) != nil else {
            markRemoteDesktopCommand(
                "Enter failed",
                detail: error?.description ?? "Could not press Enter. Grant Accessibility permission if macOS asks.",
                kind: .error
            )
            currentTaskState = "Enter failed"
            return
        }
        markRemoteDesktopCommand("Enter", detail: "Pressed Enter from the Hanasand app.", kind: .change)
        currentTaskState = "Enter from app"
    }

    func clickPointerAtCurrentLocation() {
        selectedSection = .server
        let location = NSEvent.mouseLocation
        let point = CGPoint(x: location.x, y: NSScreen.main.map { $0.frame.height - location.y } ?? location.y)
        if let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left),
           let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left) {
            down.post(tap: .cghidEventTap)
            up.post(tap: .cghidEventTap)
            markRemoteDesktopCommand(
                "Pointer clicked",
                detail: "Clicked the Mac pointer from the Hanasand app.",
                kind: .change
            )
            currentTaskState = "Pointer clicked from app"
        } else {
            markRemoteDesktopCommand(
                "Pointer click failed",
                detail: "macOS did not allow pointer click injection.",
                kind: .error
            )
            currentTaskState = "Pointer click failed"
        }
    }
}
