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

struct TrafficNativePanel: View {
    @EnvironmentObject var model: DesktopAgentModel

    var body: some View {
        if let metrics = model.trafficMetrics {
            HStack(spacing: 12) {
                FeatureCard(title: "Requests", value: "\(metrics.totalRequests)", icon: "arrow.left.arrow.right")
                FeatureCard(title: "Avg request", value: "\(String(format: "%.2f", metrics.avgRequestTime))s", icon: "timer")
                FeatureCard(title: "Error rate", value: "\(String(format: "%.2f", metrics.errorRate))%", icon: "exclamationmark.triangle")
            }
            NativeGroupPanel(title: "Top domains", subtitle: "Live traffic breakdown") {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 190), spacing: 12)], spacing: 12) {
                    ForEach(metrics.topDomains) { domain in
                        CompactInfoCard(title: domain.key, lines: ["\(domain.count) requests"])
                    }
                }
            }
        } else {
            NativeEmptyState(title: "Traffic metrics not loaded", message: "Use Refresh to load traffic metrics from Hanasand.")
        }
    }
}
