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

struct DashboardOverviewNativePanel: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme
    @State var searchText = ""
    @State var selectedStatus = "all"

    let columns = [
        GridItem(.adaptive(minimum: 260), spacing: 12, alignment: .top),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
                FeatureCard(title: "Overall", value: status?.overall.capitalized ?? "Unknown", icon: statusIcon(status?.overall ?? "unknown"))
                FeatureCard(title: "Checks", value: "\(status?.checks.count ?? 0)", icon: "checklist")
                FeatureCard(title: "Down", value: "\(status?.checks.filter { $0.statusLabel.lowercased() == "down" }.count ?? 0)", icon: "xmark.octagon")
                FeatureCard(title: "Generated", value: status?.generatedLabel ?? "Unknown", icon: "clock")
            }

            HStack(spacing: 10) {
                SearchFieldRow(placeholder: "Search services or checks", text: $searchText)
                ActionButton(title: "Refresh", icon: "arrow.clockwise") {
                    Task { await model.loadNativeDashboardData() }
                }
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(statuses, id: \.self) { value in
                        FilterChip(title: value.capitalized, active: selectedStatus == value) {
                            selectedStatus = value
                        }
                    }
                }
            }

            if status == nil {
                NativeEmptyState(title: "Status not loaded", message: "Use Refresh to load service status checks.")
            } else if filteredChecks.isEmpty {
                NativeGroupPanel(title: "No matching checks", subtitle: "Adjust service search or status filters.") {
                    Text("Service checks are loaded, but none match the active filters.")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(theme.textSecondary)
                }
            } else {
                LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
                    ForEach(groupedChecks, id: \.service) { group in
                        serviceCard(service: group.service, checks: group.checks)
                    }
                }
            }
        }
    }

    var status: DashboardServiceStatus? {
        model.serviceStatus
    }

    var statuses: [String] {
        ["all"] + Array(Set((status?.checks ?? []).map { $0.statusLabel.lowercased() })).sorted()
    }

    var filteredChecks: [ServiceCheck] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return (status?.checks ?? []).filter { check in
            let statusMatch = selectedStatus == "all" || check.statusLabel.lowercased() == selectedStatus
            let searchable = [
                check.service,
                check.checkLabel,
                check.statusLabel,
                check.message ?? "",
            ].joined(separator: " ").lowercased()
            return statusMatch && (query.isEmpty || searchable.contains(query))
        }
    }

    var groupedChecks: [(service: String, checks: [ServiceCheck])] {
        Dictionary(grouping: filteredChecks, by: \.service)
            .map { (service: $0.key, checks: $0.value.sorted { $0.checkName < $1.checkName }) }
            .sorted { $0.service < $1.service }
    }

    func serviceCard(service: String, checks: [ServiceCheck]) -> some View {
        let worstStatus = checks.contains { $0.statusLabel.lowercased() == "down" }
            ? "down"
            : checks.contains { $0.statusLabel.lowercased() == "degraded" }
                ? "degraded"
                : "up"

        return NativeGroupPanel(title: service, subtitle: "\(checks.count) checks") {
            HStack(spacing: 10) {
                FeatureCard(title: "Status", value: worstStatus.capitalized, icon: statusIcon(worstStatus))
                FeatureCard(title: "Avg latency", value: averageLatencyLabel(checks), icon: "timer")
                FeatureCard(title: "Uptime", value: averageUptimeLabel(checks), icon: "arrow.up.heart")
            }

            LazyVStack(alignment: .leading, spacing: 8) {
                ForEach(checks) { check in
                    HStack(alignment: .top, spacing: 10) {
                        Circle()
                            .fill(statusColor(check.statusLabel))
                            .frame(width: 9, height: 9)
                            .padding(.top, 5)
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 8) {
                                Text(check.checkLabel)
                                    .font(.system(size: 12, weight: .black))
                                    .foregroundStyle(theme.text)
                                    .lineLimit(1)
                                Text(check.statusLabel.uppercased())
                                    .font(.system(size: 10, weight: .black))
                                    .foregroundStyle(statusColor(check.statusLabel))
                            }
                            Text([check.latencyLabel, check.uptimeLabel, check.checkedLabel].joined(separator: " · "))
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(theme.textTertiary)
                                .lineLimit(1)
                            if let message = check.message, !message.isEmpty {
                                Text(message)
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundStyle(theme.textSecondary)
                                    .lineLimit(2)
                            }
                        }
                        Spacer()
                    }
                    .padding(10)
                    .background(theme.cardRaised)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }
        }
    }

    func averageLatencyLabel(_ checks: [ServiceCheck]) -> String {
        let values = checks.compactMap(\.latencyMs)
        guard !values.isEmpty else { return "Unknown" }
        return "\(Int((values.reduce(0, +) / Double(values.count)).rounded())) ms"
    }

    func averageUptimeLabel(_ checks: [ServiceCheck]) -> String {
        let values = checks.compactMap { Double($0.uptime30d ?? "") }
        guard !values.isEmpty else { return "0%" }
        return "\(String(format: "%.1f", values.reduce(0, +) / Double(values.count)))%"
    }

    func statusIcon(_ value: String) -> String {
        switch value.lowercased() {
        case "up": return "checkmark.circle"
        case "degraded": return "exclamationmark.triangle"
        case "down": return "xmark.octagon"
        default: return "questionmark.circle"
        }
    }

    func statusColor(_ value: String) -> Color {
        switch value.lowercased() {
        case "up": return theme.green
        case "degraded": return theme.accent
        case "down": return theme.danger
        default: return theme.textTertiary
        }
    }
}
