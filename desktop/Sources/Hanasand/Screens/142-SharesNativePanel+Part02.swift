import SwiftUI
extension SharesNativePanel {
    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 12) {
                NativeGroupPanel(title: "Create share", subtitle: "Fast native share creation") {
                    TextField("Name", text: $model.shareDraftName)
                        .textFieldStyle(.plain)
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(theme.text)
                        .padding(12)
                        .background(theme.field)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    TextEditor(text: $model.shareDraftContent)
                        .font(.system(size: 13, weight: .semibold, design: .monospaced))
                        .foregroundStyle(theme.text)
                        .scrollContentBackground(.hidden)
                        .padding(8)
                        .frame(minHeight: 210)
                        .background(theme.field)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    HStack {
                        Text(model.shareDraftContent.isEmpty ? "Paste or write content." : "\(model.shareDraftContent.count) chars")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(theme.textTertiary)
                        Spacer()
                        ActionButton(title: "Create", icon: "plus") {
                            Task { await model.createNativeShare() }
                        }
                        .disabled(model.isLoadingNativeDashboard)
                    }
                }
                NativeGroupPanel(title: "Edit selected", subtitle: model.selectedShareID.isEmpty ? "Choose a share from the list." : model.selectedShareID) {
                    TextField("Name", text: $model.shareEditName)
                        .textFieldStyle(.plain)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(theme.text)
                        .padding(12)
                        .background(theme.field)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    TextField("Path", text: $model.shareEditPath)
                        .textFieldStyle(.plain)
                        .font(.system(size: 13, weight: .semibold, design: .monospaced))
                        .foregroundStyle(theme.text)
                        .padding(12)
                        .background(theme.field)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    TextEditor(text: $model.shareEditContent)
                        .font(.system(size: 13, weight: .semibold, design: .monospaced))
                        .foregroundStyle(theme.text)
                        .scrollContentBackground(.hidden)
                        .padding(8)
                        .frame(minHeight: 170)
                        .background(theme.field)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    HStack {
                        Text(model.selectedShareID.isEmpty ? "No share selected." : "\(model.shareEditContent.count) chars")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(theme.textTertiary)
                        Spacer()
                        ActionButton(title: "Save edits", icon: "checkmark") {
                            Task { await model.updateSelectedShare() }
                        }
                        .disabled(model.selectedShareID.isEmpty || model.isLoadingNativeDashboard)
                    }
                }
            }
            .frame(width: 380)
            VStack(alignment: .leading, spacing: 12) {
                LazyVGrid(columns: summaryColumns, alignment: .leading, spacing: 12) {
                    FeatureCard(title: "Shares", value: "\(model.shares.count)", icon: "folder.badge.gearshape")
                    FeatureCard(title: "CDN", value: "Native", icon: "network")
                }
                HStack {
                    Text(model.shares.isEmpty ? "Load or create shares from the CDN-backed workspace." : "Recent shares")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(theme.textTertiary)
                    Spacer()
                    ActionButton(title: "Refresh", icon: "arrow.clockwise") {
                        Task { await model.loadNativeDashboardData() }
                    }
                }
                if model.shares.isEmpty {
                    NativeEmptyState(title: "No shares loaded", message: "Create a share or refresh the CDN-backed share list.")
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 12)], spacing: 12) {
                        ForEach(model.shares) { share in
                            VStack(alignment: .leading, spacing: 12) {
                                HStack(alignment: .top, spacing: 10) {
                                    Image(systemName: share.locked == true ? "lock.fill" : "doc.text")
                                        .font(.system(size: 15, weight: .bold))
                                        .foregroundStyle(share.locked == true ? theme.danger : theme.accent)
                                        .frame(width: 34, height: 34)
                                        .background(theme.cardRaised)
                                        .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                                    VStack(alignment: .leading, spacing: 5) {
                                        Text(share.displayName)
                                            .font(.system(size: 14, weight: .black))
                                            .foregroundStyle(theme.text)
                                            .lineLimit(1)
                                        Text(share.subtitle.isEmpty ? share.id : share.subtitle)
                                            .font(.system(size: 11, weight: .semibold))
                                            .foregroundStyle(theme.textTertiary)
                                            .lineLimit(1)
                                    }
                                    Spacer()
                                }
                                HStack(spacing: 8) {
                                    Label(share.updatedLabel, systemImage: "clock")
                                    if let wordCount = share.wordCount {
                                        Label("\(wordCount) words", systemImage: "text.word.spacing")
                                    }
                                }
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(theme.textSecondary)
                                .lineLimit(1)
                                HStack(spacing: 12) {
                                    Button("Open") {
                                        model.openShare(share)
                                    }
                                    .buttonStyle(.plain)
                                    .foregroundStyle(theme.accent)
                                    Button("Edit") {
                                        model.loadShareIntoEditor(share)
                                    }
                                    .buttonStyle(.plain)
                                    .foregroundStyle(theme.textSecondary)
                                    Button(share.locked == true ? "Unlock" : "Lock") {
                                        Task { await model.toggleNativeShareLock(share) }
                                    }
                                    .buttonStyle(.plain)
                                    .foregroundStyle(share.locked == true ? theme.danger : theme.textSecondary)
                                    Button("Tree") {
                                        Task { await model.loadNativeShareTree(share) }
                                    }
                                    .buttonStyle(.plain)
                                    .foregroundStyle(theme.textSecondary)
                                    Button("Delete") {
                                        deletingShare = share
                                    }
                                    .buttonStyle(.plain)
                                    .foregroundStyle(theme.danger)
                                    Spacer()
                                    Text(share.id)
                                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                                        .foregroundStyle(theme.textTertiary)
                                        .lineLimit(1)
                                }
                                if let tree = model.shareTrees[share.id], !tree.isEmpty {
                                    Text(treePreview(tree))
                                        .font(.system(size: 11, weight: .semibold, design: .monospaced))
                                        .foregroundStyle(theme.textTertiary)
                                        .lineLimit(8)
                                        .padding(10)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .background(theme.backgroundElevated.opacity(0.72))
                                        .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                                }
                            }
                            .padding(13)
                            .background(theme.card)
                            .overlay(
                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    .stroke(theme.divider, lineWidth: 1)
                            )
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        }
                    }
                }
            }
        }
        .alert("Delete share?", isPresented: Binding(
            get: { deletingShare != nil },
            set: { if !$0 { deletingShare = nil } }
        )) {
            Button("Cancel", role: .cancel) {
                deletingShare = nil
            }
            Button("Delete", role: .destructive) {
                if let deletingShare {
                    Task { await model.deleteNativeShare(deletingShare) }
                }
                deletingShare = nil
            }
        } message: {
            Text(deletingShare?.displayName ?? "This share will be removed.")
        }
    }
}
