import AppKit
import Combine
import Foundation
import SwiftUI


extension IDEWorkspaceModel {
    func select(_ file: IDEShareFile) {
        persistCurrentInMemory()
        selectedFileID = file.id
        if !openFileIDs.contains(file.id) {
            openFileIDs.append(file.id)
        }
        editorText = drafts[file.id] ?? file.seed
        if savedSnapshots[file.id] == nil {
            savedSnapshots[file.id] = editorText
        }
        status = "\(file.path) selected"
        remember(file)
        persistSession()
        runDiagnostics()
    }

    func preview(_ file: IDEShareFile, settings: HanasandDesktopSettings) {
        let base = settings.websiteBaseURL.normalizedBaseURL
        let trimmed = file.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let url = trimmed.isEmpty ? base.absoluteString : base.appendingPathComponent(trimmed).absoluteString
        previewTab?.load(url)
        status = "Previewing \(file.path)"
    }

    func closeTab(_ file: IDEShareFile) {
        guard openFileIDs.count > 1 else { return }
        persistCurrentInMemory()
        openFileIDs.removeAll { $0 == file.id }
        if selectedFileID == file.id, let next = openFiles.last {
            selectedFileID = next.id
            editorText = drafts[next.id] ?? next.seed
            if savedSnapshots[next.id] == nil {
                savedSnapshots[next.id] = editorText
            }
        }
        persistSession()
    }

    func saveCurrent() {
        if autoformatEnabled {
            formatCurrent()
        }
        persistCurrentInMemory()
        if let encoded = try? JSONEncoder().encode(drafts) {
            UserDefaults.standard.set(encoded, forKey: draftKey)
        }
        if let diskPath = selectedFile?.diskPath {
            do {
                autosaveState = "Saving..."
                try editorText.write(toFile: diskPath, atomically: true, encoding: .utf8)
                if let index = files.firstIndex(where: { $0.id == selectedFileID }) {
                    files[index].diskModifiedAt = (try? FileManager.default.attributesOfItem(atPath: diskPath)[.modificationDate] as? Date) ?? Date()
                }
            } catch {
                status = error.localizedDescription
                autosaveState = "Disk save failed"
                return
            }
        }
        savedSnapshots[selectedFileID] = editorText
        lastAutosavedAt = Date()
        autosaveState = "Saved just now"
        status = "\(selectedFile?.title ?? "File") saved locally"
        runDiagnostics()
    }

    func exportCurrent(to url: URL) {
        do {
            if autoformatEnabled {
                formatCurrent()
            }
            try editorText.write(to: url, atomically: true, encoding: .utf8)
            savedSnapshots[selectedFileID] = editorText
            if let index = files.firstIndex(where: { $0.id == selectedFileID }) {
                files[index].diskModifiedAt = (try? FileManager.default.attributesOfItem(atPath: url.path)[.modificationDate] as? Date) ?? Date()
                files[index].diskPath = url.path
            }
            status = "Wrote \(url.lastPathComponent)"
        } catch {
            status = error.localizedDescription
        }
    }

    func resetCurrent() {
        guard let selectedFile else { return }
        drafts[selectedFile.id] = selectedFile.seed
        editorText = selectedFile.seed
        saveCurrent()
        status = "\(selectedFile.title) reset"
    }

    func discardUnsavedChanges() {
        let restored = savedSnapshots[selectedFileID] ?? selectedFile?.seed ?? ""
        editorText = restored
        drafts[selectedFileID] = restored
        status = "Discarded unsaved changes"
        runDiagnostics()
    }

    func newScratch() {
        persistCurrentInMemory()
        let count = files.filter { $0.id.hasPrefix("scratch-") }.count + 1
        let file = IDEShareFile(
            id: "scratch-\(count)",
            title: "scratch-\(count).md",
            path: "/s/scratch-\(count)",
            language: "Markdown",
            icon: "square.and.pencil",
            seed: "# Scratch \(count)\n\n"
        )
        files.append(file)
        drafts[file.id] = file.seed
        select(file)
        saveCurrent()
    }

    func importLocalFile(_ url: URL) {
        do {
            let text = try String(contentsOf: url, encoding: .utf8)
            let modifiedAt = (try? FileManager.default.attributesOfItem(atPath: url.path)[.modificationDate] as? Date) ?? Date()
            persistCurrentInMemory()
            let file = IDEShareFile(
                id: "local-\(url.path.hashValue)",
                title: url.lastPathComponent,
                path: url.path,
                language: languageName(for: url.pathExtension),
                icon: iconName(for: url.pathExtension),
                seed: text,
                diskPath: url.path,
                diskModifiedAt: modifiedAt
            )
            if let existingIndex = files.firstIndex(where: { $0.id == file.id }) {
                files[existingIndex] = file
            } else {
                files.append(file)
            }
            drafts[file.id] = text
            savedSnapshots[file.id] = text
            select(file)
            saveCurrent()
        } catch {
            status = error.localizedDescription
        }
    }

    func reloadCurrentFromDisk() {
        guard let selectedFile, let diskPath = selectedFile.diskPath else {
            status = "Current file is not backed by disk"
            return
        }
        do {
            let url = URL(fileURLWithPath: diskPath)
            let text = try String(contentsOf: url, encoding: .utf8)
            editorText = text
            drafts[selectedFile.id] = text
            savedSnapshots[selectedFile.id] = text
            if let index = files.firstIndex(where: { $0.id == selectedFile.id }) {
                files[index].diskModifiedAt = (try? FileManager.default.attributesOfItem(atPath: diskPath)[.modificationDate] as? Date) ?? Date()
            }
            status = "Reloaded \(url.lastPathComponent)"
            runDiagnostics()
        } catch {
            status = error.localizedDescription
        }
    }

    func checkCurrentDiskState() {
        guard selectedFile?.diskPath != nil else {
            status = "Current file is draft-only"
            return
        }
        status = selectedDiskFileChangedExternally ? "Disk file changed externally" : "Disk file is current"
    }

    func openProjectFile(_ file: IDEProjectFile) {
        importLocalFile(URL(fileURLWithPath: file.absolutePath))
    }
}
