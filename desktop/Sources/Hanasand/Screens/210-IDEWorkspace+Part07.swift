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

extension IDEWorkspace {

    var editorPane: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                BrowserAgentField(
                    title: "Find",
                    text: $model.editorFindText,
                    placeholder: "Search buffer"
                )
                BrowserAgentField(
                    title: "Replace",
                    text: $model.editorReplaceText,
                    placeholder: "Replacement"
                )
                Text("\(model.findMatchCount) matches")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(theme.textTertiary)
                BrowserAgentButton(title: "Replace all", icon: "arrow.triangle.2.circlepath") {
                    model.replaceAllMatches()
                }
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(theme.commandBar.opacity(0.72))

            if !model.inlineDiff.isEmpty {
                IDEInlineDiffView(title: model.inlineDiffTitle, diff: model.inlineDiff, hunks: model.inlineDiffHunks) {
                    model.inlineDiff = ""
                } jumpToLine: { line in
                    model.highlight(line: line)
                }
                .frame(maxHeight: 190)
            }

            HStack(alignment: .top, spacing: 0) {
                ScrollView {
                    VStack(alignment: .trailing, spacing: 0) {
                        ForEach(1...model.editorLineCount, id: \.self) { line in
                            Text("\(line)")
                                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                                .foregroundStyle(model.highlightedLine == line ? theme.text : theme.textTertiary)
                                .frame(width: 46, height: 20, alignment: .trailing)
                                .padding(.trailing, 8)
                                .background(model.highlightedLine == line ? theme.accent.opacity(0.34) : Color.clear)
                        }
                    }
                    .padding(.top, 15)
                    .padding(.bottom, 12)
                }
                .frame(width: 56)
                .background(theme.commandBar.opacity(0.62))

                HanasandCodeEditor(text: $model.editorText, highlightedLine: model.highlightedLine)
                    .background(theme.background)
                    .onChange(of: model.editorText) { _, _ in
                        model.runDiagnostics()
                        model.autosaveCurrent()
                    }
            }

            if model.showSyntaxPreview {
                IDEHighlightedCodeView(code: model.editorText, plugin: model.selectedPlugin)
                    .frame(maxHeight: 170)
            }

            HStack(spacing: 10) {
                Label("\(model.editorText.count) chars", systemImage: "textformat.size")
                Label(model.autosaveState, systemImage: model.autosaveState.contains("failed") ? "exclamationmark.triangle" : "externaldrive.badge.checkmark")
                    .foregroundStyle(model.autosaveState.contains("failed") ? theme.danger : theme.textTertiary)
                if let diskPath = model.selectedFile?.diskPath {
                    Label(diskPath, systemImage: "internaldrive")
                        .lineLimit(1)
                }
                if model.selectedDiskFileChangedExternally {
                    Label("Changed on disk", systemImage: "exclamationmark.triangle")
                        .foregroundStyle(theme.danger)
                }
                Label(model.selectedPlugin.formatter, systemImage: "puzzlepiece.extension")
                ForEach(model.diagnostics, id: \.self) { diagnostic in
                    Label(diagnostic, systemImage: diagnostic == "No diagnostics." ? "checkmark.circle" : "exclamationmark.triangle")
                }
                Spacer()
                Button(model.showSyntaxPreview ? "Hide syntax" : "Show syntax") {
                    model.showSyntaxPreview.toggle()
                    model.persistWorkspaceState()
                }
                .buttonStyle(.plain)
            }
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(theme.textTertiary)
            .padding(.horizontal, 12)
            .frame(height: 30)
            .background(theme.commandBar.opacity(0.62))
        }
    }
}
