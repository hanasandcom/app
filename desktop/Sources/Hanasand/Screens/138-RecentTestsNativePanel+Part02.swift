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

    func testCard(_ test: DashboardRecentTest) -> some View {
        NativeGroupPanel(title: test.displayURL, subtitle: "Test \(test.id)") {
            HStack(spacing: 10) {
                FeatureCard(title: "Status", value: test.statusLabel.capitalized, icon: test.statusLabel.lowercased() == "done" ? "checkmark.circle" : "waveform.path.ecg")
                FeatureCard(title: "p95", value: test.p95Milliseconds.map { "\(Int($0.rounded())) ms" } ?? "Unknown", icon: "timer")
                FeatureCard(title: "Requests", value: test.requestCount.map(String.init) ?? "0", icon: "arrow.left.arrow.right")
            }

            HStack(spacing: 8) {
                if let failureRate = test.failureRatePercent {
                    Text("fail \(String(format: "%.1f", failureRate))%")
                        .font(.system(size: 11, weight: .black))
                        .foregroundStyle(failureRate > 1 ? theme.danger : theme.green)
                        .padding(.horizontal, 9)
                        .frame(height: 24)
                        .background(theme.cardRaised)
                        .clipShape(Capsule())
                }
                if let delta = test.p95DeltaLabel {
                    Text(delta)
                        .font(.system(size: 11, weight: .black))
                        .foregroundStyle((test.p95DeltaMs ?? 0) >= 0 ? theme.green : theme.danger)
                        .padding(.horizontal, 9)
                        .frame(height: 24)
                        .background(theme.cardRaised)
                        .clipShape(Capsule())
                }
                Text("\(test.visits ?? 0) visits")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(theme.textSecondary)
                    .padding(.horizontal, 9)
                    .frame(height: 24)
                    .background(theme.cardRaised)
                    .clipShape(Capsule())
                Spacer()
            }

            HStack(spacing: 8) {
                Image(systemName: "calendar")
                Text(test.createdLabel)
                Spacer()
                ActionButton(title: "Details", icon: "doc.text.magnifyingglass") {
                    Task { await model.loadLoadTestDetail(test) }
                }
                ActionButton(title: "Rerun", icon: "play.fill") {
                    Task { await model.rerunLoadTest(test) }
                }
                ActionButton(title: "Copy", icon: "doc.on.doc") {
                    model.copyLoadTestLink(test)
                }
            }
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(theme.textSecondary)

            if let errors = test.errors, !errors.isEmpty {
                NativeNotice(message: errors.prefix(2).joined(separator: "\n"), title: "Load test issue")
            }
        }
    }
}
