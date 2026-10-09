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

    var gitNavigator: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                Label("Git", systemImage: "point.3.connected.trianglepath.dotted")
                    .font(.system(size: 12, weight: .black))
                    .foregroundStyle(theme.text)
                Spacer()
                Button {
                    model.refreshGitChanges()
                    model.refreshGitHistory()
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 10, weight: .bold))
                }
                .buttonStyle(.plain)
            }

            Text(model.gitSummary)
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(theme.textTertiary)
                .lineLimit(1)

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 5) {
                    ForEach(model.gitChanges.prefix(10)) { change in
                        HStack(spacing: 6) {
                            Button {
                                model.openGitChange(change)
                            } label: {
                                HStack(spacing: 6) {
                                    Image(systemName: change.icon)
                                        .font(.system(size: 10, weight: .bold))
                                        .frame(width: 13)
                                    Text(change.status)
                                        .font(.system(size: 9, weight: .black, design: .monospaced))
                                        .frame(width: 18, alignment: .leading)
                                    Text(change.path)
                                        .font(.system(size: 10, weight: .bold))
                                        .lineLimit(1)
                                    Spacer(minLength: 0)
                                }
                            }
                            .buttonStyle(.plain)
                            Button {
                                model.diffGitChange(change)
                                model.showTerminal = true
                                toolsExpanded = true
                            } label: {
                                Image(systemName: "plus.forwardslash.minus")
                                    .font(.system(size: 9, weight: .bold))
                            }
                            .buttonStyle(.plain)
                        }
                        .foregroundStyle(theme.textSecondary)
                        .padding(.horizontal, 8)
                        .frame(height: 28)
                        .background(theme.field)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }

                    if model.gitChanges.isEmpty {
                        Text("Working tree clean")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(theme.textTertiary)
                            .padding(.vertical, 6)
                    }

                    Text(model.gitHistorySummary)
                        .font(.system(size: 10, weight: .black))
                        .foregroundStyle(theme.textTertiary)
                        .textCase(.uppercase)
                        .padding(.top, 6)

                    ForEach(model.gitHistory.prefix(8)) { entry in
                        Text(entry.line)
                            .font(.system(size: 10, weight: .semibold, design: .monospaced))
                            .foregroundStyle(theme.textSecondary)
                            .lineLimit(1)
                            .padding(.horizontal, 8)
                            .frame(maxWidth: .infinity, minHeight: 24, alignment: .leading)
                            .background(theme.field.opacity(0.72))
                            .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                    }
                }
            }
        }
        .padding(12)
    }

    var ideMinimalHeader: some View {
        HStack(spacing: 10) {
            if let file = model.selectedFile {
                Image(systemName: file.icon)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(theme.accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text(file.title)
                        .font(.system(size: 13, weight: .black))
                        .foregroundStyle(theme.text)
                    Text(file.diskPath ?? file.path)
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(theme.textTertiary)
                        .lineLimit(1)
                }
            }
            Spacer()
            Text(model.status)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(theme.textTertiary)
                .lineLimit(1)
            Button {
                model.saveCurrent()
            } label: {
                Label("Save", systemImage: "square.and.arrow.down")
                    .font(.system(size: 11, weight: .bold))
            }
            .buttonStyle(.plain)
            Button {
                toolsExpanded.toggle()
            } label: {
                Image(systemName: toolsExpanded ? "sidebar.right" : "sidebar.leading")
                    .font(.system(size: 12, weight: .bold))
                    .frame(width: 28, height: 28)
                    .background(theme.cardRaised)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
            .buttonStyle(.plain)
            .help(toolsExpanded ? "Collapse tools" : "Expand tools")
        }
        .padding(.horizontal, 14)
        .frame(height: 48)
        .background(theme.commandBar)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(theme.divider)
                .frame(height: 1)
        }
    }

    var ideToolRail: some View {
        VStack(spacing: 0) {
            Button {
                toolsExpanded.toggle()
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: toolsExpanded ? "chevron.right" : "chevron.left")
                        .font(.system(size: 12, weight: .black))
                    if toolsExpanded {
                        Text("Tools")
                            .font(.system(size: 12, weight: .black))
                        Spacer()
                    }
                }
                .foregroundStyle(theme.text)
                .frame(maxWidth: .infinity)
                .frame(height: 42)
                .padding(.horizontal, toolsExpanded ? 12 : 0)
            }
            .buttonStyle(.plain)

            if toolsExpanded {
                expandedTools
            } else {
                collapsedTools
            }
        }
        .background(theme.sidebar.opacity(0.9))
    }
}
