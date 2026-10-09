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

struct ProfileNativePanel: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme
    @State var pendingSessionRevoke: DashboardAuthSession?
    @State var pendingCertificateDelete: DashboardCertificate?
    @State var confirmRevokeOtherSessions = false
    @State var confirmLogout = false
    @State var confirmDeleteAccount = false

    var body: some View {
        if let profile = model.profile {
            VStack(alignment: .leading, spacing: 14) {
                NativeGroupPanel(title: "Account", subtitle: profile.id) {
                    HStack(spacing: 8) {
                        Image(systemName: profile.active == false ? "person.crop.circle.badge.xmark" : "person.crop.circle")
                            .foregroundStyle(profile.active == false ? theme.danger : theme.accent)
                        Text(profile.displayName).font(.system(size: 13, weight: .semibold)).foregroundStyle(theme.text)
                        Text(profile.active == false ? "Inactive" : "Active").font(.system(size: 11, weight: .medium)).foregroundStyle(theme.textTertiary)
                    }
                    Text("ID  \(profile.id)  ·  Avatar  \(profile.avatar ?? "none")")
                        .font(.system(size: 10, weight: .regular, design: .monospaced))
                        .foregroundStyle(theme.textTertiary)
                        .textSelection(.enabled)
                    HStack(spacing: 10) {
                        ActionButton(title: "Log out", icon: "rectangle.portrait.and.arrow.right") {
                            confirmLogout = true
                        }
                        ActionButton(title: "Delete account", icon: "trash", tone: .danger) {
                            confirmDeleteAccount = true
                        }
                    }
                    if let roles = profile.roles, !roles.isEmpty {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 210), spacing: 10)], spacing: 10) {
                            ForEach(roles) { role in
                                CompactInfoCard(
                                    title: role.displayName,
                                    lines: [
                                        role.description ?? role.id,
                                        "Priority: \(role.priority.map(String.init) ?? "unknown")",
                                    ]
                                )
                            }
                        }
                    } else {
                        CompactInfoCard(title: "Roles", lines: ["No roles returned for this session."])
                    }
                }

                NativeGroupPanel(title: "Security", subtitle: "Active sessions and SSH certificates") {
                    HStack(spacing: 12) {
                        FeatureCard(title: "Token expiry", value: profile.expiresAt.map { formatDateText($0, fallback: $0) } ?? "No expiry", icon: "key")
                        FeatureCard(title: "Active sessions", value: "\(model.profileSessions.filter { $0.revokedAt == nil }.count)", icon: "laptopcomputer")
                        FeatureCard(title: "Managed certs", value: "\(model.profileCertificates.filter { $0.isManaged }.count)", icon: "checkmark.shield")
                    }
                    HStack(spacing: 10) {
                        ActionButton(title: "Refresh security", icon: "arrow.clockwise") {
                            Task { await model.loadNativeDashboardData() }
                        }
                        ActionButton(title: "Logout others", icon: "rectangle.portrait.and.arrow.right", tone: .danger) {
                            confirmRevokeOtherSessions = true
                        }
                        .disabled(model.profileSessions.filter { $0.revokedAt == nil }.count <= 1)
                    }

                    if model.profileSessions.isEmpty {
                        CompactInfoCard(title: "Sessions", lines: ["No session records returned."])
                    } else {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 10)], spacing: 10) {
                            ForEach(model.profileSessions) { session in
                                VStack(alignment: .leading, spacing: 10) {
                                    CompactInfoCard(
                                        title: "\(session.deviceLabel) \(session.revokedAt == nil ? "active" : "revoked")",
                                        lines: [
                                            "IP: \(session.ip ?? "unknown")",
                                            "Last seen: \(formatDateText(session.lastSeenAt, fallback: "unknown"))",
                                            session.userAgent ?? "Unknown client",
                                        ]
                                    )
                                    if session.revokedAt == nil {
                                        HStack {
                                            Spacer()
                                            ActionButton(title: "Revoke", icon: "xmark.shield", tone: .danger) {
                                                pendingSessionRevoke = session
                                            }
                                            .disabled(model.isLoadingNativeDashboard)
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if model.profileCertificates.isEmpty {
                        CompactInfoCard(title: "Certificates", lines: ["No certificates returned."])
                    } else {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 10)], spacing: 10) {
                            ForEach(model.profileCertificates) { certificate in
                                VStack(alignment: .leading, spacing: 10) {
                                    CompactInfoCard(
                                        title: certificate.name,
                                        lines: [
                                            certificate.isManaged ? "Managed by Hanasand API" : "User managed",
                                            "Owner: \(certificate.owner ?? "unknown")",
                                            "Key: \(certificate.keySuffix)",
                                        ]
                                    )
                                    HStack {
                                        Spacer()
                                        ActionButton(title: "Delete", icon: "trash", tone: .danger) {
                                            pendingCertificateDelete = certificate
                                        }
                                        .disabled(model.isLoadingNativeDashboard)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .alert("Revoke session?", isPresented: sessionRevokePresented) {
                Button("Revoke", role: .destructive) {
                    guard let pendingSessionRevoke else { return }
                    Task { await model.revokeProfileSession(pendingSessionRevoke) }
                }
                Button("Cancel", role: .cancel) {
                    pendingSessionRevoke = nil
                }
            } message: {
                Text("This will immediately revoke the selected \(pendingSessionRevoke?.deviceLabel ?? "device") session.")
            }
            .alert("Delete certificate?", isPresented: certificateDeletePresented) {
                Button("Delete", role: .destructive) {
                    guard let pendingCertificateDelete else { return }
                    Task { await model.deleteProfileCertificate(pendingCertificateDelete) }
                }
                Button("Cancel", role: .cancel) {
                    pendingCertificateDelete = nil
                }
            } message: {
                Text("This removes \(pendingCertificateDelete?.name ?? "the selected certificate") from the account.")
            }
            .alert("Logout other devices?", isPresented: $confirmRevokeOtherSessions) {
                Button("Logout others", role: .destructive) {
                    Task { await model.revokeOtherProfileSessions() }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This keeps the current token and revokes other active sessions for this account.")
            }
            .alert("Log out of Hanasand?", isPresented: $confirmLogout) {
                Button("Log out", role: .destructive) {
                    Task { await model.logoutFromHanasand() }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This clears the desktop app session and returns to the login screen.")
            }
            .alert("Delete account?", isPresented: $confirmDeleteAccount) {
                Button("Delete", role: .destructive) {
                    Task { await model.scheduleAccountDeletion() }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This logs out every device and schedules permanent deletion after 30 days.")
            }
        } else {
            NativeEmptyState(title: "Profile not loaded", message: "Hanasand session is not ready yet. Log in again if this profile does not load.")
        }
    }

    var sessionRevokePresented: Binding<Bool> {
        Binding(
            get: { pendingSessionRevoke != nil },
            set: { visible in
                if !visible {
                    pendingSessionRevoke = nil
                }
            }
        )
    }

    var certificateDeletePresented: Binding<Bool> {
        Binding(
            get: { pendingCertificateDelete != nil },
            set: { visible in
                if !visible {
                    pendingCertificateDelete = nil
                }
            }
        )
    }
}
