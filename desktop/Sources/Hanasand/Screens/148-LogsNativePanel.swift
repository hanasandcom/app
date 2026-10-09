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

struct LogsNativePanel: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme
    @State var searchText = ""
    @State var selectedService = "all"
    @State var selectedLevel = "all"
    @State var expandedIDs: Set<String> = []

    let columns = [
        GridItem(.adaptive(minimum: 220), spacing: 12, alignment: .top),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
                FeatureCard(title: "Logs", value: "\(model.logs.count)", icon: "doc.text.magnifyingglass")
                FeatureCard(title: "Errors", value: "\(model.logs.filter(\.isError).count)", icon: "exclamationmark.triangle")
                FeatureCard(title: "Services", value: "\(services.count)", icon: "server.rack")
                FeatureCard(title: "Native", value: "\(model.logs.filter { $0.source == "native" }.count)", icon: "lock.shield")
            }

            HStack(spacing: 10) {
                SearchFieldRow(placeholder: "Search logs by service, host, message, or metadata", text: $searchText)
                ActionButton(title: "Refresh", icon: "arrow.clockwise") {
                    Task { await model.loadNativeDashboardData() }
                }
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    FilterChip(title: "All services", active: selectedService == "all") {
                        selectedService = "all"
                    }
                    ForEach(services.prefix(12), id: \.self) { service in
                        FilterChip(title: service, active: selectedService == service) {
                            selectedService = service
                        }
                    }
                }
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(["all", "fatal", "error", "warn", "info", "debug"], id: \.self) { level in
                        FilterChip(title: level.capitalized, active: selectedLevel == level) {
                            selectedLevel = level
                        }
                    }
                }
            }

            if model.logs.isEmpty {
                NativeEmptyState(title: "No logs loaded", message: "Use Refresh to load application logs. Try the Logs dashboard after configuring auth in Settings.")
            } else if filteredLogs.isEmpty {
                NativeGroupPanel(title: "No matching logs", subtitle: "Adjust service, level, or search filters.") {
                    Text("The native log viewer has data loaded, but none of the entries match the active filters.")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(theme.textSecondary)
                }
            } else {
                LazyVStack(alignment: .leading, spacing: 10) {
                    ForEach(filteredLogs.prefix(120)) { log in
                        logRow(log)
                    }
                }
            }
        }
    }

    var services: [String] {
        Array(Set(model.logs.map(\.service))).sorted()
    }

    var filteredLogs: [DashboardLogEntry] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return model.logs.filter { log in
            let serviceMatch = selectedService == "all" || log.service == selectedService
            let levelMatch = selectedLevel == "all" || log.level == selectedLevel
            let searchable = [
                log.service,
                log.host ?? "",
                log.level,
                log.message,
                log.source ?? "",
                log.metadata?.pretty ?? "",
            ].joined(separator: " ").lowercased()
            return serviceMatch && levelMatch && (query.isEmpty || searchable.contains(query))
        }
    }

    @ViewBuilder
    func logRow(_ log: DashboardLogEntry) -> some View {
        let isOpen = expandedIDs.contains(log.id)
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: log.isError ? "exclamationmark.triangle.fill" : "terminal")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(log.isError ? theme.danger : theme.accent)
                    .frame(width: 34, height: 34)
                    .background(theme.cardRaised)
                    .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))

                Button {
                    if isOpen {
                        expandedIDs.remove(log.id)
                    } else {
                        expandedIDs.insert(log.id)
                    }
                } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 8) {
                            Text(log.service)
                                .font(.system(size: 12, weight: .black))
                                .foregroundStyle(theme.text)
                            Text(log.level.uppercased())
                                .font(.system(size: 10, weight: .black))
                                .foregroundStyle(log.isError ? theme.danger : theme.textTertiary)
                            if let source = log.source {
                                Text(source)
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundStyle(theme.textTertiary)
                            }
                        }
                        Text(log.message.isEmpty ? "No message" : log.message)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(theme.textSecondary)
                            .lineLimit(isOpen ? nil : 2)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .buttonStyle(.plain)

                Spacer()
                VStack(alignment: .trailing, spacing: 5) {
                    Text(log.createdLabel)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(theme.textTertiary)
                    if let host = log.host, !host.isEmpty {
                        Text(host)
                            .font(.system(size: 10, weight: .semibold, design: .monospaced))
                            .foregroundStyle(theme.textTertiary)
                            .lineLimit(1)
                    }
                }
            }

            if isOpen, let metadata = log.metadata {
                Text(metadata.pretty)
                    .font(.system(size: 11, weight: .semibold, design: .monospaced))
                    .foregroundStyle(theme.textTertiary)
                    .textSelection(.enabled)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(theme.backgroundElevated.opacity(0.72))
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
        .padding(13)
        .background(theme.card)
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(log.isError ? theme.danger.opacity(0.45) : theme.divider, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}
