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

    func setRateLimitOverride(_ override: DashboardRateLimitOverride, enabled: Bool? = nil, remove: Bool = false) async {
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
        nativeDashboardStatus = remove ? "Removing route override" : "Saving route override"
        defer { isLoadingNativeDashboard = false }

        do {
            let nextOverrides = overview.settings.overrides.compactMap { current -> DashboardRateLimitOverridePayload? in
                guard current.id == override.id else {
                    return DashboardRateLimitOverridePayload(override: current)
                }
                if remove {
                    return nil
                }
                return DashboardRateLimitOverridePayload(override: current, enabled: enabled ?? current.enabled)
            }
            let payload = DashboardRateLimitSettingsPayload(
                settings: overview.settings,
                enabled: overview.settings.enabled,
                overridePayloads: nextOverrides
            )
            let body = try JSONEncoder().encode(payload)
            let text = try await requestPrettyText(
                settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("rate-limit/settings"),
                method: "PUT",
                body: body,
                authenticated: true
            )
            nativeDashboardStatus = remove ? "Removed route override" : "Saved route override"
            append(meta: "Rate limits", body: text.isEmpty ? nativeDashboardStatus : String(text.prefix(240)), kind: .change)
            await loadNativeDashboardData()
        } catch {
            nativeDashboardStatus = error.localizedDescription
            append(meta: "Rate limits", body: error.localizedDescription, kind: .error)
        }
    }

    func addRateLimitOverride() async {
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

        let routeText = rateLimitOverrideRoute.trimmingCharacters(in: .whitespacesAndNewlines)
        let fallbackRoute = overview.routes.first.map { "\($0.method) \($0.route)" } ?? "GET /api/"
        let selected = routeText.isEmpty ? fallbackRoute : routeText
        let parts = selected.split(separator: " ", maxSplits: 1).map(String.init)
        let method = (parts.first ?? "GET").uppercased()
        let route = parts.count > 1 ? parts[1] : selected
        let normalizedRoute = route.hasPrefix("/") ? route : "/\(route)"
        guard normalizedRoute.hasPrefix("/api") else {
            nativeDashboardStatus = "Override route must stay under /api."
            append(meta: "Rate limits", body: nativeDashboardStatus, kind: .error)
            return
        }

        let scope = ["anonymous", "authenticated", "internal"].contains(rateLimitOverrideScope)
            ? rateLimitOverrideScope
            : "anonymous"
        let windowMs = min(max(Int(rateLimitOverrideWindowMs) ?? 60_000, 1_000), 86_400_000)
        let maxRequests = min(max(Int(rateLimitOverrideMaxRequests) ?? 60, 1), 1_000_000)

        isLoadingNativeDashboard = true
        nativeDashboardStatus = "Adding route override"
        defer { isLoadingNativeDashboard = false }

        do {
            let next = DashboardRateLimitOverridePayload(
                id: "desktop_\(UUID().uuidString)",
                enabled: true,
                method: method.isEmpty ? "GET" : method,
                route: normalizedRoute,
                scope: scope,
                windowMs: windowMs,
                maxRequests: maxRequests
            )
            let payload = DashboardRateLimitSettingsPayload(
                settings: overview.settings,
                enabled: overview.settings.enabled,
                overridePayloads: overview.settings.overrides.map(DashboardRateLimitOverridePayload.init) + [next]
            )
            let body = try JSONEncoder().encode(payload)
            let text = try await requestPrettyText(
                settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("rate-limit/settings"),
                method: "PUT",
                body: body,
                authenticated: true
            )
            rateLimitOverrideRoute = ""
            nativeDashboardStatus = "Added route override"
            append(meta: "Rate limits", body: text.isEmpty ? nativeDashboardStatus : String(text.prefix(240)), kind: .change)
            await loadNativeDashboardData()
        } catch {
            nativeDashboardStatus = error.localizedDescription
            append(meta: "Rate limits", body: error.localizedDescription, kind: .error)
        }
    }

    func makeRateLimitDraftScope() -> DashboardApiKeyScopePayload {
        let routeText = rateLimitKeyRoute.trimmingCharacters(in: .whitespacesAndNewlines)
        let fallbackRoute = rateLimitOverview?.routes.first.map { "\($0.method) \($0.route)" } ?? "GET /api/"
        let selected = routeText.isEmpty ? fallbackRoute : routeText
        let parts = selected.split(separator: " ", maxSplits: 1).map(String.init)
        let method = (parts.first ?? "GET").uppercased()
        let route = parts.count > 1 ? parts[1] : selected
        return DashboardApiKeyScopePayload(
            id: "desktop_\(UUID().uuidString)",
            enabled: true,
            method: method.isEmpty ? "GET" : method,
            route: route.hasPrefix("/") ? route : "/\(route)",
            limits: rateLimitPresetLimits(for: rateLimitKeyTier)
        )
    }

    func rateLimitPresetLimits(for tier: String) -> DashboardApiKeyScopePayload.Limits {
        let presets = rateLimitOverview?.tierPresets ?? []
        let selected = presets.first { $0.id == tier } ?? presets.first { $0.id == "starter" } ?? presets.first
        return DashboardApiKeyScopePayload.Limits(
            perSecond: selected?.defaultLimits.perSecond ?? 2,
            perMinute: selected?.defaultLimits.perMinute ?? 60,
            perHour: selected?.defaultLimits.perHour ?? 1_000,
            perDay: selected?.defaultLimits.perDay ?? 10_000
        )
    }

    func loadProfileSecurityData() async {
        guard hasHanasandAuth else {
            profileSessions = []
            profileCertificates = []
            return
        }

        profileCertificates = (try? await requestJSON(
            settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("certificates/user/\(userIDForRequests)"),
            authenticated: true
        )) ?? []

        let sessionsEnvelope: DashboardSessionsEnvelope? = try? await requestJSON(
            settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("auth/sessions"),
            authenticated: true
        )
        profileSessions = sessionsEnvelope?.sessions ?? []
    }
}
