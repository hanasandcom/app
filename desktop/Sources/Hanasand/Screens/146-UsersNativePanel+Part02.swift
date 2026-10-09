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

    func userRolesPanel(_ user: DashboardUser) -> some View {
        NativeGroupPanel(title: "Roles for \(user.displayName)", subtitle: user.id) {
            if model.roles.isEmpty {
                Text("Load roles before assigning access.")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(theme.textSecondary)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 230), spacing: 10)], alignment: .leading, spacing: 10) {
                    ForEach(model.roles.sorted { ($0.priority ?? 0) < ($1.priority ?? 0) }) { role in
                        let assigned = model.selectedUserRoles.contains { $0.id == role.id }
                        Button {
                            Task { await model.setRole(role, assigned: !assigned, for: user) }
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: assigned ? "checkmark.circle.fill" : "circle")
                                    .font(.system(size: 15, weight: .bold))
                                    .foregroundStyle(assigned ? theme.green : theme.textTertiary)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(role.displayName)
                                        .font(.system(size: 12, weight: .black))
                                        .foregroundStyle(theme.text)
                                        .lineLimit(1)
                                    Text(role.description ?? role.id)
                                        .font(.system(size: 10, weight: .semibold))
                                        .foregroundStyle(theme.textSecondary)
                                        .lineLimit(1)
                                }
                                Spacer()
                                Text("\(role.priority ?? 0)")
                                    .font(.system(size: 10, weight: .black, design: .monospaced))
                                    .foregroundStyle(theme.accent)
                            }
                            .padding(11)
                            .background(assigned ? theme.accentSoft : theme.cardRaised)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .disabled(model.isLoadingNativeDashboard)
                    }
                }
            }
        }
    }

    var filteredUsers: [DashboardUser] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return model.users }
        return model.users.filter { user in
            [
                user.id,
                user.name ?? "",
                user.highestRoleName ?? "",
                user.highestRoleID ?? "",
            ].joined(separator: " ").lowercased().contains(query)
        }
    }
}
