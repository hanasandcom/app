import AppKit
import Combine
import Foundation
import SwiftUI


extension IDEWorkspaceModel {
    func formatCurrent() {
        let plugin = selectedPlugin
        switch plugin.id {
        case "json":
            if let data = editorText.data(using: .utf8),
               let object = try? JSONSerialization.jsonObject(with: data),
               let pretty = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys]),
               let formatted = String(data: pretty, encoding: .utf8) {
                editorText = formatted + "\n"
            }
        case "markdown":
            editorText = editorText
                .components(separatedBy: .newlines)
                .map { $0.trimmingCharacters(in: .whitespaces) }
                .joined(separator: "\n")
        case "shell", "swift", "typescript", "javascript", "css", "html", "python":
            editorText = editorText
                .components(separatedBy: .newlines)
                .map { $0.replacingOccurrences(of: "\t", with: "    ").trimmingCharacters(in: .whitespaces) }
                .joined(separator: "\n")
        default:
            editorText = editorText.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if !editorText.hasSuffix("\n") {
            editorText += "\n"
        }
        status = "Formatted with \(plugin.language)"
        runDiagnostics()
    }

    static func defaultCodePlugins() -> [IDECodePlugin] {
        [
            IDECodePlugin(id: "swift", language: "Swift", icon: "swift", extensions: ["swift"], formatter: "swift-format", diagnostics: ["Swift plugin: actors, async, and SwiftUI hints enabled."]),
            IDECodePlugin(id: "typescript", language: "TypeScript", icon: "chevron.left.forwardslash.chevron.right", extensions: ["ts", "tsx"], formatter: "prettier", diagnostics: ["TypeScript plugin: import and type-shape checks enabled."]),
            IDECodePlugin(id: "javascript", language: "JavaScript", icon: "curlybraces", extensions: ["js", "jsx", "mjs"], formatter: "prettier", diagnostics: ["JavaScript plugin: module syntax checks enabled."]),
            IDECodePlugin(id: "json", language: "JSON", icon: "list.bullet.rectangle", extensions: ["json"], formatter: "JSON pretty printer", diagnostics: ["JSON plugin: pretty-print and parse validation enabled."]),
            IDECodePlugin(id: "markdown", language: "Markdown", icon: "text.alignleft", extensions: ["md", "mdx"], formatter: "markdown tidy", diagnostics: ["Markdown plugin: heading and whitespace cleanup enabled."]),
            IDECodePlugin(id: "shell", language: "Shell", icon: "terminal", extensions: ["sh", "zsh", "bash"], formatter: "shfmt-style", diagnostics: ["Shell plugin: command snippets and terminal handoff enabled."]),
            IDECodePlugin(id: "python", language: "Python", icon: "ellipsis.curlybraces", extensions: ["py"], formatter: "black-style", diagnostics: ["Python plugin: indentation normalization enabled."]),
            IDECodePlugin(id: "css", language: "CSS", icon: "paintpalette", extensions: ["css"], formatter: "prettier", diagnostics: ["CSS plugin: selector and spacing cleanup enabled."]),
            IDECodePlugin(id: "html", language: "HTML", icon: "globe", extensions: ["html"], formatter: "prettier", diagnostics: ["HTML plugin: tag and attribute highlighting enabled."]),
            plainTextPlugin,
        ]
    }

    static let plainTextPlugin = IDECodePlugin(id: "plaintext", language: "Plain Text", icon: "doc.plaintext", extensions: ["txt", "share", "site", "index"], formatter: "trim", diagnostics: ["Plain-text plugin: whitespace cleanup enabled."])

    func languageName(for ext: String) -> String {
        codePlugins.first { $0.extensions.contains(ext.lowercased()) }?.language ?? "Plain Text"
    }

    func iconName(for ext: String) -> String {
        codePlugins.first { $0.extensions.contains(ext.lowercased()) }?.icon ?? "doc.plaintext"
    }

    func persistCurrentInMemory() {
        drafts[selectedFileID] = editorText
    }

    func remember(_ file: IDEShareFile) {
        recentFileIDs.removeAll { $0 == file.id }
        recentFileIDs.insert(file.id, at: 0)
        recentFileIDs = Array(recentFileIDs.prefix(10))
    }

    func restoreSession() {
        guard let data = UserDefaults.standard.data(forKey: sessionKey),
              let session = try? JSONDecoder().decode(IDEWorkspaceSession.self, from: data) else { return }
        let validIDs = Set(files.map(\.id))
        openFileIDs = session.openFileIDs.filter { validIDs.contains($0) }
        recentFileIDs = session.recentFileIDs.filter { validIDs.contains($0) }
        pinnedFileIDs = Set(session.pinnedFileIDs.filter { validIDs.contains($0) })
        if validIDs.contains(session.selectedFileID) {
            selectedFileID = session.selectedFileID
        }
        if let cwd = session.cwd,
           !hanasandIsDesktopProtectedPath(cwd),
           FileManager.default.fileExists(atPath: cwd) {
            terminal.cwd = cwd
        }
        showPreview = session.showPreview ?? showPreview
        showTerminal = session.showTerminal ?? showTerminal
        showSyntaxPreview = session.showSyntaxPreview ?? showSyntaxPreview
        autosaveEnabled = session.autosaveEnabled ?? autosaveEnabled
        autoformatEnabled = session.autoformatEnabled ?? autoformatEnabled
    }

    func persistSession() {
        let session = IDEWorkspaceSession(
            selectedFileID: selectedFileID,
            openFileIDs: openFileIDs,
            recentFileIDs: recentFileIDs,
            pinnedFileIDs: Array(pinnedFileIDs),
            cwd: terminal.cwd,
            showPreview: showPreview,
            showTerminal: showTerminal,
            showSyntaxPreview: showSyntaxPreview,
            autosaveEnabled: autosaveEnabled,
            autoformatEnabled: autoformatEnabled
        )
        if let encoded = try? JSONEncoder().encode(session) {
            UserDefaults.standard.set(encoded, forKey: sessionKey)
        }
    }

    func persistWorkspaceState() {
        persistSession()
    }
}
