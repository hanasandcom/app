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

struct RestoreNativePanel: View {
    @EnvironmentObject var model: DesktopAgentModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                ActionButton(title: "Refresh files", icon: "arrow.clockwise") {
                    Task { await model.loadNativeDashboardData() }
                }
            }
            if model.backupFiles.isEmpty {
                NativeEmptyState(title: "No restore files loaded", message: "Use Refresh files to load backup artifacts before attempting a restore.")
            } else {
                NativeGroupPanel(title: "Backup files", subtitle: "\(model.backupFiles.count) restore candidates") {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 12)], spacing: 12) {
                        ForEach(model.backupFiles) { backup in
                            VStack(alignment: .leading, spacing: 12) {
                                CompactInfoCard(
                                    title: backup.service,
                                    lines: [
                                        backup.file,
                                        backup.location ?? "unknown location",
                                        backup.size ?? "unknown size",
                                        formatDateText(backup.mtime, fallback: "unknown modified time"),
                                    ]
                                )
                                ActionButton(title: "Restore", icon: "arrow.counterclockwise", tone: .danger) {
                                    confirmRestore(backup)
                                }
                            }
                            .padding(12)
                            .background(Color.black.opacity(0.12))
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        }
                    }
                }
            }
        }
    }

    func confirmRestore(_ backup: DashboardBackupFile) {
        let alert = NSAlert()
        alert.messageText = "Restore \(backup.service)?"
        alert.informativeText = "This will restore \(backup.file). Continue only if this is the intended rollback target."
        alert.alertStyle = .critical
        alert.addButton(withTitle: "Restore")
        alert.addButton(withTitle: "Cancel")

        guard alert.runModal() == .alertFirstButtonReturn else { return }
        Task {
            await model.runNativeDashboardMutation(.restoreBackup(service: backup.service, file: backup.file))
        }
    }
}
