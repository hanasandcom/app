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

struct NativeDashboardDetail: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme

    var body: some View {
        FeatureWorkspace(title: model.selectedDashboardTitle, subtitle: statusSubtitle) {
            HStack(spacing: 8) {
                detailToolbarButton(title: "Back", icon: "chevron.left") {
                    model.closeNativeDashboardPage()
                }
                if !hasPanelRefresh {
                    detailToolbarButton(title: "Refresh", icon: "arrow.clockwise") {
                        Task { await model.loadNativeDashboardData() }
                    }
                }
                if model.isLoadingNativeDashboard {
                    ProgressView()
                        .scaleEffect(0.70)
                }
            }

            nativeDashboardBody
        }
        .task(id: model.selectedDashboardPath) {
            await model.loadNativeDashboardData()
        }
    }

    private var hasPanelRefresh: Bool {
        ["/dashboard/automations", "/dashboard/automation", "/system/cron"].contains(model.selectedDashboardPath ?? "")
    }

    private var statusSubtitle: String {
        ["Ready", "Native controls"].contains(model.nativeDashboardStatus) ? "" : model.nativeDashboardStatus
    }

    private func detailToolbarButton(title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(theme.textSecondary)
                .padding(.horizontal, 10)
                .frame(height: 30)
                .background(theme.card, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    var nativeDashboardBody: some View {
        switch model.selectedDashboardPath {
        case "/dashboard":
            DashboardOverviewNativePanel()
        case "/g":
            LinksNativePanel()
        case "/dashboard/tests":
            RecentTestsNativePanel()
        case "/dashboard/automations", "/dashboard/automation":
            AutomationsNativePanel()
        case "/system/cron":
            SystemCronNativePanel()
        case "/mail":
            MailNativePanel()
        case "/system":
            SystemNativePanel()
        case "/vms":
            VMsNativePanel()
        case "/logs":
            LogsNativePanel()
        case "/system/ai":
            AIModelsNativePanel()
        case "/system/rates":
            RateLimitsNativePanel()
        case "/profile":
            ProfileNativePanel()
        case "/management", "/users":
            UsersNativePanel()
        case "/role":
            RolesNativePanel()
        case "/s":
            SharesNativePanel()
        case "/content/articles":
            ArticlesNativePanel()
        case "/content/thoughts":
            ThoughtsNativePanel()
        case "/notes":
            NotesNativePanel()
        case "/db":
            DatabaseNativePanel()
        case "/db/backups":
            BackupNativePanel()
        case "/db/restore":
            RestoreNativePanel()
        case "/vulnerabilities":
            VulnerabilityNativePanel()
        case "/traffic":
            TrafficNativePanel()
        case "/upload", "/dashboard/files":
            UploadNativePanel()
        default:
            NativeRouteFallbackPanel()
        }
    }
}
