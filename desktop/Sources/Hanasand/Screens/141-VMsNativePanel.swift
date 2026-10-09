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

struct VMsNativePanel: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme
    @State var searchText = ""
    @State var selectedStatus = "all"

    let columns = [
        GridItem(.adaptive(minimum: 280), spacing: 12, alignment: .top),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
                FeatureCard(title: "VMs", value: "\(model.virtualMachines.count)", icon: "display.2")
                FeatureCard(title: "Running", value: "\(model.virtualMachines.filter { ($0.status ?? "").lowercased() == "running" }.count)", icon: "play.circle")
                FeatureCard(title: "Stopped", value: "\(model.virtualMachines.filter { ($0.status ?? "").lowercased() == "stopped" }.count)", icon: "pause.circle")
            }

            HStack(spacing: 10) {
                SearchFieldRow(placeholder: "Search VMs by name, owner, IP, status, or tags", text: $searchText)
                ActionButton(title: "Refresh", icon: "arrow.clockwise") {
                    Task { await model.loadNativeDashboardData() }
                }
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(statuses, id: \.self) { status in
                        FilterChip(title: status.capitalized, active: selectedStatus == status) {
                            selectedStatus = status
                        }
                    }
                }
            }

            if model.virtualMachines.isEmpty {
                NativeEmptyState(title: "No VMs loaded", message: "Use Refresh to load VM access data. Configure auth and user id in Settings if this stays empty.")
            } else if filteredVMs.isEmpty {
                NativeGroupPanel(title: "No matching VMs", subtitle: "Adjust status or search filters.") {
                    Text("VM data is loaded, but no machines match the active filters.")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(theme.textSecondary)
                }
            } else {
                LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
                    ForEach(filteredVMs) { vm in
                        vmCard(vm)
                    }
                }
            }
        }
    }

    var statuses: [String] {
        let values = Set(model.virtualMachines.map { ($0.status ?? "unknown").lowercased() })
        return ["all"] + values.sorted()
    }

    var filteredVMs: [DashboardVM] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return model.virtualMachines.filter { vm in
            let statusMatch = selectedStatus == "all" || (vm.status ?? "unknown").lowercased() == selectedStatus
            let searchable = [
                vm.name,
                vm.ownerLabel,
                vm.statusLabel,
                vm.description ?? "",
                vm.ipv4 ?? "",
                vm.tags.joined(separator: " "),
            ].joined(separator: " ").lowercased()
            return statusMatch && (query.isEmpty || searchable.contains(query))
        }
    }

    func vmCard(_ vm: DashboardVM) -> some View {
        NativeGroupPanel(title: vm.name, subtitle: vm.ownerLabel) {
            HStack(spacing: 10) {
                FeatureCard(title: "Status", value: vm.statusLabel, icon: vm.statusLabel.lowercased() == "running" ? "checkmark.circle" : "circle.dashed")
                FeatureCard(title: "CPU", value: vm.cpuLimit ?? "Unknown", icon: "cpu")
                FeatureCard(title: "Memory", value: vm.memoryLimit ?? "Unknown", icon: "memorychip")
            }

            if let description = vm.description, !description.isEmpty {
                Text(description)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(theme.textSecondary)
                    .lineLimit(2)
            }

            HStack(spacing: 8) {
                Image(systemName: "calendar")
                Text("Created \(vm.createdLabel)")
                Spacer()
                Image(systemName: "clock.arrow.circlepath")
                Text(vm.lastUsedLabel)
            }
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(theme.textTertiary)

            if !vm.tags.isEmpty {
                HStack(spacing: 8) {
                    ForEach(vm.tags.prefix(4), id: \.self) { tag in
                        Text(tag)
                            .font(.system(size: 11, weight: .black))
                            .foregroundStyle(theme.textSecondary)
                            .padding(.horizontal, 9)
                            .padding(.vertical, 5)
                            .background(theme.cardRaised)
                            .clipShape(Capsule())
                    }
                }
            }

            HStack(spacing: 8) {
                ActionButton(title: "Start", icon: "play.circle") {
                    Task { await model.runVirtualMachineAction(vm, action: "start") }
                }
                ActionButton(title: "Restart", icon: "arrow.clockwise") {
                    Task { await model.runVirtualMachineAction(vm, action: "restart") }
                }
                ActionButton(title: "Stop", icon: "stop.circle", tone: .danger) {
                    Task { await model.runVirtualMachineAction(vm, action: "stop") }
                }
            }
        }
    }
}
