import SwiftUI

extension IDEWorkspace {
    @ViewBuilder var ideRailOutline: some View {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Outline")
                            .font(.system(size: 11, weight: .black))
                            .foregroundStyle(theme.textTertiary)
                            .textCase(.uppercase)
                        if model.outlineItems.isEmpty {
                            Text("No symbols yet")
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(theme.textTertiary)
                        } else {
                            ForEach(model.outlineItems.prefix(5)) { item in
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
                    .padding(.horizontal, 12)
    }

    @ViewBuilder var ideRailSnippets: some View {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Snippets")
                            .font(.system(size: 11, weight: .black))
                            .foregroundStyle(theme.textTertiary)
                            .textCase(.uppercase)
                        HStack(spacing: 6) {
                            ForEach(model.selectedSnippets.prefix(3)) { snippet in
                                BrowserAgentButton(title: snippet.title, icon: snippet.icon) {
                                    model.insertSnippet(snippet)
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 12)
    }

    @ViewBuilder var ideRailSpacer: some View {
                    Spacer()
    }

    @ViewBuilder var ideRailFooter: some View {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 6) {
                            BrowserAgentButton(title: "Open file", icon: "folder") {
                                openLocalFile()
                            }
                            BrowserAgentButton(title: "Export", icon: "square.and.arrow.up") {
                                exportCurrentFile()
                            }
                        }
                        BrowserAgentButton(title: "New scratch", icon: "plus") {
                            model.newScratch()
                        }
                        Label("Local drafts persist in this app", systemImage: "tray.full")
                        Label("Disk files save back to disk", systemImage: "internaldrive")
                        Label("Preview and terminal stay docked", systemImage: "rectangle.split.3x1")
                    }
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(theme.textTertiary)
                        .padding(14)
    }
}
