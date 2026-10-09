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

extension RateLimitsNativePanel {

    func defaultLimitRow(scope: String, rule: DashboardRateLimitRule, active: Bool) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: scope == "anonymous" ? "person.crop.circle.badge.questionmark" : "person.badge.key")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(active ? theme.accent : theme.textTertiary)
                .frame(width: 30, height: 30)
                .background(active ? theme.accentSoft : theme.cardRaised)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

            VStack(alignment: .leading, spacing: 4) {
                Text(scope.capitalized)
                    .font(.system(size: 12, weight: .black))
                    .foregroundStyle(theme.text)
                    .lineLimit(1)
                Text(rule.summary)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(theme.textSecondary)
                    .lineLimit(2)
            }

            Spacer()

            HStack(spacing: 6) {
                ActionButton(title: "Half", icon: "minus.circle") {
                    Task { await model.setRateLimitDefault(scope: scope, maxRequests: max(rule.maxRequests / 2, 1)) }
                }
                ActionButton(title: "Double", icon: "plus.circle") {
                    Task { await model.setRateLimitDefault(scope: scope, maxRequests: min(rule.maxRequests * 2, 1_000_000)) }
                }
            }
        }
        .padding(10)
        .background(theme.cardRaised)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    func overridesPanel(_ overview: DashboardRateLimitOverview) -> some View {
        NativeGroupPanel(title: "Overrides", subtitle: "\(overview.settings.overrides.count) route rules") {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 180), spacing: 10)], alignment: .leading, spacing: 10) {
                nativeTextField("Route", text: $model.rateLimitOverrideRoute, placeholder: overview.routes.first.map { "\($0.method) \($0.route)" } ?? "GET /api/")
                nativeTextField("Scope", text: $model.rateLimitOverrideScope, placeholder: "anonymous")
                nativeTextField("Window ms", text: $model.rateLimitOverrideWindowMs, placeholder: "60000")
                nativeTextField("Requests", text: $model.rateLimitOverrideMaxRequests, placeholder: "60")
            }

            HStack(spacing: 10) {
                ActionButton(title: "Add override", icon: "plus.circle") {
                    Task { await model.addRateLimitOverride() }
                }
                Text("Scopes: anonymous, authenticated, internal.")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(theme.textTertiary)
            }

            if overview.settings.overrides.isEmpty {
                Text("No route exceptions are configured.")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(theme.textSecondary)
            } else {
                LazyVStack(alignment: .leading, spacing: 8) {
                    ForEach(overview.settings.overrides.prefix(12)) { override in
                        overrideRow(override)
                    }
                }
            }
        }
    }

    func overrideRow(_ override: DashboardRateLimitOverride) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: override.enabled ? "checkmark.shield" : "pause.circle")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(override.enabled ? theme.accent : theme.textTertiary)
                .frame(width: 30, height: 30)
                .background(override.enabled ? theme.accentSoft : theme.cardRaised)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

            VStack(alignment: .leading, spacing: 4) {
                Text("\(override.method) \(override.route)")
                    .font(.system(size: 12, weight: .black, design: .monospaced))
                    .foregroundStyle(theme.text)
                    .lineLimit(1)
                Text("\(override.scope) · \(override.maxRequests) / \(formatMilliseconds(Double(override.windowMs)))")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(theme.textSecondary)
                    .lineLimit(2)
            }

            Spacer()

            HStack(spacing: 6) {
                ActionButton(title: override.enabled ? "Disable" : "Enable", icon: override.enabled ? "pause.circle" : "play.circle") {
                    Task { await model.setRateLimitOverride(override, enabled: !override.enabled) }
                }
                ActionButton(title: "Remove", icon: "trash", tone: .danger) {
                    Task { await model.setRateLimitOverride(override, remove: true) }
                }
            }
        }
        .padding(10)
        .background(theme.cardRaised)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    func presetsPanel(_ overview: DashboardRateLimitOverview) -> some View {
        NativeGroupPanel(title: "Tier presets", subtitle: "\(overview.tierPresets?.count ?? 0) templates") {
            let presets = overview.tierPresets ?? []
            if presets.isEmpty {
                Text("No API-key tiers returned by the server.")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(theme.textSecondary)
            } else {
                LazyVStack(alignment: .leading, spacing: 8) {
                    ForEach(presets) { preset in
                        rateRow(
                            icon: "rectangle.stack.badge.person.crop",
                            title: preset.label,
                            subtitle: "\(preset.defaultLimits.summary.isEmpty ? "No limits" : preset.defaultLimits.summary) · \(preset.description)",
                            active: true
                        )
                    }
                }
            }
        }
    }

    var apiKeysPanel: some View {
        NativeGroupPanel(title: "API keys", subtitle: "\(filteredKeys.count) visible") {
            if model.apiKeys.isEmpty {
                Text("No API keys returned by the server.")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(theme.textSecondary)
            } else if filteredKeys.isEmpty {
                Text("No API keys match the active search.")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(theme.textSecondary)
            } else {
                LazyVGrid(columns: columns, alignment: .leading, spacing: 10) {
                    ForEach(filteredKeys) { key in
                        apiKeyCard(key)
                    }
                }
            }
        }
    }
}
