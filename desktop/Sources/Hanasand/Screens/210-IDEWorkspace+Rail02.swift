import SwiftUI

extension IDEWorkspace {
    @ViewBuilder var ideRailProject: some View {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Project")
                                .font(.system(size: 11, weight: .black))
                                .foregroundStyle(theme.textTertiary)
                                .textCase(.uppercase)
                            Spacer()
                            Button {
                                model.scanProjectFiles()
                            } label: {
                                Image(systemName: "arrow.clockwise")
                                    .font(.system(size: 10, weight: .bold))
                            }
                            .buttonStyle(.plain)
                        }
                        Text(model.projectStatus)
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(theme.textTertiary)
                            .lineLimit(1)
                        HStack(spacing: 6) {
                            Image(systemName: "magnifyingglass")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(theme.textTertiary)
                            TextField("Find file", text: $model.projectFileFilter)
                                .textFieldStyle(.plain)
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(theme.text)
                        }
                        .padding(.horizontal, 8)
                        .frame(height: 26)
                        .background(theme.field)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        
                        ScrollView {
                            LazyVStack(alignment: .leading, spacing: 3) {
                                ForEach(model.filteredProjectFiles.prefix(32)) { file in
                                    Button {
                                        model.openProjectFile(file)
                                    } label: {
                                        HStack(spacing: 7) {
                                            Image(systemName: file.icon)
                                                .font(.system(size: 10, weight: .bold))
                                                .frame(width: 14)
                                            VStack(alignment: .leading, spacing: 1) {
                                                Text(file.name)
                                                    .font(.system(size: 11, weight: .bold))
                                                    .lineLimit(1)
                                                Text(file.relativePath)
                                                    .font(.system(size: 9, weight: .semibold))
                                                    .foregroundStyle(theme.textTertiary)
                                                    .lineLimit(1)
                                            }
                                            Spacer()
                                        }
                                        .foregroundStyle(theme.textSecondary)
                                        .padding(.horizontal, 8)
                                        .frame(height: 34)
                                        .background(file.absolutePath == model.selectedFile?.diskPath ? theme.sidebarSelected : Color.clear)
                                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                                    }
                                    .buttonStyle(.plain)
                                    .help(file.absolutePath)
                                }
                            }
                        }
                        .frame(maxHeight: 180)
                    }
                    .padding(.horizontal, 12)
    }

    @ViewBuilder var ideRailProblems: some View {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Problems")
                                .font(.system(size: 11, weight: .black))
                                .foregroundStyle(theme.textTertiary)
                                .textCase(.uppercase)
                            Spacer()
                            Button {
                                model.scanProblemMarkers()
                            } label: {
                                Image(systemName: "arrow.clockwise")
                                    .font(.system(size: 10, weight: .bold))
                            }
                            .buttonStyle(.plain)
                        }
                        Text(model.problemsSummary)
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(theme.textTertiary)
                            .lineLimit(1)
                        if !model.problemMarkers.isEmpty {
                            ScrollView {
                                LazyVStack(alignment: .leading, spacing: 4) {
                                    ForEach(model.problemMarkers.prefix(6)) { marker in
                                        Button {
                                            model.openProblemMarker(marker)
                                        } label: {
                                            HStack(spacing: 7) {
                                                Image(systemName: marker.icon)
                                                    .foregroundStyle(marker.severity == "error" ? theme.danger : theme.accent)
                                                    .frame(width: 14)
                                                VStack(alignment: .leading, spacing: 1) {
                                                    Text("\(URL(fileURLWithPath: marker.filePath).lastPathComponent):\(marker.line)")
                                                        .font(.system(size: 10, weight: .bold))
                                                        .lineLimit(1)
                                                    Text(marker.detail)
                                                        .font(.system(size: 9, weight: .semibold))
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
                                        .help(marker.filePath)
                                    }
                                }
                            }
                            .frame(maxHeight: 132)
                        }
                    }
                    .padding(.horizontal, 12)
    }
}
