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

    func routesPanel(_ overview: DashboardRateLimitOverview) -> some View {
        NativeGroupPanel(title: "Protected routes", subtitle: "\(filteredRoutes(overview).count) visible") {
            let routes = filteredRoutes(overview)
            if routes.isEmpty {
                Text("No routes match the current search.")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(theme.textSecondary)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 210), spacing: 8)], alignment: .leading, spacing: 8) {
                    ForEach(routes.prefix(80)) { route in
                        HStack(spacing: 8) {
                            Text(route.method)
                                .font(.system(size: 10, weight: .black, design: .monospaced))
                                .foregroundStyle(theme.accent)
                                .frame(width: 48, alignment: .leading)
                            Text(route.route)
                                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                                .foregroundStyle(theme.textSecondary)
                                .lineLimit(1)
                            Spacer()
                        }
                        .padding(9)
                        .background(theme.cardRaised)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                }
            }
        }
    }

    func apiKeyCard(_ key: DashboardApiKeySummary) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: key.enabled ? "key.horizontal.fill" : "key.slash")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(key.enabled ? theme.accent : theme.textTertiary)
                    .frame(width: 34, height: 34)
                    .background(key.enabled ? theme.accentSoft : theme.cardRaised)
                    .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))

                VStack(alignment: .leading, spacing: 4) {
                    Text(key.name)
                        .font(.system(size: 13, weight: .black))
                        .foregroundStyle(theme.text)
                        .lineLimit(1)
                    Text("\(key.ownerId) · \(key.tier) · \(key.keyPrefix)")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(theme.textSecondary)
                        .lineLimit(1)
                }
                Spacer()
                Text(key.statusLabel)
                    .font(.system(size: 10, weight: .black))
                    .foregroundStyle(key.enabled ? theme.green : theme.textTertiary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .background(key.enabled ? theme.green.opacity(0.12) : theme.cardRaised)
                    .clipShape(Capsule())
            }

            if let description = key.description, !description.isEmpty {
                Text(description)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(theme.textSecondary)
                    .lineLimit(2)
            }

            HStack(spacing: 8) {
                MiniMetricCard(label: "Created", value: key.createdLabel)
                MiniMetricCard(label: "Last used", value: key.lastUsedLabel)
                MiniMetricCard(label: "Scopes", value: "\(key.scopes.count)")
            }

            if !key.scopes.isEmpty {
                LazyVStack(alignment: .leading, spacing: 6) {
                    ForEach(key.scopes.prefix(5)) { scope in
                        Text("\(scope.enabled ? "On" : "Off") · \(scope.method) \(scope.route) · \(scope.limits.summary.isEmpty ? "No limits" : scope.limits.summary)")
                            .font(.system(size: 10, weight: .semibold, design: .monospaced))
                            .foregroundStyle(scope.enabled ? theme.textSecondary : theme.textTertiary)
                            .lineLimit(1)
                    }
                }
            }

            HStack(spacing: 8) {
                ActionButton(title: key.enabled ? "Disable" : "Enable", icon: key.enabled ? "pause.circle" : "play.circle") {
                    Task { await model.setRateLimitApiKey(key, enabled: !key.enabled) }
                }
                ActionButton(title: "Delete", icon: "trash") {
                    deletingApiKey = key
                }
            }
        }
        .padding(13)
        .background(theme.cardRaised)
        .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))
    }

    func rateRow(icon: String, title: String, subtitle: String, active: Bool) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(active ? theme.accent : theme.textTertiary)
                .frame(width: 30, height: 30)
                .background(active ? theme.accentSoft : theme.cardRaised)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 12, weight: .black))
                    .foregroundStyle(theme.text)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(theme.textSecondary)
                    .lineLimit(2)
            }
            Spacer()
        }
        .padding(10)
        .background(theme.cardRaised)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    var filteredKeys: [DashboardApiKeySummary] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return model.apiKeys }
        return model.apiKeys.filter { key in
            let scopeText = key.scopes.map { "\($0.method) \($0.route) \($0.limits.summary)" }.joined(separator: " ")
            return [
                key.id,
                key.ownerId,
                key.name,
                key.tier,
                key.keyPrefix,
                key.description ?? "",
                scopeText,
            ].joined(separator: " ").lowercased().contains(query)
        }
    }

    func filteredRoutes(_ overview: DashboardRateLimitOverview) -> [DashboardRateLimitRoute] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return overview.routes }
        return overview.routes.filter { "\($0.method) \($0.route)".lowercased().contains(query) }
    }
}
