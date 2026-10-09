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

extension DesktopAgentModel {

    func deleteSelectedArticle(_ article: DashboardArticle) async {
        guard hasHanasandAuth else {
            nativeDashboardStatus = "Hanasand session is not ready. Log in again if this persists."
            return
        }

        isLoadingNativeDashboard = true
        nativeDashboardStatus = "Deleting article"
        defer { isLoadingNativeDashboard = false }

        do {
            _ = try await requestPrettyText(
                settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("article/\(article.id)"),
                method: "DELETE",
                authenticated: true
            )
            if selectedArticleID == article.id {
                selectedArticleID = ""
                articleEditID = ""
                articleEditContent = ""
            }
            nativeDashboardStatus = "Deleted \(article.id)"
            append(meta: "Article deleted", body: article.id, kind: .change)
            await loadNativeDashboardData()
        } catch {
            nativeDashboardStatus = error.localizedDescription
            append(meta: "Article delete failed", body: error.localizedDescription, kind: .error)
        }
    }

    func openArticle(_ article: DashboardArticle) {
        openWebsite(path: "/articles/\(article.id.replacingOccurrences(of: ".md", with: ""))", label: article.title)
    }

    func openUserProfile(_ user: DashboardUser) {
        openWebsite(path: "/profile/\(user.id)", label: user.displayName)
    }

    func selectDashboardUser(_ user: DashboardUser) {
        selectedUserID = user.id
        Task { await loadSelectedUserRoles() }
    }

    struct DesktopImpersonationStartPayload: Encodable {
        let target_id: String
        let reason: String
        let durationMinutes: Int
        let scope: [String]
    }

    struct DesktopImpersonationTarget: Decodable {
        let id: String
        let name: String?
    }

    struct DesktopImpersonationSession: Decodable {
        let target: DesktopImpersonationTarget
    }

    struct DesktopImpersonationStartResponse: Decodable {
        let token: String
        let session: DesktopImpersonationSession
    }

    func impersonateDashboardUser(_ user: DashboardUser, reason: String) {
        guard user.id != userIDForRequests else { return }
        let auditReason = reason.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        guard auditReason.count >= 10 else {
            nativeDashboardStatus = "Impersonation reason must be at least 10 characters."
            return
        }
        Task {
            do {
                let body = try JSONEncoder().encode(DesktopImpersonationStartPayload(
                    target_id: user.id,
                    reason: auditReason,
                    durationMinutes: 30,
                    scope: ["read_profile", "read_org"]
                ))
                let response: DesktopImpersonationStartResponse = try await requestJSON(
                    settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("impersonation/start"),
                    method: "POST",
                    body: body,
                    authenticated: true
                )
                try DesktopCredentialStore.write(response.token, for: .impersonationToken)
                settings.impersonationToken = response.token
                settings.impersonatingUserID = response.session.target.id
                settings.impersonatingUserName = response.session.target.name ?? user.displayName
                nativeDashboardStatus = "Impersonating \(response.session.target.id)"
                append(meta: "Impersonation", body: "Viewing portal as \(response.session.target.id).", kind: .change)
                await loadNativeDashboardData()
            } catch {
                nativeDashboardStatus = "Impersonation failed"
                append(meta: "Impersonation failed", body: error.localizedDescription, kind: .error)
            }
        }
    }

    func returnToOwnDashboardView() {
        let target = settings.impersonatingUserID
        let token = settings.impersonationToken
        let actorID = userIDForRequests
        let authToken = authTokenForRequests
        if !token.isEmpty {
            Task {
                var request = URLRequest(url: settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("impersonation"))
                request.httpMethod = "DELETE"
                request.setValue("application/json", forHTTPHeaderField: "Accept")
                request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
                request.setValue(actorID, forHTTPHeaderField: "id")
                request.setValue(token, forHTTPHeaderField: "x-impersonation-token")
                _ = try? await URLSession.shared.data(for: request)
            }
        }
        do {
            try DesktopCredentialStore.write("", for: .impersonationToken)
        } catch {
            nativeDashboardStatus = "Unable to clear the impersonation session from Keychain."
            append(meta: "Impersonation cleanup failed", body: error.localizedDescription, kind: .error)
            return
        }
        settings.impersonationToken = ""
        settings.impersonatingUserID = ""
        settings.impersonatingUserName = ""
        nativeDashboardStatus = target.isEmpty ? "Viewing own account" : "Returned from \(target)"
        append(meta: "Impersonation", body: "Returned to own view.", kind: .change)
        Task { await loadNativeDashboardData() }
    }

