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

    func loginToHanasand() async {
        let username = loginUsername.trimmingCharacters(in: .whitespacesAndNewlines)
        let password = loginPassword
        guard !username.isEmpty, !password.isEmpty, !isLoggingIn else {
            loginStatus = "Enter username and password."
            return
        }

        isLoggingIn = true
        loginStatus = "Signing in"
        defer { isLoggingIn = false }

        do {
            let url = settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("auth/login/\(username.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? username)")
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.timeoutInterval = 15
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("Hanasand Desktop/\(Self.appVersion)", forHTTPHeaderField: "User-Agent")
            request.httpBody = try JSONEncoder().encode(HanasandLoginRequest(password: password))

            let (data, response) = try await URLSession.shared.data(for: request)
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 200
            let decoded = try? JSONDecoder().decode(HanasandLoginResponse.self, from: data)

            if statusCode == 423, decoded?.pendingDeletion == true {
                pendingDeletionUserID = decoded?.id ?? username
                pendingDeletionRestoreToken = decoded?.restoreToken ?? ""
                pendingDeletionScheduledAt = decoded?.deletionScheduledAt ?? ""
                pendingDeletionStatus = ""
                loginPassword = ""
                loginStatus = ""
                return
            }

            guard (200..<300).contains(statusCode), let token = decoded?.token, !token.isEmpty else {
                let message = decoded?.error
                    ?? String(data: data, encoding: .utf8)
                    ?? "Login failed."
                loginStatus = message
                return
            }

            try DesktopCredentialStore.write(token, for: .authToken)
            try DesktopCredentialStore.write("", for: .impersonationToken)
            settings.authToken = token
            settings.userID = decoded?.id ?? username
            settings.impersonationToken = ""
            settings.impersonatingUserID = ""
            settings.impersonatingUserName = ""
            loginUsername = ""
            loginPassword = ""
            loginStatus = ""
            append(meta: "Login", body: "Signed in as \(settings.userID).", kind: .change)
            beginDesktopAgentPresence()
        } catch {
            loginStatus = error.localizedDescription
        }
    }

    func restorePendingDeletionAccount() async {
        let userID = pendingDeletionUserID.trimmingCharacters(in: .whitespacesAndNewlines)
        let restoreToken = pendingDeletionRestoreToken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !userID.isEmpty, !restoreToken.isEmpty, !isRestoringPendingDeletion else {
            pendingDeletionStatus = "Restore details are missing."
            return
        }

        isRestoringPendingDeletion = true
        pendingDeletionStatus = "Restoring"
        defer { isRestoringPendingDeletion = false }

        do {
            let body = try JSONEncoder().encode(["id": userID, "restoreToken": restoreToken])
            let url = settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("user/restore")
            let (data, response) = try await URLSession.shared.data(for: request(url, method: "POST", body: body, authenticated: false))
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 200
            let decoded = try? JSONDecoder().decode(HanasandLoginResponse.self, from: data)
            guard (200..<300).contains(statusCode), let token = decoded?.token, !token.isEmpty else {
                pendingDeletionStatus = decoded?.error ?? String(data: data, encoding: .utf8) ?? "Unable to restore account."
                return
            }

            clearPendingDeletionState()
            try DesktopCredentialStore.write(token, for: .authToken)
            try DesktopCredentialStore.write("", for: .impersonationToken)
            settings.authToken = token
            settings.userID = decoded?.id ?? userID
            settings.impersonationToken = ""
            settings.impersonatingUserID = ""
            settings.impersonatingUserName = ""
            loginUsername = ""
            loginPassword = ""
            loginStatus = ""
            append(meta: "Account restored", body: "Signed in as \(settings.userID).", kind: .change)
            beginDesktopAgentPresence()
        } catch {
            pendingDeletionStatus = error.localizedDescription
        }
    }

    func clearPendingDeletionState() {
        pendingDeletionUserID = ""
        pendingDeletionRestoreToken = ""
        pendingDeletionScheduledAt = ""
        pendingDeletionStatus = ""
    }

    func logoutFromHanasand(revokeRemoteSession: Bool = true) async {
        let currentUserID = userIDForRequests.trimmingCharacters(in: .whitespacesAndNewlines)
        let hadAuth = hasHanasandAuth

        if revokeRemoteSession, hadAuth {
            do {
                let body = (try? JSONEncoder().encode(["keep_current": false])) ?? Data("{}".utf8)
                _ = try await requestPrettyText(
                    settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("auth/sessions/revoke"),
                    method: "POST",
                    body: body,
                    authenticated: true
                )
            } catch {
                append(meta: "Logout revoke failed", body: error.localizedDescription, kind: .error)
            }
        }

        do {
            try DesktopCredentialStore.write("", for: .authToken)
            try DesktopCredentialStore.write("", for: .impersonationToken)
        } catch {
            loginStatus = "Unable to securely clear the Hanasand session. Try logging out again."
            append(meta: "Logout cleanup failed", body: error.localizedDescription, kind: .error)
            return
        }

        clearLocalHanasandSession()
        let label = currentUserID.isEmpty ? "current account" : currentUserID
        append(meta: "Logout", body: "Signed out \(label).", kind: .change)
    }

    func clearLocalHanasandSession() {
        desktopPresenceTask?.cancel()
        desktopPresenceTask = nil
        settings.authToken = ""
        settings.userID = ""
        settings.impersonationToken = ""
        settings.impersonatingUserID = ""
        settings.impersonatingUserName = ""
        loginUsername = ""
        loginPassword = ""
        loginStatus = ""
        clearPendingDeletionState()
        cancelPasswordReset()
        selectedSection = .control
        disconnectAISocket()
        aiSummary = "Ready to connect"
        aiClients = []
        aiSocketConnected = false
        mailOverview = nil
        mailSummary = "Ready to load inbox"
        selectedMailAccountUser = ""
        selectedMailMessageID = ""
        selectedMailboxID = ""
        profile = nil
        profileSessions = []
        profileCertificates = []
        nativeDashboardStatus = "Logged out"
    }

    func scheduleAccountDeletion() async {
        guard hasHanasandAuth else {
            nativeDashboardStatus = "Hanasand session is not ready. Log in again if this persists."
            return
        }

        do {
            _ = try await requestPrettyText(
                settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("user/self"),
                method: "DELETE",
                authenticated: true
            )
            await logoutFromHanasand(revokeRemoteSession: false)
        } catch {
            nativeDashboardStatus = error.localizedDescription
            append(meta: "Account deletion failed", body: error.localizedDescription, kind: .error)
        }
    }

    func beginPasswordReset() {
        let username = loginUsername.trimmingCharacters(in: .whitespacesAndNewlines)
        passwordResetUsername = username
        passwordResetCode = ""
        passwordResetToken = ""
        passwordResetNewPassword = ""
        passwordResetConfirmPassword = ""
        passwordResetStatus = ""
        lastAutoVerifiedPasswordResetCode = ""
        passwordResetStep = .code
    }

    func cancelPasswordReset() {
        passwordResetCode = ""
        passwordResetToken = ""
        passwordResetNewPassword = ""
        passwordResetConfirmPassword = ""
        passwordResetStatus = ""
        lastAutoVerifiedPasswordResetCode = ""
        passwordResetStep = .idle
    }

    func updatePasswordResetCode(_ rawValue: String) {
        let clean = String(rawValue.filter(\.isNumber).prefix(6))
        if passwordResetCode != clean {
            passwordResetCode = clean
        }
        if clean.count < 6 {
            lastAutoVerifiedPasswordResetCode = ""
            return
        }
        autoVerifyPasswordResetCodeIfReady()
    }

    func autoVerifyPasswordResetCodeIfReady() {
        let username = passwordResetUsername.trimmingCharacters(in: .whitespacesAndNewlines)
        let code = passwordResetCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard passwordResetStep == .code, !username.isEmpty, code.count == 6, !isResettingPassword else { return }
        guard lastAutoVerifiedPasswordResetCode != code else { return }
        lastAutoVerifiedPasswordResetCode = code
        Task { await verifyPasswordResetCode() }
    }

    func requestPasswordResetCode() async {
        let username = passwordResetUsername.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !username.isEmpty, !isResettingPassword else {
            passwordResetStatus = "Type your username first."
            return
        }

        isResettingPassword = true
        passwordResetStatus = "Sending code"
        defer { isResettingPassword = false }

        do {
            let url = settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("auth/password-reset/request")
            let body = try JSONEncoder().encode(PasswordResetRequestPayload(id: username))
            let response: PasswordResetResponse = try await passwordResetJSON(url, body: body)
            if let error = response.error, !error.isEmpty {
                passwordResetStatus = error
                return
            }

            passwordResetUsername = username
            passwordResetCode = ""
            passwordResetToken = ""
            lastAutoVerifiedPasswordResetCode = ""
            passwordResetStep = .code
            passwordResetStatus = "Check your mail for the 6 digit code."
        } catch {
            passwordResetStatus = error.localizedDescription
        }
    }

    func verifyPasswordResetCode() async {
        let username = passwordResetUsername.trimmingCharacters(in: .whitespacesAndNewlines)
        let code = passwordResetCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !username.isEmpty, code.count == 6, !isResettingPassword else {
            passwordResetStatus = "Enter the 6 digit code."
            return
        }

        isResettingPassword = true
        passwordResetStatus = "Checking code"
        defer { isResettingPassword = false }

        do {
            let url = settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("auth/password-reset/verify")
            let body = try JSONEncoder().encode(PasswordResetVerifyPayload(id: username, code: code))
            let response: PasswordResetVerifyResponse = try await passwordResetJSON(url, body: body)
            guard let token = response.resetToken, !token.isEmpty else {
                lastAutoVerifiedPasswordResetCode = ""
                passwordResetStatus = response.error ?? "Invalid reset code."
                return
            }

            passwordResetToken = token
            passwordResetNewPassword = ""
            passwordResetConfirmPassword = ""
            passwordResetStep = .newPassword
            passwordResetStatus = "Code accepted."
        } catch {
            lastAutoVerifiedPasswordResetCode = ""
            passwordResetStatus = error.localizedDescription
        }
    }
}
