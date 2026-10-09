import AppKit
import Combine
import Foundation
import SwiftUI


extension IDEWorkspaceModel {
    var outlineItems: [IDEOutlineItem] {
        editorText.components(separatedBy: .newlines).enumerated().compactMap { index, line in
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("#") {
                return IDEOutlineItem(title: trimmed.trimmingCharacters(in: CharacterSet(charactersIn: "# ")), line: index + 1, icon: "textformat.size")
            }
            for keyword in ["struct ", "class ", "func ", "function ", "def ", "const ", "let "] where trimmed.hasPrefix(keyword) {
                let title = trimmed
                    .replacingOccurrences(of: "{", with: "")
                    .trimmingCharacters(in: .whitespaces)
                return IDEOutlineItem(title: title, line: index + 1, icon: keyword.contains("func") || keyword == "def " ? "function" : "cube")
            }
            return nil
        }
    }

    var selectedSnippets: [IDEQuickCommand] {
        switch selectedPlugin.id {
        case "swift":
            return [
                IDEQuickCommand(title: "View", command: "struct NewView: View {\n    var body: some View {\n        Text(\"Hello\")\n    }\n}\n", icon: "swift"),
                IDEQuickCommand(title: "Task", command: "Task { @MainActor in\n    \n}\n", icon: "clock"),
                IDEQuickCommand(title: "Model", command: "@MainActor\nfinal class ViewModel: ObservableObject {\n    @Published var status = \"Ready\"\n}\n", icon: "cube"),
            ]
        case "typescript", "javascript":
            return [
                IDEQuickCommand(title: "Async fn", command: "async function run() {\n  \n}\n", icon: "bolt"),
                IDEQuickCommand(title: "Fetch", command: "const response = await fetch(url);\nconst data = await response.json();\n", icon: "network"),
                IDEQuickCommand(title: "Test", command: "test('works', async () => {\n  expect(true).toBe(true);\n});\n", icon: "checkmark.seal"),
            ]
        case "markdown":
            return [
                IDEQuickCommand(title: "Section", command: "\n## Section\n\n", icon: "textformat.size"),
                IDEQuickCommand(title: "Checklist", command: "- [ ] Item\n- [ ] Item\n", icon: "checklist"),
                IDEQuickCommand(title: "Code", command: "```swift\n\n```\n", icon: "curlybraces"),
            ]
        case "shell":
            return [
                IDEQuickCommand(title: "Safe shell", command: "set -euo pipefail\n\n", icon: "terminal"),
                IDEQuickCommand(title: "Loop", command: "for file in \"$@\"; do\n  echo \"$file\"\ndone\n", icon: "repeat"),
            ]
        default:
            return [
                IDEQuickCommand(title: "Note", command: "\n# Note\n\n", icon: "note.text"),
                IDEQuickCommand(title: "TODO", command: "TODO: ", icon: "checkmark.circle"),
            ]
        }
    }

    var paletteCommands: [IDEQuickCommand] {
        let editorCommands = [
            IDEQuickCommand(title: "Save draft", command: "ide:save", icon: "square.and.arrow.down"),
            IDEQuickCommand(title: "Format document", command: "ide:format", icon: "wand.and.stars"),
            IDEQuickCommand(title: "Refresh project", command: "ide:refresh-project", icon: "arrow.clockwise"),
            IDEQuickCommand(title: "Refresh git", command: "ide:refresh-git", icon: "waveform.path.ecg"),
            IDEQuickCommand(title: "Scan problems", command: "ide:scan-problems", icon: "exclamationmark.triangle"),
            IDEQuickCommand(title: "Toggle preview", command: "ide:toggle-preview", icon: "rectangle.rightthird.inset.filled"),
            IDEQuickCommand(title: "Toggle terminal", command: "ide:toggle-terminal", icon: "terminal"),
            IDEQuickCommand(title: "New scratch", command: "ide:new-scratch", icon: "plus"),
        ]
        let snippetCommands = selectedSnippets.map {
            IDEQuickCommand(title: "Insert \($0.title)", command: "snippet:\($0.command)", icon: $0.icon)
        }
        let all = editorCommands + currentFileRunCommands + workspaceTasks + quickCommands + snippetCommands
        let query = commandPaletteQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return all }
        return all.filter {
            $0.title.localizedCaseInsensitiveContains(query)
                || $0.command.localizedCaseInsensitiveContains(query)
        }
    }

    func configure(settings: HanasandDesktopSettings) {
        guard files.isEmpty else { return }
        if let data = UserDefaults.standard.data(forKey: draftKey),
           let decoded = try? JSONDecoder().decode([String: String].self, from: data) {
            drafts = decoded
            savedSnapshots = decoded
        }
        let base = settings.websiteBaseURL.normalizedBaseURL
        let sharesURL = base.appendingPathComponent("s").absoluteString
        previewTab = BrowserTabState(label: "Shares", url: sharesURL)
        terminal.cwd = hanasandSafeIDEWorkspacePath()
        codePlugins = Self.defaultCodePlugins()
        enabledPluginIDs = Set(codePlugins.map(\.id))
        files = [
            IDEShareFile(
                id: "shares-index",
                title: "shares.index",
                path: "/s",
                language: "Share map",
                icon: "square.grid.2x2",
                seed: """
                // Hanasand Shares
                // Source: \(sharesURL)

                workspace {
                  preview: "\(sharesURL)"
                  purpose: "Browse, inspect, and edit share-backed work in one native surface."
                }
                """
            ),
            IDEShareFile(
                id: "public-site",
                title: "hanasand.site",
                path: "/",
                language: "Web",
                icon: "globe",
                seed: """
                // Public site share
                open("\(base.absoluteString)")

                notes:
                - Keep previews inside the app when possible.
                - Use the terminal for local checks and deploy helpers.
                """
            ),
            IDEShareFile(
                id: "dashboard",
                title: "dashboard.share",
                path: "/dashboard",
                language: "Ops",
                icon: "gauge.with.dots.needle",
                seed: """
                // Dashboard share
                route: /dashboard
                mode: native-first

                actions:
                - inspect page controls
                - run local terminal commands
                - keep browser preview docked
                """
            ),
            IDEShareFile(
                id: "scratch",
                title: "scratch.md",
                path: "/s/scratch",
                language: "Markdown",
                icon: "note.text",
                seed: """
                # Scratch

                This is a native Hanasand IDE note tied to the shares workspace.
                Use it for agent plans, local command output, and quick edits.
                """
            ),
        ]
        restoreSession()
        if openFileIDs.isEmpty {
            selectedFileID = files.first?.id ?? selectedFileID
            openFileIDs = [selectedFileID]
        }
        editorText = drafts[selectedFileID] ?? selectedFile?.seed ?? files.first?.seed ?? ""
        if savedSnapshots[selectedFileID] == nil {
            savedSnapshots[selectedFileID] = editorText
        }
        scanProjectFiles()
        refreshGitChanges()
        refreshGitHistory()
        scanProblemMarkers()
    }
}
