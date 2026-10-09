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

    func previewChangedFile(_ rawPath: String) {
        let resolvedPath = resolveWorkspacePath(rawPath)
        if FileManager.default.fileExists(atPath: resolvedPath) {
            NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: resolvedPath)])
            append(meta: "Preview", body: "Revealed \(resolvedPath)", kind: .command)
        } else {
            openInlineBrowser(url: rawPath, title: URL(fileURLWithPath: rawPath).lastPathComponent, source: "File preview")
        }
    }

    func resolveWorkspacePath(_ rawPath: String) -> String {
        let clean = rawPath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return clean }
        if clean.hasPrefix("/") { return clean }
        let roots = [
            FileManager.default.currentDirectoryPath,
            "/Users/eirikhanasand/Desktop/personal/hanasand",
            status.cwd,
        ]
        for root in roots where !root.isEmpty {
            let candidate = URL(fileURLWithPath: root, isDirectory: true).appendingPathComponent(clean).path
            if FileManager.default.fileExists(atPath: candidate) {
                return candidate
            }
        }
        return URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true).appendingPathComponent(clean).path
    }
}
