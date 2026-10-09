import AppKit
import Combine
import Foundation
import SwiftUI


extension IDEWorkspaceModel {
    func openRequest(_ request: IDEOpenRequest) {
        scanProjectFiles()
        let requestURL = URL(fileURLWithPath: request.path)
        let candidates = [
            request.path,
            projectFiles.first { $0.absolutePath == request.path }?.absolutePath,
            projectFiles.first { $0.relativePath == request.path }?.absolutePath,
            projectFiles.first { $0.name == requestURL.lastPathComponent }?.absolutePath,
            projectFiles.first { $0.relativePath.hasSuffix(request.path) }?.absolutePath,
        ].compactMap { $0 }
        guard let path = candidates.first(where: { FileManager.default.fileExists(atPath: $0) }) else {
            status = "Could not find \(request.path)"
            return
        }
        importLocalFile(URL(fileURLWithPath: path))
        if request.revealDiff {
            loadInlineDiff(for: path)
        }
        if let line = request.line {
            highlight(line: line)
        }
    }

    func highlight(line: Int) {
        let target = max(1, min(line, editorLineCount))
        highlightedLine = target
        status = "Highlighted line \(target)"
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 3_200_000_000)
            await MainActor.run {
                if self?.highlightedLine == target {
                    self?.highlightedLine = nil
                }
            }
        }
    }

    func loadInlineDiff(for path: String) {
        let root = terminal.cwd
        let absolute = URL(fileURLWithPath: path).path
        let relative = absolute.hasPrefix(root + "/") ? String(absolute.dropFirst(root.count + 1)) : absolute
        inlineDiffTitle = "Diff · \(URL(fileURLWithPath: path).lastPathComponent)"
        inlineDiff = Self.executeShell("git diff -- \(shellQuoted(relative))", cwd: root)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if inlineDiff.isEmpty {
            inlineDiff = "No unstaged diff for \(relative)."
        }
        inlineDiffHunks = Self.diffHunks(from: inlineDiff)
        showTerminal = false
        status = "Loaded inline diff for \(relative)"
    }

    nonisolated static func diffHunks(from diff: String) -> [IDEDiffHunk] {
        guard let regex = try? NSRegularExpression(pattern: #"@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@"#) else { return [] }
        let range = NSRange(diff.startIndex..<diff.endIndex, in: diff)
        return regex.matches(in: diff, range: range).compactMap { match in
            guard let lineRange = Range(match.range(at: 1), in: diff),
                  let line = Int(diff[lineRange]),
                  let titleRange = Range(match.range(at: 0), in: diff) else { return nil }
            return IDEDiffHunk(title: String(diff[titleRange]), newLine: line)
        }
    }

    func togglePin(_ file: IDEShareFile) {
        if pinnedFileIDs.contains(file.id) {
            pinnedFileIDs.remove(file.id)
        } else {
            pinnedFileIDs.insert(file.id)
        }
        persistSession()
    }

    func scanProjectFiles() {
        let root = URL(fileURLWithPath: terminal.cwd, isDirectory: true)
        guard !hanasandIsDesktopProtectedPath(root.path) else {
            projectFiles = []
            projectStatus = "Desktop folder is not scanned automatically. Open specific files when needed."
            return
        }
        let skipDirectories: Set<String> = [".git", ".build", "node_modules", "dist", "build", ".next", ".expo", "DerivedData"]
        let allowedExtensions: Set<String> = ["swift", "ts", "tsx", "js", "jsx", "mjs", "json", "md", "mdx", "sh", "zsh", "bash", "py", "css", "html", "txt", "yml", "yaml", "toml", "env", "gitignore"]
        let keys: [URLResourceKey] = [.isDirectoryKey, .fileSizeKey]
        guard let enumerator = FileManager.default.enumerator(
            at: root,
            includingPropertiesForKeys: keys,
            options: [.skipsHiddenFiles, .skipsPackageDescendants]
        ) else {
            projectStatus = "Could not scan \(root.path)"
            return
        }

        var next: [IDEProjectFile] = []
        for case let url as URL in enumerator {
            if next.count >= 160 { break }
            let values = try? url.resourceValues(forKeys: Set(keys))
            if values?.isDirectory == true {
                if skipDirectories.contains(url.lastPathComponent) {
                    enumerator.skipDescendants()
                }
                continue
            }
            let ext = url.pathExtension.lowercased()
            let name = url.lastPathComponent
            guard allowedExtensions.contains(ext) || allowedExtensions.contains(name) else { continue }
            if let size = values?.fileSize, size > 512_000 { continue }
            let relative = url.path.replacingOccurrences(of: root.path + "/", with: "")
            next.append(IDEProjectFile(
                id: url.path,
                name: name,
                relativePath: relative,
                absolutePath: url.path,
                icon: iconName(for: ext)
            ))
        }
        projectFiles = next.sorted { $0.relativePath.localizedCaseInsensitiveCompare($1.relativePath) == .orderedAscending }
        projectStatus = "\(projectFiles.count) files in \(root.lastPathComponent)"
    }

    func scanProblemMarkers() {
        let markers = ["TODO", "FIXME", "HACK", "XXX", "fatalError(", "print(\"DEBUG", "console.log(", "debugger"]
        var next: [IDEProblemMarker] = []
        for file in projectFiles.prefix(120) {
            guard next.count < 80,
                  let content = try? String(contentsOfFile: file.absolutePath, encoding: .utf8) else { continue }
            for (index, line) in content.components(separatedBy: .newlines).enumerated() {
                guard let marker = markers.first(where: { line.localizedCaseInsensitiveContains($0) }) else { continue }
                let severity = ["fatalError(", "debugger"].contains(marker) ? "error" : "warning"
                next.append(IDEProblemMarker(
                    id: "\(file.absolutePath):\(index + 1):\(marker)",
                    label: marker,
                    detail: line.trimmingCharacters(in: .whitespaces),
                    filePath: file.absolutePath,
                    line: index + 1,
                    severity: severity
                ))
                if next.count >= 80 { break }
            }
        }
        problemMarkers = next
        problemsSummary = next.isEmpty ? "No markers found" : "\(next.count) markers found"
    }

    func openProblemMarker(_ marker: IDEProblemMarker) {
        importLocalFile(URL(fileURLWithPath: marker.filePath))
        editorFindText = marker.detail.isEmpty ? marker.label : marker.detail
        status = "Opened \(URL(fileURLWithPath: marker.filePath).lastPathComponent):\(marker.line)"
    }

    func refreshGitChanges() {
        let root = terminal.cwd
        Task {
            let output = await Task.detached {
                Self.executeShell("git status --porcelain", cwd: root)
            }.value
            await MainActor.run {
                let parsed = output
                    .components(separatedBy: .newlines)
                    .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
                    .map { line -> IDEGitChange in
                        let status = String(line.prefix(2)).trimmingCharacters(in: .whitespaces)
                        let rawPath = String(line.dropFirst(min(3, line.count)))
                        let path = rawPath.components(separatedBy: " -> ").last ?? rawPath
                        return IDEGitChange(
                            id: path,
                            status: status.isEmpty ? "M" : status,
                            path: path,
                            absolutePath: URL(fileURLWithPath: root).appendingPathComponent(path).path
                        )
                    }
                gitChanges = parsed
                gitSummary = parsed.isEmpty ? "Clean working tree" : "\(parsed.count) changed files"
                gitCommitPreview = Self.gitCommitPreview(for: parsed)
            }
        }
    }
}
