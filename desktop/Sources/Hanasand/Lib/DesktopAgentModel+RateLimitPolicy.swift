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

    func issueRateLimitApiKey() async {
        guard hasHanasandAuth else {
            nativeDashboardStatus = "Hanasand session is not ready. Log in again if this persists."
            append(meta: "API key", body: nativeDashboardStatus, kind: .error)
            return
        }

        let ownerID = rateLimitKeyOwnerID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? userIDForRequests
            : rateLimitKeyOwnerID.trimmingCharacters(in: .whitespacesAndNewlines)
        let name = rateLimitKeyName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !ownerID.isEmpty, !name.isEmpty else {
            nativeDashboardStatus = "Owner and key name are required."
            append(meta: "API key", body: nativeDashboardStatus, kind: .error)
            return
        }

        isLoadingNativeDashboard = true
        nativeDashboardStatus = "Issuing API key"
        rateLimitIssuedSecret = nil
        defer { isLoadingNativeDashboard = false }

        do {
            let payload = DashboardApiKeyCreatePayload(
                ownerId: ownerID,
                name: name,
                tier: rateLimitKeyTier.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "starter" : rateLimitKeyTier,
                description: nil,
                enabled: true,
                expiresAt: nil,
                scope: makeRateLimitDraftScope()
            )
            let body = try JSONEncoder().encode(payload)
            let envelope: DashboardApiKeyCreateEnvelope = try await requestJSON(
                settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("rate-limit/keys"),
                method: "POST",
                body: body,
                authenticated: true
            )
            apiKeys.insert(envelope.apiKey, at: 0)
            rateLimitIssuedSecret = envelope.secret
            rateLimitKeyName = ""
            nativeDashboardStatus = "Issued \(envelope.apiKey.name)"
            append(meta: "API key", body: "Issued \(envelope.apiKey.name). Copy the secret now; it is only shown once.", kind: .change)
            await loadNativeDashboardData()
        } catch {
            nativeDashboardStatus = error.localizedDescription
            append(meta: "API key", body: error.localizedDescription, kind: .error)
        }
    }

    func setRateLimitEnforcement(enabled: Bool) async {
        guard hasHanasandAuth else {
            nativeDashboardStatus = "Hanasand session is not ready. Log in again if this persists."
            append(meta: "Rate limits", body: nativeDashboardStatus, kind: .error)
            return
        }
        guard let overview = rateLimitOverview else {
            nativeDashboardStatus = "Load rate-limit settings first."
            append(meta: "Rate limits", body: nativeDashboardStatus, kind: .error)
            return
        }

        isLoadingNativeDashboard = true
        nativeDashboardStatus = enabled ? "Enabling rate limits" : "Pausing rate limits"
        defer { isLoadingNativeDashboard = false }

        do {
            let payload = DashboardRateLimitSettingsPayload(settings: overview.settings, enabled: enabled)
            let body = try JSONEncoder().encode(payload)
            let text = try await requestPrettyText(
                settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("rate-limit/settings"),
                method: "PUT",
                body: body,
                authenticated: true
            )
            nativeDashboardStatus = enabled ? "Rate limits enabled" : "Rate limits paused"
            append(meta: "Rate limits", body: text.isEmpty ? nativeDashboardStatus : String(text.prefix(240)), kind: .change)
            await loadNativeDashboardData()
        } catch {
            nativeDashboardStatus = error.localizedDescription
            append(meta: "Rate limits", body: error.localizedDescription, kind: .error)
        }
    }

    func setRateLimitDefault(scope: String, maxRequests: Int) async {
        guard hasHanasandAuth else {
            nativeDashboardStatus = "Hanasand session is not ready. Log in again if this persists."
            append(meta: "Rate limits", body: nativeDashboardStatus, kind: .error)
            return
        }
        guard let overview = rateLimitOverview,
              let currentRule = overview.settings.defaults[scope] else {
            nativeDashboardStatus = "Load rate-limit settings first."
            append(meta: "Rate limits", body: nativeDashboardStatus, kind: .error)
            return
        }

        isLoadingNativeDashboard = true
        nativeDashboardStatus = "Saving \(scope) limit"
        defer { isLoadingNativeDashboard = false }

        do {
            let nextRule = DashboardRateLimitRulePayload(
                windowMs: currentRule.windowMs,
                maxRequests: min(max(maxRequests, 1), 1_000_000)
            )
            let payload = DashboardRateLimitSettingsPayload(
                settings: overview.settings,
                enabled: overview.settings.enabled,
                defaultOverrides: [scope: nextRule]
            )
            let body = try JSONEncoder().encode(payload)
            let text = try await requestPrettyText(
                settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("rate-limit/settings"),
                method: "PUT",
                body: body,
                authenticated: true
            )
            nativeDashboardStatus = "Saved \(scope) limit"
            append(meta: "Rate limits", body: text.isEmpty ? nativeDashboardStatus : String(text.prefix(240)), kind: .change)
            await loadNativeDashboardData()
        } catch {
            nativeDashboardStatus = error.localizedDescription
            append(meta: "Rate limits", body: error.localizedDescription, kind: .error)
        }
    }
}
