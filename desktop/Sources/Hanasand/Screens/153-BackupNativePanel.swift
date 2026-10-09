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

struct BackupNativePanel: View {
    @EnvironmentObject var model: DesktopAgentModel

    var body: some View {
        HStack(spacing: 10) {
            ActionButton(title: "Run backup now", icon: "externaldrive.badge.timemachine") {
                Task { await model.runNativeDashboardMutation(.runBackup) }
            }
            ActionButton(title: "Refresh", icon: "arrow.clockwise") {
                Task { await model.loadNativeDashboardData() }
            }
        }
        if model.backupServices.isEmpty {
            NativeEmptyState(title: "No backup services loaded", message: "Use Refresh to load backup status from the internal API, or run a backup when internal access is available.")
        } else {
            ForEach(model.backupServices) { backup in
                NativeGroupPanel(title: backup.name, subtitle: backup.id) {
                    HStack(spacing: 12) {
                        FeatureCard(title: "Status", value: backup.status, icon: backup.status.lowercased().contains("up") ? "checkmark.circle" : "xmark.octagon")
                        FeatureCard(title: "Database", value: backup.dbSize ?? "Unknown", icon: "internaldrive")
                        FeatureCard(title: "Storage", value: backup.totalStorage ?? "Unknown", icon: "tray.full")
                    }
                    HStack(spacing: 12) {
                        CompactInfoCard(title: "Last backup", lines: [formatDateText(backup.lastBackup, fallback: "Never")])
                        CompactInfoCard(title: "Next backup", lines: [formatDateText(backup.nextBackup, fallback: "Not scheduled")])
                        CompactInfoCard(title: "Restore", lines: ["Open restore files from the restore endpoint before executing destructive restore."])
                    }
                    if let error = backup.error, !error.isEmpty {
                        CompactInfoCard(title: "Error", lines: [error])
                    }
                }
            }
        }
    }
}
