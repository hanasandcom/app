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

struct SystemNativePanel: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme
    @State var searchText = ""
    @State var restartCandidate: DashboardDockerContainer?

    let columns = [
        GridItem(.adaptive(minimum: 250), spacing: 12, alignment: .top),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
                FeatureCard(title: "Containers", value: "\(model.dockerContainers.count)", icon: "shippingbox")
                FeatureCard(title: "Running", value: "\(model.dockerContainers.filter(\.isRunning).count)", icon: "play.circle")
                FeatureCard(title: "Stopped", value: "\(model.dockerContainers.filter { !$0.isRunning }.count)", icon: "pause.circle")
            }

            HStack(spacing: 10) {
                SearchFieldRow(placeholder: "Search containers by name, status, or id", text: $searchText)
                ActionButton(title: "Refresh", icon: "arrow.clockwise") {
                    Task { await model.loadNativeDashboardData() }
                }
            }

            if model.dockerContainers.isEmpty {
                NativeEmptyState(title: "No containers loaded", message: "Use Refresh to load Docker metrics from the API. Configure auth in Settings if this stays empty.")
            } else if filteredContainers.isEmpty {
                NativeGroupPanel(title: "No matching containers", subtitle: "Adjust the search field.") {
                    Text("Docker data is loaded, but none of the containers match the active search.")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(theme.textSecondary)
                }
            } else {
                LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
                    ForEach(filteredContainers) { container in
                        dockerContainerCard(container)
                    }
                }
            }
        }
        .confirmationDialog(
            "Restart Docker container?",
            isPresented: Binding(
                get: { restartCandidate != nil },
                set: { if !$0 { restartCandidate = nil } }
            ),
            titleVisibility: .visible
        ) {
            if let container = restartCandidate {
                Button("Restart \(container.displayName)", role: .destructive) {
                    Task { await model.restartDockerContainer(container) }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            if let container = restartCandidate {
                Text("This sends the same restart request as the website for \(container.displayName).")
            }
        }
    }

    var filteredContainers: [DashboardDockerContainer] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return model.dockerContainers }
        return model.dockerContainers.filter { container in
            [
                container.id,
                container.displayName,
                container.statusLabel,
                container.createdAt ?? "",
            ].joined(separator: " ").lowercased().contains(query)
        }
    }

    func dockerContainerCard(_ container: DashboardDockerContainer) -> some View {
        NativeGroupPanel(title: container.displayName, subtitle: String(container.id.prefix(18))) {
            HStack(spacing: 10) {
                FeatureCard(title: "Status", value: container.statusLabel, icon: container.isRunning ? "checkmark.circle" : "pause.circle")
                FeatureCard(title: "CPU", value: container.cpuLabel, icon: "cpu")
                FeatureCard(title: "Memory", value: container.memoryLabel, icon: "memorychip")
            }

            HStack(spacing: 8) {
                Image(systemName: "clock")
                Text(container.createdLabel)
                Spacer()
                ActionButton(title: "Restart", icon: "arrow.clockwise") {
                    restartCandidate = container
                }
            }
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(theme.textSecondary)
        }
    }
}
