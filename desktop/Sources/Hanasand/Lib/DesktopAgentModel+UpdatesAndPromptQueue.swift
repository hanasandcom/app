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

    func startRemoteCodexWorkerIfAvailable() {
        guard ProcessInfo.processInfo.environment["HANASAND_DESKTOP_START_CODEX_WORKER"] == "1" else {
            append(meta: "Codex worker", body: "Remote worker is idle. Set HANASAND_DESKTOP_START_CODEX_WORKER=1 to enable local prompt polling.", kind: .note)
            return
        }
        guard codexWorkerProcess?.isRunning != true else { return }
        let scriptPath = "/Users/eirikhanasand/Desktop/personal/hanasand/app/desktop/scripts/codex-remote-worker.sh"
        guard FileManager.default.isExecutableFile(atPath: scriptPath) else {
            append(meta: "Codex worker", body: "Remote Codex worker script is not executable at \(scriptPath).", kind: .error)
            return
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: scriptPath)
        process.currentDirectoryURL = URL(fileURLWithPath: "/Users/eirikhanasand/Desktop/personal/hanasand")
        process.environment = ProcessInfo.processInfo.environment.merging([
            "HANASAND_CODEX_POLL_SECONDS": "2",
        ]) { _, new in new }
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
            codexWorkerProcess = process
            append(meta: "Codex worker", body: "Remote phone-to-Codex worker is running.", kind: .change)
        } catch {
            append(meta: "Codex worker failed", body: error.localizedDescription, kind: .error)
        }
    }

    func checkForUpdates(automatic: Bool = false) async {
        updateStatus = automatic ? .checking(message: "Checking") : .checking(message: "Checking")
        var downloadedPath: URL?

        do {
            let currentVersion = effectiveInstalledVersion
            let client = AppUpdateClient()
            let manifest = try await client.fetchManifest(currentVersion: currentVersion)
            updateManifest = manifest

            guard manifest.updateAvailable else {
                if manifest.hasNewerVersion(than: currentVersion) {
                    updateStatus = .unavailable(message: "Update feed is live. Version \(manifest.latestVersion) is listed, but no packaged desktop build is published yet.")
                } else if !backgroundInstalledUpdateVersion.isEmpty {
                    updateStatus = .ready(message: "Restart Hanasand to use \(backgroundInstalledUpdateVersion).")
                } else {
                    updateStatus = .upToDate(message: "Hanasand Desktop \(Self.appVersion) is current.")
                }
                return
            }

            updateStatus = .downloading(message: "Downloading \(manifest.latestVersion)")
            let stagedPath = try await client.download(manifest: manifest)
            downloadedPath = stagedPath
            stagedUpdatePath = stagedPath.path
            updateStatus = .installing(message: "Installing \(manifest.latestVersion)")
            let installedApp = try await client.installDownloadedApp(from: stagedPath)
            rememberBackgroundInstalledUpdate(version: manifest.latestVersion)
            stagedUpdatePath = installedApp.path
            updateStatus = .ready(message: "Restart Hanasand to use \(manifest.latestVersion).")
            append(meta: "Update installed", body: "\(manifest.latestVersion) -> \(installedApp.path)", kind: .change)
        } catch {
            if let downloadedPath {
                stagedUpdatePath = downloadedPath.path
                updateStatus = .ready(message: "Downloaded update is ready. Install failed: \(error.localizedDescription)")
            } else if Self.isNetworkUnavailable(error) {
                updateStatus = .failed(message: "Server unavailable")
            } else {
                updateStatus = .failed(message: error.localizedDescription)
            }
            if !automatic {
                append(meta: "Update failed", body: error.localizedDescription, kind: .error)
            }
        }
    }

    static func isNetworkUnavailable(_ error: Error) -> Bool {
        if case UpdateError.httpStatus(let status) = error, [502, 503, 504].contains(status) {
            return true
        }

        if let urlError = error as? URLError {
            switch urlError.code {
            case .notConnectedToInternet, .networkConnectionLost, .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed, .timedOut:
                return true
            default:
                return false
            }
        }

        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain {
            return true
        }

        let message = error.localizedDescription.lowercased()
        return message.contains("could not connect")
            || message.contains("timed out")
            || message.contains("offline")
            || message.contains("not connected")
            || message.contains("could not resolve host")
            || message.contains("network")
    }

    func rememberBackgroundInstalledUpdate(version: String) {
        guard version.isNewerVersion(than: Self.appVersion) else {
            backgroundInstalledUpdateVersion = ""
            UserDefaults.standard.removeObject(forKey: Self.backgroundInstalledUpdateVersionKey)
            return
        }
        backgroundInstalledUpdateVersion = version
        UserDefaults.standard.set(version, forKey: Self.backgroundInstalledUpdateVersionKey)
    }

    func revealStagedUpdate() {
        guard let stagedUpdatePath else { return }
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: stagedUpdatePath)])
    }

    func submitPrompt() {
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isRunning else { return }
        prompt = ""
        runPrompt(trimmed)
    }

    func queuePrompt() {
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        schedulePrompt(trimmed)
        prompt = ""
        if !isRunning && !isAIRateLimited {
            runNextQueuedPrompt()
        }
    }

    func schedulePrompt(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        promptQueue.append(QueuedPrompt(text: trimmed))
        append(meta: "Queued", body: trimmed, kind: .note)
    }

    func updateQueuedPrompt(_ item: QueuedPrompt, text: String) {
        guard let index = promptQueue.firstIndex(where: { $0.id == item.id }) else { return }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            promptQueue.remove(at: index)
        } else {
            promptQueue[index].text = trimmed
        }
    }

    func promoteQueuedPromptAfterNextTool(_ item: QueuedPrompt) {
        guard let index = promptQueue.firstIndex(where: { $0.id == item.id }) else { return }
        let next = promptQueue.remove(at: index)
        promptQueue.insert(next, at: 0)
        append(meta: "Scheduled next", body: next.text, kind: .note)
        if !isRunning && !isAIRateLimited {
            runNextQueuedPrompt()
        }
    }

    func runNextQueuedPrompt() {
        guard !isRunning, !isAIRateLimited, let next = promptQueue.first else { return }
        promptQueue.removeFirst()
        submitAIChatPrompt(next.text)
        if !isRunning {
            runNextQueuedPrompt()
        }
    }

    func forceQueuedPrompt(_ item: QueuedPrompt) {
        guard let index = promptQueue.firstIndex(where: { $0.id == item.id }) else { return }
        let next = promptQueue.remove(at: index)
        if isRunning {
            promptQueue.insert(next, at: 0)
            append(meta: "Queued next", body: next.text, kind: .note)
        } else {
            if isAIRateLimited {
                promptQueue.insert(next, at: 0)
            } else {
                submitAIChatPrompt(next.text)
            }
        }
    }

    func moveQueuedPrompt(_ item: QueuedPrompt, direction: Int) {
        guard let index = promptQueue.firstIndex(where: { $0.id == item.id }) else { return }
        let target = index + direction
        guard promptQueue.indices.contains(target) else { return }
        promptQueue.swapAt(index, target)
    }
}
