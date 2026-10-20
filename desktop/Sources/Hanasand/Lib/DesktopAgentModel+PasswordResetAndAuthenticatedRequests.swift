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

    func completePasswordReset() async {
        let username = passwordResetUsername.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !username.isEmpty, !passwordResetToken.isEmpty, !isResettingPassword else {
            passwordResetStatus = "Reset session expired. Send a new code."
            return
        }
        guard passwordResetNewPassword == passwordResetConfirmPassword else {
            passwordResetStatus = "Passwords do not match."
            return
        }
        guard !passwordResetNewPassword.isEmpty else {
            passwordResetStatus = "Enter a new password."
            return
        }

        isResettingPassword = true
        passwordResetStatus = "Setting password"
        defer { isResettingPassword = false }

        do {
            let url = settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("auth/password-reset/complete")
            let body = try JSONEncoder().encode(PasswordResetCompletePayload(
                id: username,
                resetToken: passwordResetToken,
                password: passwordResetNewPassword
            ))
            let response: PasswordResetResponse = try await passwordResetJSON(url, body: body)
            if let error = response.error, !error.isEmpty {
                passwordResetStatus = error
                return
            }

            loginUsername = username
            loginPassword = ""
            passwordResetCode = ""
            passwordResetToken = ""
            passwordResetNewPassword = ""
            passwordResetConfirmPassword = ""
            passwordResetStep = .idle
            loginStatus = "Password reset. Log in with the new one."
            passwordResetStatus = ""
        } catch {
            passwordResetStatus = error.localizedDescription
        }
    }

    func passwordResetJSON<T: Decodable>(_ url: URL, body: Data) async throws -> T {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Hanasand Desktop/\(Self.appVersion)", forHTTPHeaderField: "User-Agent")
        request.httpBody = body

        let (data, response) = try await URLSession.shared.data(for: request)
        let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 200
        if (200..<300).contains(statusCode) {
            return try JSONDecoder().decode(T.self, from: data)
        }

        if let decoded = try? JSONDecoder().decode(PasswordResetResponse.self, from: data),
           let error = decoded.error,
           !error.isEmpty {
            throw PasswordResetRequestError.message(error)
        }

        throw PasswordResetRequestError.message("Password reset endpoint returned HTTP \(statusCode).")
    }

    var authTokenForRequests: String {
        let configured = settings.authToken.trimmingCharacters(in: .whitespacesAndNewlines)
        if !configured.isEmpty {
            return configured
        }
        let environment = ProcessInfo.processInfo.environment
        return environment["HANASAND_API_TOKEN"] ?? environment["HANASAND_AUTH_TOKEN"] ?? ""
    }

    var userIDForRequests: String {
        let configured = settings.userID.trimmingCharacters(in: .whitespacesAndNewlines)
        if !configured.isEmpty {
            return configured
        }
        return ProcessInfo.processInfo.environment["HANASAND_USER_ID"] ?? ""
    }

    var impersonatingUserIDForRequests: String {
        settings.impersonatingUserID.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var effectiveUserIDForRequests: String {
        let target = impersonatingUserIDForRequests
        return target.isEmpty ? userIDForRequests : target
    }

    func saveSettings() {
        do {
            try DesktopCredentialStore.write(settings.authToken, for: .authToken)
            try DesktopCredentialStore.write(settings.impersonationToken, for: .impersonationToken)
        } catch {
            return
        }
        var persistedSettings = settings
        persistedSettings.authToken = ""
        persistedSettings.impersonationToken = ""
        guard let data = try? JSONEncoder().encode(persistedSettings) else { return }
        UserDefaults.standard.set(data, forKey: Self.settingsKey)
    }

    func request(_ url: URL, method: String = "GET", body: Data? = nil, authenticated: Bool = false, userAgent: String? = nil) -> URLRequest {
        precondition(url.usesSecureHanasandTransport, "Blocked insecure plaintext endpoint: \(url.absoluteString)")
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 12
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        request.setValue(userAgent ?? "Hanasand Desktop/\(Self.appVersion)", forHTTPHeaderField: "User-Agent")
        if authenticated {
            request.setValue("Bearer \(authTokenForRequests)", forHTTPHeaderField: "Authorization")
            request.setValue(userIDForRequests, forHTTPHeaderField: "id")
            if !settings.impersonationToken.isEmpty {
                request.setValue(settings.impersonationToken, forHTTPHeaderField: "x-impersonation-token")
            }
        }
        return request
    }

    func mailOverviewURL() -> URL {
        var components = URLComponents(url: settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("mail/overview"), resolvingAgainstBaseURL: false)
        var items: [URLQueryItem] = []
        if !selectedMailAccountUser.isEmpty {
            items.append(URLQueryItem(name: "mailboxUser", value: selectedMailAccountUser))
        }
        if !selectedMailboxID.isEmpty {
            items.append(URLQueryItem(name: "mailboxId", value: selectedMailboxID))
        }
        if !selectedMailMessageID.isEmpty {
            items.append(URLQueryItem(name: "messageId", value: selectedMailMessageID))
        }
        if !items.isEmpty {
            components?.queryItems = items
        }
        return components?.url ?? settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("mail/overview")
    }

    func requestJSON<T: Decodable>(_ url: URL, method: String = "GET", body: Data? = nil, authenticated: Bool = false) async throws -> T {
        let (data, response) = try await URLSession.shared.data(for: request(url, method: method, body: body, authenticated: authenticated))
        try validateHTTP(response)
        return try JSONDecoder().decode(T.self, from: data)
    }

    func isValidShortcutDestination(_ path: String) -> Bool {
        let clean = path.trimmingCharacters(in: .whitespacesAndNewlines)
        return clean.contains("http") || (clean.contains(".") && clean.count > 2) || clean.contains(":")
    }

    func requestText(_ url: URL, method: String = "GET", authenticated: Bool = false) async throws -> String {
        let (data, response) = try await URLSession.shared.data(for: request(url, method: method, authenticated: authenticated))
        try validateHTTP(response)
        return String(data: data, encoding: .utf8) ?? ""
    }

    func requestPrettyText(_ url: URL, method: String = "GET", body: Data? = nil, authenticated: Bool = false, userAgent: String? = nil) async throws -> String {
        let (data, response) = try await URLSession.shared.data(for: request(url, method: method, body: body, authenticated: authenticated, userAgent: userAgent))
        try validateHTTP(response)
        if let object = try? JSONSerialization.jsonObject(with: data),
           let prettyData = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys]),
           let pretty = String(data: prettyData, encoding: .utf8) {
            return pretty
        }
        return String(data: data, encoding: .utf8) ?? ""
    }
}
