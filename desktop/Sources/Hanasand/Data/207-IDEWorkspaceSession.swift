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

struct IDEWorkspaceSession: Codable {
    var selectedFileID: String
    var openFileIDs: [String]
    var recentFileIDs: [String]
    var pinnedFileIDs: [String]
    var cwd: String?
    var showPreview: Bool?
    var showTerminal: Bool?
    var showSyntaxPreview: Bool?
    var autosaveEnabled: Bool?
    var autoformatEnabled: Bool?
}

func hanasandSafeIDEWorkspacePath() -> String {
    let fileManager = FileManager.default
    if let support = try? fileManager.url(
        for: .applicationSupportDirectory,
        in: .userDomainMask,
        appropriateFor: nil,
        create: true
    ) {
        let directory = support.appendingPathComponent("Hanasand/IDEWorkspace", isDirectory: true)
        try? fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.path
    }

    let fallback = fileManager.temporaryDirectory.appendingPathComponent("Hanasand/IDEWorkspace", isDirectory: true)
    try? fileManager.createDirectory(at: fallback, withIntermediateDirectories: true)
    return fallback.path
}

func hanasandIsDesktopProtectedPath(_ path: String) -> Bool {
    let standardized = URL(fileURLWithPath: path).standardizedFileURL.path
    let desktop = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Desktop", isDirectory: true)
        .standardizedFileURL
        .path
    return standardized == desktop || standardized.hasPrefix(desktop + "/")
}
