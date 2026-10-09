import SwiftUI

extension IDEWorkspace {
    @ViewBuilder var ideRailGit: some View {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Git")
                            .font(.system(size: 11, weight: .black))
                            .foregroundStyle(theme.textTertiary)
                            .textCase(.uppercase)
                        HStack(spacing: 6) {
                            BrowserAgentButton(title: "Status", icon: "waveform.path.ecg") {
                                model.terminal.run("git status --short")
                                model.refreshGitChanges()
                                model.showTerminal = true
                            }
                            BrowserAgentButton(title: "Pull", icon: "arrow.down.circle") {
                                model.terminal.run("git pull --ff-only")
                                model.refreshGitChanges()
                                model.showTerminal = true
                            }
                            BrowserAgentButton(title: "Push", icon: "arrow.up.circle") {
                                model.terminal.run("git push")
                                model.refreshGitChanges()
                                model.showTerminal = true
                            }
                        }
                        HStack(spacing: 6) {
                            BrowserAgentButton(title: "Branch", icon: "point.3.connected.trianglepath.dotted") {
                                model.terminal.run("git branch --show-current")
                                model.showTerminal = true
                            }
                            BrowserAgentButton(title: "Log", icon: "clock.arrow.circlepath") {
                                model.terminal.run("git log --oneline -8")
                                model.showTerminal = true
                            }
                            BrowserAgentButton(title: "Diff", icon: "plus.forwardslash.minus") {
                                model.terminal.run("git diff --stat")
                                model.showTerminal = true
                            }
                        }
                        HStack {
                            Text(model.gitSummary)
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(theme.textTertiary)
                                .lineLimit(1)
                            Spacer()
                            Button {
                                NSPasteboard.general.clearContents()
                                NSPasteboard.general.setString(model.gitCommitPreview, forType: .string)
                            } label: {
                                Image(systemName: "doc.on.doc")
                                    .font(.system(size: 10, weight: .bold))
                            }
                            .buttonStyle(.plain)
                            Button {
                                model.refreshGitChanges()
                            } label: {
                                Image(systemName: "arrow.clockwise")
                                    .font(.system(size: 10, weight: .bold))
                            }
                            .buttonStyle(.plain)
                        }
                        if !model.gitChanges.isEmpty {
                            ScrollView {
                                LazyVStack(alignment: .leading, spacing: 4) {
                                    ForEach(model.gitChanges.prefix(8)) { change in
                                        HStack(spacing: 6) {
                                            Button {
                                                model.openGitChange(change)
                                            } label: {
                                                HStack(spacing: 6) {
                                                    Image(systemName: change.icon)
                                                        .frame(width: 13)
                                                    Text(change.status)
                                                        .font(.system(size: 9, weight: .black, design: .monospaced))
                                                        .frame(width: 18, alignment: .leading)
                                                    Text(change.path)
                                                        .lineLimit(1)
                                                    Spacer()
                                                }
                                            }
                                            .buttonStyle(.plain)
                                            Button {
                                                model.diffGitChange(change)
                                                model.showTerminal = true
                                            } label: {
                                                Image(systemName: "plus.forwardslash.minus")
                                                    .font(.system(size: 9, weight: .bold))
                                            }
                                            .buttonStyle(.plain)
                                        }
                                        .font(.system(size: 10, weight: .bold))
                                        .foregroundStyle(theme.textSecondary)
                                        .padding(.horizontal, 8)
                                        .frame(height: 28)
                                        .background(theme.field)
                                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                                    }
                                }
                            }
                            .frame(maxHeight: 124)
                        }
                        if !model.gitChanges.isEmpty {
                            Text(model.gitCommitPreview)
                                .font(.system(size: 9, weight: .semibold, design: .monospaced))
                                .foregroundStyle(theme.textTertiary)
                                .lineLimit(4)
                                .padding(8)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(theme.field)
                                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        }
                        HStack(spacing: 6) {
                            TextField("Commit message", text: $model.gitCommitMessage)
                                .textFieldStyle(.plain)
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(theme.text)
                                .padding(.horizontal, 8)
                                .frame(height: 26)
                                .background(theme.field)
                                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                            BrowserAgentButton(title: "Commit", icon: "checkmark.circle") {
                                model.commitAllChanges()
                                model.showTerminal = true
                            }
                        }
                    }
                    .padding(.horizontal, 12)
    }

    @ViewBuilder var ideRailTasks: some View {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Tasks")
                            .font(.system(size: 11, weight: .black))
                            .foregroundStyle(theme.textTertiary)
                            .textCase(.uppercase)
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 6)], spacing: 6) {
                            ForEach(model.workspaceTasks.prefix(6)) { task in
                                BrowserAgentButton(title: task.title, icon: task.icon) {
                                    model.terminal.run(task.command)
                                    model.showTerminal = true
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 12)
    }

    @ViewBuilder var ideRailPlugins: some View {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Plugins")
                            .font(.system(size: 11, weight: .black))
                            .foregroundStyle(theme.textTertiary)
                            .textCase(.uppercase)
                        ForEach(model.codePlugins.prefix(6)) { plugin in
                            Button {
                                model.togglePlugin(plugin)
                            } label: {
                                HStack(spacing: 8) {
                                    Image(systemName: plugin.icon)
                                        .frame(width: 16)
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(plugin.language)
                                            .font(.system(size: 11, weight: .bold))
                                        Text(plugin.formatter)
                                            .font(.system(size: 10, weight: .semibold))
                                            .foregroundStyle(theme.textTertiary)
                                    }
                                    Spacer()
                                    Image(systemName: model.enabledPluginIDs.contains(plugin.id) ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(plugin.id == model.selectedPlugin.id ? theme.accent : theme.textTertiary)
                                }
                                .foregroundStyle(theme.textSecondary)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 12)
    }
}
