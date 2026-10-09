import SwiftUI

extension IDEWorkspace {
    @ViewBuilder var ideRailHeader: some View {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Native IDE")
                                .font(.system(size: 18, weight: .black))
                                .foregroundStyle(theme.text)
                            Text("Local drafts, disk files, and live previews")
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(theme.textTertiary)
                        }
                        .padding(.top, 18)
                        .padding(.horizontal, 14)
    }

    @ViewBuilder var ideRailSearch: some View {
                    HStack(spacing: 8) {
                        Image(systemName: "magnifyingglass")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(theme.textTertiary)
                        TextField("Filter drafts", text: $model.searchText)
                            .textFieldStyle(.plain)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(theme.text)
                    }
                    .padding(.horizontal, 10)
                    .frame(height: 32)
                    .background(theme.field)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .padding(.horizontal, 10)
    }

    @ViewBuilder var ideRailPalette: some View {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Command Palette")
                            .font(.system(size: 11, weight: .black))
                            .foregroundStyle(theme.textTertiary)
                            .textCase(.uppercase)
                        HStack(spacing: 6) {
                            Image(systemName: "command")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(theme.textTertiary)
                            TextField("Run action", text: $model.commandPaletteQuery)
                                .textFieldStyle(.plain)
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(theme.text)
                        }
                        .padding(.horizontal, 8)
                        .frame(height: 28)
                        .background(theme.field)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        
                        ForEach(model.paletteCommands.prefix(4)) { command in
                            Button {
                                model.runPaletteCommand(command)
                            } label: {
                                HStack(spacing: 7) {
                                    Image(systemName: command.icon)
                                        .frame(width: 14)
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(command.title)
                                            .font(.system(size: 10, weight: .bold))
                                            .lineLimit(1)
                                        Text(command.command)
                                            .font(.system(size: 9, weight: .semibold, design: .monospaced))
                                            .foregroundStyle(theme.textTertiary)
                                            .lineLimit(1)
                                    }
                                    Spacer()
                                }
                                .foregroundStyle(theme.textSecondary)
                                .padding(.horizontal, 8)
                                .frame(height: 34)
                                .background(theme.field)
                                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 12)
    }

    @ViewBuilder var ideRailDrafts: some View {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(model.filteredFiles) { file in
                            Button {
                                model.select(file)
                                model.preview(file, settings: appModel.settings)
                            } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: file.icon)
                                        .frame(width: 18)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(file.title)
                                            .font(.system(size: 13, weight: .bold))
                                        Text(file.path)
                                            .font(.system(size: 11, weight: .semibold))
                                            .foregroundStyle(theme.textTertiary)
                                    }
                                    Spacer()
                                }
                                .foregroundStyle(model.selectedFileID == file.id ? theme.text : theme.textSecondary)
                                .padding(.horizontal, 12)
                                .frame(height: 48)
                                .background(model.selectedFileID == file.id ? theme.sidebarSelected : Color.clear)
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 8)
    }

    @ViewBuilder var ideRailMemory: some View {
                    if !model.pinnedFiles.isEmpty || !model.recentFiles.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Memory")
                                .font(.system(size: 11, weight: .black))
                                .foregroundStyle(theme.textTertiary)
                                .textCase(.uppercase)
                            ForEach(model.pinnedFiles.prefix(4)) { file in
                                IDEMemoryFileButton(file: file, icon: "pin.fill") {
                                    model.select(file)
                                }
                            }
                            ForEach(model.recentFiles.prefix(4)) { file in
                                if !model.pinnedFileIDs.contains(file.id) {
                                    IDEMemoryFileButton(file: file, icon: "clock") {
                                        model.select(file)
                                    }
                                }
                            }
                        }
                        .padding(.horizontal, 12)
                    }
    }
}
