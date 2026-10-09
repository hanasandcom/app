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

struct RolesNativePanel: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme
    @State var searchText = ""
    @State var deletingRole: DashboardRole?

    let columns = [
        GridItem(.adaptive(minimum: 260), spacing: 12, alignment: .top),
    ]

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 12) {
                NativeGroupPanel(title: "Create role", subtitle: "User-admin role management") {
                    TextField("Role id, optional", text: $model.roleDraftID)
                        .textFieldStyle(.plain)
                        .font(.system(size: 13, weight: .semibold, design: .monospaced))
                        .foregroundStyle(theme.text)
                        .padding(12)
                        .background(theme.field)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    TextField("Role name", text: $model.roleDraftName)
                        .textFieldStyle(.plain)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(theme.text)
                        .padding(12)
                        .background(theme.field)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    TextField("Description", text: $model.roleDraftDescription, axis: .vertical)
                        .textFieldStyle(.plain)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(theme.text)
                        .lineLimit(2...5)
                        .padding(12)
                        .background(theme.field)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    HStack {
                        Text(model.roleDraftName.isEmpty ? "Name creates the slug when id is empty." : model.roleDraftName.slugifiedPath)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(theme.textTertiary)
                        Spacer()
                        ActionButton(title: "Create", icon: "plus") {
                            Task { await model.createNativeRole() }
                        }
                        .disabled(model.isLoadingNativeDashboard)
                    }
                }

                NativeGroupPanel(title: "Edit role", subtitle: model.selectedRoleID.isEmpty ? "Choose a role from the list." : model.selectedRoleID) {
                    TextField("Role name", text: $model.roleEditName)
                        .textFieldStyle(.plain)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(theme.text)
                        .padding(12)
                        .background(theme.field)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    TextField("Description", text: $model.roleEditDescription, axis: .vertical)
                        .textFieldStyle(.plain)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(theme.text)
                        .lineLimit(2...5)
                        .padding(12)
                        .background(theme.field)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    HStack {
                        Text(model.selectedRoleID.isEmpty ? "No role selected." : "Priority stays managed by the API.")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(theme.textTertiary)
                        Spacer()
                        ActionButton(title: "Save", icon: "checkmark") {
                            Task { await model.updateSelectedRole() }
                        }
                        .disabled(model.selectedRoleID.isEmpty || model.isLoadingNativeDashboard)
                    }
                }
            }
            .frame(width: 360)

            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 12) {
                    Label("\(model.roles.count) roles", systemImage: "person.badge.key")
                    Text("·")
                    Text("Highest priority \(model.roles.compactMap { $0.priority }.max() ?? 0)")
                }
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(theme.textSecondary)

                HStack(spacing: 10) {
                    SearchFieldRow(placeholder: "Filter roles by name, id, or description", text: $searchText)
                    ActionButton(title: "Refresh", icon: "arrow.clockwise") {
                        Task { await model.loadNativeDashboardData() }
                    }
                }

                if model.roles.isEmpty {
                    NativeEmptyState(title: "No roles loaded", message: "Use Refresh to load roles. System-admin auth is required for native role administration.")
                } else {
                    LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
                        ForEach(filteredRoles) { role in
                            VStack(alignment: .leading, spacing: 10) {
                                HStack {
                                    Text(role.displayName)
                                        .font(.system(size: 15, weight: .black))
                                        .foregroundStyle(theme.text)
                                        .lineLimit(1)
                                    Spacer()
                                    Text("\(role.priority ?? 0)")
                                        .font(.system(size: 12, weight: .bold, design: .monospaced))
                                        .foregroundStyle(theme.accent)
                                        .padding(.horizontal, 9)
                                        .frame(height: 26)
                                        .background(theme.accentSoft)
                                        .clipShape(Capsule())
                                }
                                Text(role.description ?? role.id)
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(theme.textSecondary)
                                    .lineLimit(3)
                                Text("Updated \(formatDateText(role.updatedAt, fallback: role.createdAt ?? "unknown"))")
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundStyle(theme.textTertiary)
                                HStack(spacing: 12) {
                                    Button("Edit") {
                                        model.loadRoleIntoEditor(role)
                                    }
                                    .buttonStyle(.plain)
                                    .font(.system(size: 12, weight: .bold))
                                    .foregroundStyle(theme.accent)

                                    Button("Delete") {
                                        deletingRole = role
                                    }
                                    .buttonStyle(.plain)
                                    .font(.system(size: 12, weight: .bold))
                                    .foregroundStyle(theme.danger)

                                    Spacer()
                                    Text(role.id)
                                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                                        .foregroundStyle(theme.textTertiary)
                                        .lineLimit(1)
                                }
                            }
                            .padding(13)
                            .background(role.id == model.selectedRoleID ? theme.accentSoft : theme.card)
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
        .alert("Delete role?", isPresented: Binding(
            get: { deletingRole != nil },
            set: { if !$0 { deletingRole = nil } }
        )) {
            Button("Cancel", role: .cancel) {
                deletingRole = nil
            }
            Button("Delete", role: .destructive) {
                if let deletingRole {
                    Task { await model.deleteNativeRole(deletingRole) }
                }
                deletingRole = nil
            }
        } message: {
            Text("This removes \(deletingRole?.displayName ?? "the selected role"). Users relying on it may lose access.")
        }
    }

    var filteredRoles: [DashboardRole] {
        let sorted = model.roles.sorted { ($0.priority ?? 0) > ($1.priority ?? 0) }
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return sorted }
        return sorted.filter { role in
            [
                role.id,
                role.name ?? "",
                role.description ?? "",
                role.createdBy ?? "",
            ].joined(separator: " ").lowercased().contains(query)
        }
    }
}
