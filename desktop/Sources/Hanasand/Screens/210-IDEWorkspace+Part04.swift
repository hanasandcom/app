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

    var expandedTools: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                toolsSection("Actions") {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 116), spacing: 7)], spacing: 7) {
                        BrowserAgentButton(title: "Open file", icon: "folder") {
                            openLocalFile()
                        }
                        BrowserAgentButton(title: "New scratch", icon: "plus") {
                            model.newScratch()
                        }
                        BrowserAgentButton(title: "Export", icon: "square.and.arrow.up") {
                            exportCurrentFile()
                        }
                        BrowserAgentButton(title: "Format", icon: "wand.and.stars") {
                            model.formatCurrent()
                            model.autosaveCurrent()
                        }
                        BrowserAgentButton(title: "Preview", icon: "play.rectangle") {
                            if let file = model.selectedFile {
                                model.preview(file, settings: appModel.settings)
                                model.showPreview = true
                                model.persistWorkspaceState()
                            }
                        }
                        BrowserAgentButton(title: model.autosaveEnabled ? "Autosave on" : "Autosave off", icon: "externaldrive.badge.checkmark") {
                            model.autosaveEnabled.toggle()
                            model.persistWorkspaceState()
                        }
                        BrowserAgentButton(title: "Discard", icon: "xmark.circle") {
                            model.discardUnsavedChanges()
                        }
                    }
                }

                toolsSection("Run") {
                    ForEach(model.currentFileRunCommands.prefix(3)) { command in
                        IDEToolCommandRow(command: command) {
                            model.terminal.run(command.command)
                            model.showTerminal = true
                        }
                    }
                    ForEach(model.workspaceTasks.prefix(4)) { task in
                        IDEToolCommandRow(command: task) {
                            model.terminal.run(task.command)
                            model.showTerminal = true
                        }
                    }
                }

                toolsSection("Git commands") {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 7)], spacing: 7) {
                        BrowserAgentButton(title: "Status", icon: "waveform.path.ecg") {
                            model.terminal.run("git status --short")
                            model.showTerminal = true
                        }
                        BrowserAgentButton(title: "Pull", icon: "arrow.down.circle") {
                            model.terminal.run("git pull --ff-only")
                            model.showTerminal = true
                        }
                        BrowserAgentButton(title: "Push", icon: "arrow.up.circle") {
                            model.terminal.run("git push")
                            model.showTerminal = true
                        }
                        BrowserAgentButton(title: "Log", icon: "clock.arrow.circlepath") {
                            model.terminal.run("git log --oneline -12")
                            model.showTerminal = true
                        }
                    }
                    Text(model.gitCommitPreview)
                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                        .foregroundStyle(theme.textTertiary)
                        .lineLimit(6)
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(theme.field)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                }

                toolsSection("Menus") {
                    HStack(spacing: 8) {
                        Toggle("Preview", isOn: Binding(
                            get: { model.showPreview },
                            set: {
                                model.showPreview = $0
                                model.persistWorkspaceState()
                            }
                        ))
                        Toggle("Terminal", isOn: Binding(
                            get: { model.showTerminal },
                            set: {
                                model.showTerminal = $0
                                model.persistWorkspaceState()
                            }
                        ))
                    }
                    .toggleStyle(.checkbox)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(theme.textSecondary)

                    if model.showPreview {
                        previewPane
                            .frame(height: 280)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                    if model.showTerminal {
                        terminalPane
                            .frame(height: 300)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                }

                toolsSection("Problems") {
                    HStack {
                        Text(model.problemsSummary)
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(theme.textTertiary)
                        Spacer()
                        Button("Scan") { model.scanProblemMarkers() }
                            .buttonStyle(.plain)
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(theme.accent)
                    }
                    ForEach(model.problemMarkers.prefix(6)) { marker in
                        IDEProblemRow(marker: marker) {
                            model.openProblemMarker(marker)
                        }
                    }
                }

                toolsSection("Outline") {
                    if model.outlineItems.isEmpty {
                        Text("No symbols yet")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(theme.textTertiary)
                    } else {
                        ForEach(model.outlineItems.prefix(8)) { item in
                            HStack(spacing: 7) {
                                Image(systemName: item.icon)
                                    .frame(width: 14)
                                Text(item.title)
                                    .lineLimit(1)
                                Spacer()
                                Text("\(item.line)")
                                    .foregroundStyle(theme.textTertiary)
                            }
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(theme.textSecondary)
                        }
                    }
                }

                toolsSection("Snippets") {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 7)], spacing: 7) {
                        ForEach(model.selectedSnippets.prefix(6)) { snippet in
                            BrowserAgentButton(title: snippet.title, icon: snippet.icon) {
                                model.insertSnippet(snippet)
                            }
                        }
                    }
                }
            }
            .padding(12)
        }
    }

    @ViewBuilder

    func toolsSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 10, weight: .black))
                .foregroundStyle(theme.textTertiary)
                .textCase(.uppercase)
            content()
        }
    }
}
