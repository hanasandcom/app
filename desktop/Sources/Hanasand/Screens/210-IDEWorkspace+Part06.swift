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

    var ideHeader: some View {
        HStack(spacing: 10) {
            if let file = model.selectedFile {
                Label(file.title, systemImage: file.icon)
                    .font(.system(size: 13, weight: .black))
                Text(file.language)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(theme.textTertiary)
                    .padding(.horizontal, 8)
                    .frame(height: 22)
                    .background(theme.card)
                    .clipShape(Capsule())
            }
            Spacer()
            Text(model.status)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(theme.textTertiary)
            if let runCommand = model.currentFileRunCommands.first {
                BrowserAgentButton(title: runCommand.title, icon: runCommand.icon) {
                    model.terminal.run(runCommand.command)
                    model.showTerminal = true
                }
            }
            BrowserAgentButton(title: "Save", icon: "square.and.arrow.down") {
                model.saveCurrent()
            }
            BrowserAgentButton(title: "Save disk", icon: "internaldrive") {
                if let path = model.selectedFile?.diskPath {
                    model.exportCurrent(to: URL(fileURLWithPath: path))
                } else {
                    exportCurrentFile()
                }
            }
            if model.selectedFile?.diskPath != nil {
                BrowserAgentButton(title: "Copy path", icon: "doc.on.doc") {
                    if let path = model.selectedFile?.diskPath {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(path, forType: .string)
                    }
                }
                BrowserAgentButton(title: "Reveal", icon: "folder") {
                    if let path = model.selectedFile?.diskPath {
                        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
                    }
                }
                BrowserAgentButton(title: "Check disk", icon: "externaldrive.badge.questionmark") {
                    model.checkCurrentDiskState()
                }
                BrowserAgentButton(title: "Reload disk", icon: "arrow.clockwise") {
                    model.reloadCurrentFromDisk()
                }
            }
            BrowserAgentButton(title: "Format", icon: "text.alignleft") {
                model.formatCurrent()
                model.autosaveCurrent()
            }
            BrowserAgentButton(title: model.autosaveEnabled ? "Autosave on" : "Autosave off", icon: "externaldrive.badge.checkmark") {
                model.autosaveEnabled.toggle()
                model.persistWorkspaceState()
            }
            BrowserAgentButton(title: model.autoformatEnabled ? "Format on save" : "Manual format", icon: "wand.and.stars") {
                model.autoformatEnabled.toggle()
                model.persistWorkspaceState()
            }
            BrowserAgentButton(title: "Reset", icon: "arrow.uturn.backward") {
                model.resetCurrent()
            }
            if model.isDirty {
                BrowserAgentButton(title: "Discard", icon: "xmark.circle") {
                    model.discardUnsavedChanges()
                }
            }
            BrowserAgentButton(title: "Preview", icon: "play.rectangle") {
                if let file = model.selectedFile {
                    model.preview(file, settings: appModel.settings)
                }
            }
            BrowserAgentButton(title: model.showPreview ? "Hide preview" : "Show preview", icon: "rectangle.rightthird.inset.filled") {
                model.showPreview.toggle()
                model.persistWorkspaceState()
            }
            BrowserAgentButton(title: model.showTerminal ? "Hide terminal" : "Show terminal", icon: "terminal") {
                model.showTerminal.toggle()
                model.persistWorkspaceState()
            }
            BrowserAgentButton(title: "Open /s", icon: "square.and.arrow.up") {
                model.previewTab?.load(appModel.settings.websiteBaseURL.normalizedBaseURL.appendingPathComponent("s").absoluteString)
            }
        }
        .foregroundStyle(theme.text)
        .padding(.horizontal, 16)
        .frame(height: 48)
        .background(theme.commandBar)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(theme.divider)
                .frame(height: 1)
        }
    }

    var editorTabStrip: some View {
        HStack(spacing: 8) {
            ForEach(model.openFiles) { file in
                IDEEditorTabButton(file: file, selected: model.selectedFileID == file.id) {
                    model.select(file)
                } close: {
                    model.closeTab(file)
                }
            }
            Spacer()
            if let selected = model.selectedFile {
                Button {
                    model.togglePin(selected)
                } label: {
                    Image(systemName: model.pinnedFileIDs.contains(selected.id) ? "pin.fill" : "pin")
                        .font(.system(size: 11, weight: .bold))
                }
                .buttonStyle(.plain)
                .foregroundStyle(model.pinnedFileIDs.contains(selected.id) ? theme.accent : theme.textTertiary)
            }
            Text(model.selectedFileStorageLabel)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(model.isDirty ? theme.accent : theme.textTertiary)
            Text(model.selectedPlugin.language)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(theme.textTertiary)
        }
        .padding(.horizontal, 12)
        .frame(height: 38)
        .background(theme.backgroundElevated)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(theme.divider)
                .frame(height: 1)
        }
    }
}
