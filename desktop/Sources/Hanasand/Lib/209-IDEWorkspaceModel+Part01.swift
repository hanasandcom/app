import AppKit
import Combine
import Foundation
import SwiftUI


extension IDEWorkspaceModel {
    var selectedFile: IDEShareFile? {
        files.first { $0.id == selectedFileID } ?? files.first
    }

    var filteredFiles: [IDEShareFile] {
        let trimmed = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return files }
        return files.filter {
            $0.title.localizedCaseInsensitiveContains(trimmed)
                || $0.path.localizedCaseInsensitiveContains(trimmed)
                || $0.language.localizedCaseInsensitiveContains(trimmed)
        }
    }

    var openFiles: [IDEShareFile] {
        openFileIDs.compactMap { id in files.first { $0.id == id } }
    }

    var recentFiles: [IDEShareFile] {
        recentFileIDs.compactMap { id in files.first { $0.id == id } }
    }

    var pinnedFiles: [IDEShareFile] {
        files.filter { pinnedFileIDs.contains($0.id) }
    }

    var isDirty: Bool {
        editorText != (savedSnapshots[selectedFileID] ?? selectedFile?.seed ?? "")
    }

    var selectedDiskFileChangedExternally: Bool {
        guard let selectedFile, let diskPath = selectedFile.diskPath else { return false }
        guard let currentDate = try? FileManager.default.attributesOfItem(atPath: diskPath)[.modificationDate] as? Date else { return false }
        guard let storedDate = selectedFile.diskModifiedAt else { return false }
        return currentDate > storedDate.addingTimeInterval(0.5)
    }

    var selectedFileStorageLabel: String {
        guard selectedFile?.diskPath != nil else {
            return isDirty ? "Unsaved local draft" : "Saved local draft"
        }
        return isDirty ? "Unsaved disk draft" : "Saved disk file"
    }

    var selectedFileModeLabel: String {
        selectedFile?.diskPath == nil ? "local draft" : "disk-backed file"
    }

    var quickCommands: [IDEQuickCommand] {
        [
            IDEQuickCommand(title: "Status", command: "git status --short", icon: "waveform.path.ecg"),
            IDEQuickCommand(title: "Pull", command: "git pull --ff-only", icon: "arrow.down.circle"),
            IDEQuickCommand(title: "Push", command: "git push", icon: "arrow.up.circle"),
            IDEQuickCommand(title: "Build desktop", command: "cd app/desktop && swift build", icon: "hammer"),
            IDEQuickCommand(title: "List shares", command: "curl -I -s https://hanasand.com/s", icon: "network"),
            IDEQuickCommand(title: "Files", command: "find . -maxdepth 2 -type f | head -80", icon: "doc.text.magnifyingglass"),
        ]
    }

    var workspaceTasks: [IDEQuickCommand] {
        let root = URL(fileURLWithPath: terminal.cwd, isDirectory: true)
        let packageJSON = root.appendingPathComponent("package.json").path
        let bunLock = root.appendingPathComponent("bun.lock").path
        let packageSwift = root.appendingPathComponent("Package.swift").path
        let dockerCompose = root.appendingPathComponent("docker-compose.yml").path
        var tasks: [IDEQuickCommand] = []

        if FileManager.default.fileExists(atPath: packageSwift) {
            tasks.append(IDEQuickCommand(title: "Swift build", command: "swift build", icon: "swift"))
            tasks.append(IDEQuickCommand(title: "Swift test", command: "swift test", icon: "checkmark.seal"))
        }
        if FileManager.default.fileExists(atPath: packageJSON) {
            let runner = FileManager.default.fileExists(atPath: bunLock) ? "bun" : "npm"
            tasks.append(IDEQuickCommand(title: "\(runner) install", command: "\(runner) install", icon: "tray.and.arrow.down"))
            tasks.append(IDEQuickCommand(title: "\(runner) build", command: "\(runner) run build", icon: "hammer"))
            tasks.append(IDEQuickCommand(title: "\(runner) test", command: "\(runner) test", icon: "checkmark.seal"))
        }
        if FileManager.default.fileExists(atPath: dockerCompose) {
            tasks.append(IDEQuickCommand(title: "Compose up", command: "docker compose up --build", icon: "shippingbox"))
            tasks.append(IDEQuickCommand(title: "Compose ps", command: "docker compose ps", icon: "list.bullet.rectangle"))
        }
        if tasks.isEmpty {
            tasks = [
                IDEQuickCommand(title: "List files", command: "find . -maxdepth 2 -type f | head -80", icon: "doc.text.magnifyingglass"),
                IDEQuickCommand(title: "Disk", command: "pwd && du -sh .", icon: "internaldrive"),
            ]
        }
        return tasks
    }

    var currentFileRunCommands: [IDEQuickCommand] {
        guard let file = selectedFile, let path = file.diskPath else { return [] }
        let quotedPath = shellQuoted(path)
        let ext = URL(fileURLWithPath: path).pathExtension.lowercased()
        let root = URL(fileURLWithPath: terminal.cwd, isDirectory: true)
        let hasBun = FileManager.default.fileExists(atPath: root.appendingPathComponent("bun.lock").path)

        switch ext {
        case "swift":
            return [
                IDEQuickCommand(title: "Run Swift file", command: "swift \(quotedPath)", icon: "swift"),
                IDEQuickCommand(title: "Typecheck Swift", command: "swiftc -typecheck \(quotedPath)", icon: "checkmark.seal"),
            ]
        case "js", "mjs":
            return [
                IDEQuickCommand(title: "Run JS file", command: "\(hasBun ? "bun" : "node") \(quotedPath)", icon: "play.fill"),
            ]
        case "ts", "tsx":
            return [
                IDEQuickCommand(title: "Run TS file", command: "\(hasBun ? "bun" : "npx tsx") \(quotedPath)", icon: "play.fill"),
            ]
        case "py":
            return [
                IDEQuickCommand(title: "Run Python file", command: "python3 \(quotedPath)", icon: "play.fill"),
            ]
        case "sh", "bash", "zsh":
            return [
                IDEQuickCommand(title: "Run shell file", command: "zsh \(quotedPath)", icon: "terminal"),
                IDEQuickCommand(title: "Check shell syntax", command: "zsh -n \(quotedPath)", icon: "checkmark.seal"),
            ]
        case "json":
            return [
                IDEQuickCommand(title: "Validate JSON", command: "python3 -m json.tool \(quotedPath) >/dev/null", icon: "checkmark.seal"),
            ]
        case "md", "mdx":
            return [
                IDEQuickCommand(title: "Preview Markdown text", command: "sed -n '1,120p' \(quotedPath)", icon: "text.alignleft"),
            ]
        default:
            return [
                IDEQuickCommand(title: "Print file", command: "sed -n '1,120p' \(quotedPath)", icon: "doc.text.magnifyingglass"),
            ]
        }
    }

    var selectedPlugin: IDECodePlugin {
        let language = selectedFile?.language.lowercased() ?? ""
        let extensionMatch = selectedFile?.title.split(separator: ".").last.map(String.init) ?? ""
        return codePlugins.first {
            enabledPluginIDs.contains($0.id) && ($0.language.lowercased() == language || $0.extensions.contains(extensionMatch))
        } ?? codePlugins.first {
            $0.id == "plaintext"
        } ?? Self.plainTextPlugin
    }

    var filteredProjectFiles: [IDEProjectFile] {
        let trimmed = projectFileFilter.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return projectFiles }
        return projectFiles.filter {
            $0.name.localizedCaseInsensitiveContains(trimmed)
                || $0.relativePath.localizedCaseInsensitiveContains(trimmed)
        }
    }

    var findMatchCount: Int {
        let needle = editorFindText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !needle.isEmpty else { return 0 }
        return editorText.lowercased().components(separatedBy: needle.lowercased()).count - 1
    }

    var editorLineCount: Int {
        max(1, editorText.components(separatedBy: .newlines).count)
    }
}
