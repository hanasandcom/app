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

extension UsersNativePanel {

    var columns: [GridItem] {
        [GridItem(.adaptive(minimum: 250), spacing: 12, alignment: .top)]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 14) {
                Label("\(model.users.count) users", systemImage: "person.2")
                Label("\(model.users.filter { $0.active != false }.count) active", systemImage: "checkmark.circle")
                Label("\(model.users.filter { $0.active == false }.count) inactive", systemImage: "person.crop.circle.badge.xmark")
            }
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(theme.textSecondary)
            SearchFieldRow(placeholder: "Filter users by name, id, or role", text: $searchText)

            if model.users.isEmpty {
                NativeEmptyState(title: "No users loaded", message: "Use Refresh from this dashboard or configure auth in Settings to load user administration data.")
            } else {
                LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
                    ForEach(filteredUsers) { user in
                        VStack(alignment: .leading, spacing: 10) {
                            HStack(spacing: 10) {
                                Image(systemName: user.active == false ? "person.crop.circle.badge.xmark" : "person.crop.circle")
                                    .font(.system(size: 17, weight: .bold))
                                    .foregroundStyle(user.active == false ? theme.danger : theme.accent)
                                    .frame(width: 38, height: 38)
                                    .background(theme.cardRaised)
                                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(user.displayName)
                                        .font(.system(size: 14, weight: .black))
                                        .foregroundStyle(theme.text)
                                        .lineLimit(1)
                                    Text(user.id)
                                        .font(.system(size: 11, weight: .semibold, design: .monospaced))
                                        .foregroundStyle(theme.textTertiary)
                                        .lineLimit(1)
                                }
                            }
                            HStack(spacing: 6) {
                                Text(user.roleLabel)
                                Text("·")
                                Text("Priority \(user.highestRolePriority.map(String.init) ?? "unknown")")
                            }
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(theme.textSecondary)
                            HStack {
                                Button("Open profile") {
                                    model.openUserProfile(user)
                                }
                                .buttonStyle(.plain)
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(theme.accent)
                                Button("Roles") {
                                    model.selectDashboardUser(user)
                                }
                                .buttonStyle(.plain)
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(theme.textSecondary)
                                if user.id != model.userIDForRequests {
                                    Button("Impersonate") {
                                        impersonationReason = ""
                                        impersonationReasonError = ""
                                        pendingImpersonationUser = user
                                    }
                                    .buttonStyle(.plain)
                                    .font(.system(size: 12, weight: .bold))
                                    .foregroundStyle(theme.accent)
                                }
                                Button(user.active == false ? "Activate" : "Deactivate") {
                                    pendingStatusUser = user
                                }
                                .buttonStyle(.plain)
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(user.active == false ? theme.green : theme.danger)
                                Button("Delete") {
                                    pendingDeleteUser = user
                                }
                                .buttonStyle(.plain)
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(theme.danger)
                                Spacer()
                                Text(user.active == false ? "Inactive" : "Active")
                                    .font(.system(size: 11, weight: .bold))
                                    .foregroundStyle(user.active == false ? theme.danger : theme.green)
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

            if let selectedUser {
                userRolesPanel(selectedUser)
            }
        }
        .task(id: model.selectedUserID) {
            await model.loadSelectedUserRoles()
        }
        .alert(statusAlertTitle, isPresented: Binding(
            get: { pendingStatusUser != nil },
            set: { if !$0 { pendingStatusUser = nil } }
        )) {
            Button("Cancel", role: .cancel) {
                pendingStatusUser = nil
            }
            Button(statusActionTitle, role: pendingStatusUser?.active == false ? nil : .destructive) {
                if let pendingStatusUser {
                    Task { await model.setDashboardUser(pendingStatusUser, active: pendingStatusUser.active == false) }
                }
                pendingStatusUser = nil
            }
        } message: {
            Text(pendingStatusUser?.active == false ? "This will reactivate the selected account." : "This will deactivate the account and revoke its active sessions.")
        }
        .alert("Delete user?", isPresented: Binding(
            get: { pendingDeleteUser != nil },
            set: { if !$0 { pendingDeleteUser = nil } }
        )) {
            Button("Cancel", role: .cancel) {
                pendingDeleteUser = nil
            }
            Button("Delete", role: .destructive) {
                if let pendingDeleteUser {
                    Task { await model.deleteDashboardUser(pendingDeleteUser) }
                }
                pendingDeleteUser = nil
            }
        } message: {
            Text("This permanently removes \(pendingDeleteUser?.displayName ?? "the selected user"). Prefer deactivate unless deletion is intentional.")
        }
        .sheet(item: $pendingImpersonationUser, onDismiss: {
            impersonationReason = ""
            impersonationReasonError = ""
        }) { user in
            impersonationPrompt(user)
        }
    }

    var selectedUser: DashboardUser? {
        model.users.first { $0.id == model.selectedUserID }
    }

    var statusAlertTitle: String {
        pendingStatusUser?.active == false ? "Activate user?" : "Deactivate user?"
    }

    var statusActionTitle: String {
        pendingStatusUser?.active == false ? "Activate" : "Deactivate"
    }

    func normalizedImpersonationReason(_ value: String) -> String {
        value.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }

    func impersonationPrompt(_ user: DashboardUser) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Start impersonation")
                    .font(.system(size: 18, weight: .black))
                    .foregroundStyle(theme.text)
                Text("Provide an audit reason before viewing \(user.displayName).")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(theme.textSecondary)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Reason")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(theme.textSecondary)
                TextEditor(text: $impersonationReason)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(theme.text)
                    .frame(minHeight: 96)
                    .scrollContentBackground(.hidden)
                    .background(theme.cardRaised)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(theme.divider, lineWidth: 1)
                    )
                HStack(alignment: .top) {
                    Text("Required for audit. Minimum 10 characters. Starts a 30 minute profile and organization session.")
                    Spacer()
                    Text("\(normalizedImpersonationReason(impersonationReason).count)/10")
                }
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(theme.textTertiary)
            }

            if !impersonationReasonError.isEmpty {
                Text(impersonationReasonError)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(theme.danger)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(theme.danger.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }

            HStack {
                Spacer()
                Button("Cancel") {
                    pendingImpersonationUser = nil
                }
                .buttonStyle(.plain)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(theme.textSecondary)

                Button("Start session") {
                    let reason = normalizedImpersonationReason(impersonationReason)
                    guard reason.count >= 10 else {
                        impersonationReasonError = "Enter at least 10 characters so the audit trail explains why this session is needed."
                        return
                    }
                    model.impersonateDashboardUser(user, reason: reason)
                    pendingImpersonationUser = nil
                }
                .buttonStyle(.plain)
                .font(.system(size: 12, weight: .black))
                .foregroundStyle(theme.accent)
            }
        }
        .padding(18)
        .frame(width: 420)
        .background(theme.background)
    }
}
