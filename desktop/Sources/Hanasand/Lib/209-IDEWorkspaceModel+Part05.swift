import AppKit
import Combine
import Foundation
import SwiftUI


extension IDEWorkspaceModel {
    func refreshGitHistory() {
        let root = terminal.cwd
        Task {
            let output = await Task.detached {
                Self.executeShell("git log --oneline -14", cwd: root)
            }.value
            await MainActor.run {
                let parsed = output
                    .components(separatedBy: .newlines)
                    .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                    .filter { !$0.isEmpty }
                    .map { line in
                        let sha = String(line.prefix { !$0.isWhitespace })
                        return IDEGitHistoryEntry(id: sha.isEmpty ? line : sha, line: line)
                    }
                gitHistory = parsed
                gitHistorySummary = parsed.isEmpty ? "No local history" : "\(parsed.count) recent commits"
            }
        }
    }

    func openGitChange(_ change: IDEGitChange) {
        let url = URL(fileURLWithPath: change.absolutePath)
        guard FileManager.default.fileExists(atPath: url.path) else {
            terminal.run("git diff -- \(shellQuoted(change.path))")
            return
        }
        importLocalFile(url)
    }

    func diffGitChange(_ change: IDEGitChange) {
        loadInlineDiff(for: change.absolutePath)
    }

    nonisolated static func gitCommitPreview(for changes: [IDEGitChange]) -> String {
        guard !changes.isEmpty else { return "Working tree clean." }
        let added = changes.filter { $0.status.contains("A") || $0.status.contains("?") }.count
        let modified = changes.filter { $0.status.contains("M") }.count
        let deleted = changes.filter { $0.status.contains("D") }.count
        let renamed = changes.filter { $0.status.contains("R") }.count
        let headline = "\(changes.count) files: +\(added) ~\(modified) -\(deleted) renamed \(renamed)"
        let files = changes.prefix(12).map { "\($0.status) \($0.path)" }.joined(separator: "\n")
        return "\(headline)\n\(files)"
    }

    func runDiagnostics() {
        var next: [String] = []
        if editorText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            next.append("Editor is empty.")
        }
        if editorText.contains("TODO") {
            next.append("Contains TODO markers.")
        }
        if editorText.count > 8_000 {
            next.append("Large scratch buffer; consider splitting into another share.")
        }
        next.append(contentsOf: selectedPlugin.diagnostics)
        diagnostics = next.isEmpty ? ["No diagnostics."] : next
    }

    func autosaveCurrent() {
        guard autosaveEnabled else { return }
        autosaveTask?.cancel()
        autosaveTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            guard !Task.isCancelled else { return }
            await MainActor.run {
                guard let self else { return }
                self.saveCurrent()
                self.status = "Autosaved \(self.selectedFile?.title ?? "draft")"
            }
        }
    }

    func togglePlugin(_ plugin: IDECodePlugin) {
        if enabledPluginIDs.contains(plugin.id) {
            guard plugin.id != "plaintext" else { return }
            enabledPluginIDs.remove(plugin.id)
        } else {
            enabledPluginIDs.insert(plugin.id)
        }
        status = "\(plugin.language) plugin \(enabledPluginIDs.contains(plugin.id) ? "enabled" : "disabled")"
        runDiagnostics()
    }

    func replaceAllMatches() {
        guard !editorFindText.isEmpty else { return }
        editorText = editorText.replacingOccurrences(of: editorFindText, with: editorReplaceText, options: [.caseInsensitive])
        status = "Replaced matches for \(editorFindText)"
        autosaveCurrent()
        runDiagnostics()
    }

    func insertSnippet(_ snippet: IDEQuickCommand) {
        if !editorText.hasSuffix("\n") {
            editorText += "\n"
        }
        editorText += snippet.command
        status = "Inserted \(snippet.title)"
        autosaveCurrent()
        runDiagnostics()
    }

    func runPaletteCommand(_ command: IDEQuickCommand) {
        if command.command.hasPrefix("snippet:") {
            let text = String(command.command.dropFirst("snippet:".count))
            insertSnippet(IDEQuickCommand(title: command.title, command: text, icon: command.icon))
            return
        }

        switch command.command {
        case "ide:save":
            saveCurrent()
        case "ide:format":
            formatCurrent()
            autosaveCurrent()
        case "ide:refresh-project":
            scanProjectFiles()
        case "ide:refresh-git":
            refreshGitChanges()
        case "ide:scan-problems":
            scanProblemMarkers()
        case "ide:toggle-preview":
            showPreview.toggle()
        case "ide:toggle-terminal":
            showTerminal.toggle()
        case "ide:new-scratch":
            newScratch()
        default:
            terminal.run(command.command)
            showTerminal = true
        }
        commandPaletteQuery = ""
    }

    func commitAllChanges() {
        let trimmed = gitCommitMessage.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            status = "Add a commit message first"
            return
        }
        terminal.run("git add -A && git commit -m \(shellQuoted(trimmed))")
        gitCommitMessage = ""
        refreshGitChanges()
    }

    func shellQuoted(_ value: String) -> String {
        "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
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
}
