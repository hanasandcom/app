import AppKit
import Combine
import Foundation
import SwiftUI


@MainActor
final class IDEWorkspaceModel: ObservableObject {
    @Published var files: [IDEShareFile] = []
    @Published var selectedFileID = "shares-index"
    @Published var openFileIDs: [String] = []
    @Published var editorText = ""
    @Published var status = "Native scratch workspace ready"
    @Published var drafts: [String: String] = [:]
    @Published var savedSnapshots: [String: String] = [:]
    @Published var searchText = ""
    @Published var showPreview = false
    @Published var showTerminal = false
    @Published var showSyntaxPreview = false
    @Published var autosaveEnabled = true
    @Published var autoformatEnabled = true
    @Published var diagnostics: [String] = ["No diagnostics yet."]
    @Published var codePlugins: [IDECodePlugin] = []
    @Published var enabledPluginIDs: Set<String> = []
    @Published var projectFiles: [IDEProjectFile] = []
    @Published var projectFileFilter = ""
    @Published var projectStatus = "Project not scanned"
    @Published var editorFindText = ""
    @Published var editorReplaceText = ""
    @Published var gitCommitMessage = ""
    @Published var gitChanges: [IDEGitChange] = []
    @Published var gitSummary = "Git not refreshed"
    @Published var gitCommitPreview = "Refresh Git to preview commit contents."
    @Published var gitHistory: [IDEGitHistoryEntry] = []
    @Published var gitHistorySummary = "History not refreshed"
    @Published var commandPaletteQuery = ""
    @Published var problemMarkers: [IDEProblemMarker] = []
    @Published var problemsSummary = "Problems not scanned"
    @Published var recentFileIDs: [String] = []
    @Published var pinnedFileIDs: Set<String> = []
    @Published var highlightedLine: Int?
    @Published var inlineDiff = ""
    @Published var inlineDiffTitle = "Inline diff"
    @Published var inlineDiffHunks: [IDEDiffHunk] = []
    @Published var autosaveState = "Autosave ready"
    @Published var lastAutosavedAt: Date?

    var terminal = IDETerminalModel()
    var previewTab: BrowserTabState?
    let draftKey = "hanasand.desktop.ide.drafts"
    let sessionKey = "hanasand.desktop.ide.session"
    var autosaveTask: Task<Void, Never>?

}
