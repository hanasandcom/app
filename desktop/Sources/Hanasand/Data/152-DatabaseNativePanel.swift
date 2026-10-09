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

struct DatabaseNativePanel: View {
    @EnvironmentObject var model: DesktopAgentModel

    var body: some View {
        if let overview = model.databaseOverview {
            HStack(spacing: 12) {
                FeatureCard(title: "Clusters", value: "\(overview.clusterCount)", icon: "server.rack")
                FeatureCard(title: "Databases", value: "\(overview.databaseCount)", icon: "externaldrive")
                FeatureCard(title: "Storage", value: formatBytes(overview.totalSizeBytes), icon: "internaldrive")
                FeatureCard(title: "Active queries", value: "\(overview.activeQueries)", icon: "play.circle")
            }
            ForEach(overview.clusters) { cluster in
                NativeGroupPanel(title: cluster.name.isEmpty ? cluster.id : cluster.name, subtitle: [cluster.engine, cluster.version, cluster.host].compactMap { $0 }.joined(separator: " · ")) {
                    if let error = cluster.error, !error.isEmpty {
                        NativeNotice(message: error, title: "Cluster unavailable")
                    } else {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 190), spacing: 12)], spacing: 12) {
                            ForEach(cluster.databases) { database in
                                CompactInfoCard(
                                    title: database.name,
                                    lines: [
                                        "Tables: \(database.tableCount)",
                                        "Connections: \(database.activeConnections ?? 0)",
                                        "Size: \(formatBytes(database.sizeBytes))",
                                    ]
                                )
                            }
                        }
                    }
                }
            }
        } else {
            NativeEmptyState(title: "Database overview not loaded", message: "Use Refresh to load database clusters from the internal API. Internal auth and network access are required.")
        }
    }
}
