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

extension RecentTestsNativePanel {

    var columns: [GridItem] {
        [GridItem(.adaptive(minimum: 280), spacing: 12, alignment: .top)]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
                FeatureCard(title: "Tests", value: "\(model.recentTests.count)", icon: "speedometer")
                FeatureCard(title: "Done", value: "\(model.recentTests.filter { $0.statusLabel.lowercased() == "done" }.count)", icon: "checkmark.circle")
                FeatureCard(title: "Running", value: "\(model.recentTests.filter { $0.statusLabel.lowercased() == "running" }.count)", icon: "waveform.path.ecg")
                FeatureCard(title: "Visits", value: "\(model.recentTests.reduce(0) { $0 + ($1.visits ?? 0) })", icon: "eye")
            }

            HStack(spacing: 10) {
                SearchFieldRow(placeholder: "Search tests by URL, id, or status", text: $searchText)
                ActionButton(title: "Refresh", icon: "arrow.clockwise") {
                    Task { await model.loadNativeDashboardData() }
                }
            }

            NativeGroupPanel(title: "Start a load test", subtitle: "Create and run a check without opening the website.") {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 10)], alignment: .leading, spacing: 10) {
                    testField("Target URL", text: $model.testDraftURL, placeholder: "https://example.com")
                    testField("Timeout seconds", text: $model.testDraftTimeout, placeholder: "30")
                    testField("Stages", text: $model.testDraftStages, placeholder: "30s:5, 1m:15")
                }
                HStack(spacing: 10) {
                    ActionButton(title: "Create and run", icon: "play.circle") {
                        Task { await model.createNativeLoadTest() }
                    }
                    Text("Stages use duration:target pairs.")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(theme.textTertiary)
                }
            }

            if let detail = model.selectedTestDetail {
                selectedTestPanel(detail)
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

            if model.recentTests.isEmpty {
                NativeEmptyState(title: "No recent tests loaded", message: "Use Refresh to load load-test runs.")
            } else if filteredTests.isEmpty {
                NativeGroupPanel(title: "No matching tests", subtitle: "Adjust status or search filters.") {
                    Text("Recent tests are loaded, but none match the active filters.")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(theme.textSecondary)
                }
            } else {
                LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
                    ForEach(filteredTests) { test in
                        testCard(test)
                    }
                }
            }
        }
    }

    func testField(_ label: String, text: Binding<String>, placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 10, weight: .black))
                .foregroundStyle(theme.textTertiary)
                .textCase(.uppercase)
            TextField(placeholder, text: text)
                .textFieldStyle(.plain)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(theme.text)
                .padding(11)
                .background(theme.field)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }

    func selectedTestPanel(_ test: DashboardRecentTest) -> some View {
        NativeGroupPanel(title: "Selected test", subtitle: "Test \(test.id)") {
            HStack(spacing: 10) {
                FeatureCard(title: "Status", value: test.statusLabel.capitalized, icon: "waveform.path.ecg")
                FeatureCard(title: "Timeout", value: test.timeout.map { "\($0)s" } ?? "Default", icon: "timer")
                FeatureCard(title: "Finished", value: test.finishedLabel, icon: "checkmark.seal")
            }

            Text(test.displayURL)
                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                .foregroundStyle(theme.textSecondary)
                .lineLimit(2)

            HStack(spacing: 8) {
                ActionButton(title: "Refresh detail", icon: "arrow.clockwise") {
                    Task { await model.loadLoadTestDetail(test) }
                }
                ActionButton(title: "Rerun", icon: "play.fill") {
                    Task { await model.rerunLoadTest(test) }
                }
                ActionButton(title: "Copy link", icon: "doc.on.doc") {
                    model.copyLoadTestLink(test)
                }
                ActionButton(title: "Open", icon: "arrow.up.right") {
                    model.openWebsite(path: "/test/\(test.id)", label: "Test \(test.id)")
                }
            }

            if let summary = test.activeSummary {
                Text(summary.pretty)
                    .font(.system(size: 11, weight: .semibold, design: .monospaced))
                    .foregroundStyle(theme.textSecondary)
                    .lineLimit(8)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(theme.backgroundElevated.opacity(0.72))
                    .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
            }
        }
    }

    var statuses: [String] {
        ["all"] + Array(Set(model.recentTests.map { $0.statusLabel.lowercased() })).sorted()
    }

    var filteredTests: [DashboardRecentTest] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return model.recentTests.filter { test in
            let statusMatch = selectedStatus == "all" || test.statusLabel.lowercased() == selectedStatus
            let searchable = [
                test.id,
                test.displayURL,
                test.statusLabel,
            ].joined(separator: " ").lowercased()
            return statusMatch && (query.isEmpty || searchable.contains(query))
        }
    }
}
