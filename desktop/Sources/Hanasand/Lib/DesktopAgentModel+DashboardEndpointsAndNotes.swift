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

    func refreshChangedFilesSummary() {
        let cwd = status.cwd
        changedFileSummaryStatus = "Checking Git"
        Task {
            let result = await Task.detached {
                Self.executeShellWithStatus("git status --porcelain", cwd: cwd)
            }.value
            await MainActor.run {
                guard result.exitCode == 0 else {
                    changedFileSummary = []
                    changedFileSummaryStatus = "Changes"
                    return
                }
                let changes = result.output
                    .components(separatedBy: .newlines)
                    .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
                    .map { line -> ChangedFileSummary in
                        let status = String(line.prefix(2)).trimmingCharacters(in: .whitespaces)
                        let rawPath = String(line.dropFirst(min(3, line.count)))
                        let path = rawPath.components(separatedBy: " -> ").last ?? rawPath
                        return ChangedFileSummary(id: path, status: status.isEmpty ? "M" : status, path: path)
                    }
                changedFileSummary = changes
                changedFileSummaryStatus = "Changes"
            }
        }
    }

    nonisolated static func executeShellWithStatus(_ command: String, cwd: String) -> (output: String, exitCode: Int32) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = ["-lc", command]
        process.currentDirectoryURL = URL(fileURLWithPath: cwd)
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        do {
            try process.run()
            process.waitUntilExit()
            let output = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
            return (output, process.terminationStatus)
        } catch {
            return ("", 1)
        }
    }

    nonisolated static func executeShell(_ command: String, cwd: String) -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = ["-lc", command]
        process.currentDirectoryURL = URL(fileURLWithPath: cwd)
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        do {
            try process.run()
            process.waitUntilExit()
            return String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        } catch {
            return ""
        }
    }

    struct NativeEndpoint {
        let label: String
        let baseURL: URL
        let path: String
        let authenticated: Bool
        let userAgent: String?
    }

    func nativeEndpoint(for dashboardPath: String) -> NativeEndpoint? {
        let cleanPath = dashboardPath.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let api = settings.apiBaseURL.normalizedBaseURL
        let internalAPI = settings.internalAPIBaseURL.normalizedBaseURL
        let auth = hasHanasandAuth

        switch cleanPath {
        case "dashboard":
            return NativeEndpoint(label: "system status", baseURL: api, path: "status", authenticated: auth, userAgent: nil)
        case "mail":
            return NativeEndpoint(label: "mail overview", baseURL: api, path: "mail/overview", authenticated: true, userAgent: nil)
        case "notes":
            return NativeEndpoint(label: "notes", baseURL: api, path: "notes", authenticated: true, userAgent: nil)
        case "system":
            return NativeEndpoint(label: "docker metrics", baseURL: api, path: "docker", authenticated: auth, userAgent: nil)
        case "system/ai":
            return NativeEndpoint(label: "AI models", baseURL: api, path: "ai/models", authenticated: auth, userAgent: nil)
        case "system/rates":
            return NativeEndpoint(label: "rate limits", baseURL: api, path: "rate-limit/settings", authenticated: true, userAgent: nil)
        case "vms":
            let userPath = effectiveUserIDForRequests.isEmpty ? "vms" : "vms/access/\(effectiveUserIDForRequests)"
            return NativeEndpoint(label: "virtual machines", baseURL: api, path: userPath, authenticated: auth, userAgent: nil)
        case "dashboard/tests":
            return NativeEndpoint(label: "recent tests", baseURL: api, path: "tests/recent", authenticated: auth, userAgent: nil)
        case "logs":
            return NativeEndpoint(label: "logs", baseURL: api, path: "logs", authenticated: true, userAgent: nil)
        case "db":
            return NativeEndpoint(label: "database overview", baseURL: internalAPI, path: "db", authenticated: true, userAgent: "hanasand_internal")
        case "db/backups":
            return NativeEndpoint(label: "backup services", baseURL: internalAPI, path: "backup", authenticated: true, userAgent: "hanasand_internal")
        case "db/restore":
            return NativeEndpoint(label: "backup files", baseURL: internalAPI, path: "backup/files", authenticated: true, userAgent: "hanasand_internal")
        case "vulnerabilities":
            return NativeEndpoint(label: "vulnerabilities", baseURL: internalAPI, path: "vulnerabilities", authenticated: true, userAgent: "hanasand_internal")
        case "management", "users":
            return NativeEndpoint(label: "users", baseURL: api, path: "users", authenticated: true, userAgent: nil)
        case "role":
            return NativeEndpoint(label: "roles", baseURL: api, path: "roles", authenticated: true, userAgent: nil)
        case "content/articles":
            return NativeEndpoint(label: "articles", baseURL: api, path: "articles", authenticated: auth, userAgent: nil)
        case "content/thoughts":
            return NativeEndpoint(label: "thoughts", baseURL: api, path: "thoughts", authenticated: auth, userAgent: nil)
        case "profile":
            guard !effectiveUserIDForRequests.isEmpty else { return nil }
            return NativeEndpoint(label: "profile", baseURL: api, path: "user/full/\(effectiveUserIDForRequests)", authenticated: true, userAgent: nil)
        case "s":
            guard !effectiveUserIDForRequests.isEmpty else { return nil }
            return NativeEndpoint(label: "shares", baseURL: settings.cdnBaseURL.normalizedBaseURL, path: "share/user/\(effectiveUserIDForRequests)", authenticated: true, userAgent: nil)
        case "g":
            return nil
        default:
            return nil
        }
    }

    func nativeFallbackDescription(for dashboardPath: String) -> String {
        switch dashboardPath {
        case "/g":
            return "Native shortcut controls are ready. Create a /g link, inspect an existing shortcut, or update its destination."
        case "/upload", "/dashboard/files":
            return "Native uploader is ready. Choose a file, optionally reserve a path, then upload directly to the CDN."
        case "/profile":
            return "Hanasand session is not ready yet. Log in again if profile data does not load."
        case "/s":
            return "Hanasand session is not ready yet. Log in again if shares do not load."
        default:
            return "No direct API-backed native panel is registered for \(dashboardPath) yet."
        }
    }

    func selectNote(_ note: DashboardNote?) {
        selectedNoteID = note?.id ?? ""
        loadSelectedNoteIntoDraft()
    }

    func newNoteDraft() {
        selectedNoteID = ""
        noteDraftTitle = ""
        noteDraftContent = ""
    }
}