    func loadSelectedUserRoles() async {
        guard !selectedUserID.isEmpty else {
            selectedUserRoles = []
            return
        }

        do {
            selectedUserRoles = try await requestJSON(
                settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("roles/user/\(selectedUserID)"),
                authenticated: true
            )
            nativeDashboardStatus = "Loaded roles for \(selectedUserID)"
        } catch {
            selectedUserRoles = []
            nativeDashboardStatus = error.localizedDescription
        }
    }

    func setDashboardUser(_ user: DashboardUser, active: Bool) async {
        guard hasHanasandAuth else {
            nativeDashboardStatus = "Hanasand session is not ready. Log in again if this persists."
            return
        }

        let body = (try? JSONEncoder().encode(UserActivePayload(active: active))) ?? Data("{}".utf8)
        isLoadingNativeDashboard = true
        nativeDashboardStatus = active ? "Activating user" : "Deactivating user"
        defer { isLoadingNativeDashboard = false }

        do {
            _ = try await requestPrettyText(
                settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("user/\(user.id)/active"),
                method: "PUT",
                body: body,
                authenticated: true
            )
            nativeDashboardStatus = active ? "Activated \(user.id)" : "Deactivated \(user.id)"
            append(meta: active ? "User activated" : "User deactivated", body: user.id, kind: .change)
            await loadNativeDashboardData()
        } catch {
            nativeDashboardStatus = error.localizedDescription
            append(meta: "User status failed", body: error.localizedDescription, kind: .error)
        }
    }

    func setRole(_ role: DashboardRole, assigned: Bool, for user: DashboardUser) async {
        guard hasHanasandAuth else {
            nativeDashboardStatus = "Hanasand session is not ready. Log in again if this persists."
            return
        }

        let body = (try? JSONEncoder().encode(RoleAssignmentPayload(role_id: role.id))) ?? Data("{}".utf8)
        let action = assigned ? "assign" : "unassign"
        isLoadingNativeDashboard = true
        nativeDashboardStatus = assigned ? "Assigning role" : "Removing role"
        defer { isLoadingNativeDashboard = false }

        do {
            _ = try await requestPrettyText(
                settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("role/\(action)/\(user.id)"),
                method: "POST",
                body: body,
                authenticated: true
            )
            selectedUserID = user.id
            nativeDashboardStatus = assigned ? "Assigned \(role.id)" : "Removed \(role.id)"
            append(meta: assigned ? "Role assigned" : "Role removed", body: "\(role.id) · \(user.id)", kind: .change)
            await loadSelectedUserRoles()
            await loadNativeDashboardData()
        } catch {
            nativeDashboardStatus = error.localizedDescription
            append(meta: "Role assignment failed", body: error.localizedDescription, kind: .error)
        }
    }

    func deleteDashboardUser(_ user: DashboardUser) async {
        guard hasHanasandAuth else {
            nativeDashboardStatus = "Hanasand session is not ready. Log in again if this persists."
            return
        }

        isLoadingNativeDashboard = true
        nativeDashboardStatus = "Deleting user"
        defer { isLoadingNativeDashboard = false }

        do {
            _ = try await requestPrettyText(
                settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("user/\(user.id)"),
                method: "DELETE",
                authenticated: true
            )
            if selectedUserID == user.id {
                selectedUserID = ""
                selectedUserRoles = []
            }
            nativeDashboardStatus = "Deleted \(user.id)"
            append(meta: "User deleted", body: user.id, kind: .change)
            await loadNativeDashboardData()
        } catch {
            nativeDashboardStatus = error.localizedDescription
            append(meta: "User delete failed", body: error.localizedDescription, kind: .error)
        }
    }

    func loadRoleIntoEditor(_ role: DashboardRole) {
        selectedRoleID = role.id
        roleEditName = role.name ?? role.id
        roleEditDescription = role.description ?? ""
    }
}
