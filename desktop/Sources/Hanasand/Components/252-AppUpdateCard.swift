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

struct AppUpdateCard: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: "arrow.triangle.2.circlepath")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(theme.accent)
                    .frame(width: 38, height: 38)
                    .background(theme.accentSoft)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                VStack(alignment: .leading, spacing: 7) {
                    Text("Auto update")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(theme.text)
                    Text(model.updateStatus.message)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(theme.textSecondary)
                        .lineLimit(2)
                }
                Spacer()
                if model.updateStatus.isBusy {
                    ProgressView()
                        .scaleEffect(0.70)
                        .frame(width: 18, height: 18)
                }
                UpdateToolbarButton(title: "Check now", tint: theme.accent) {
                    Task {
                        await model.checkForUpdates()
                    }
                }
                .disabled(model.updateStatus.isBusy)
                if model.stagedUpdatePath != nil {
                    UpdateToolbarButton(title: "Reveal", tint: theme.text) {
                        model.revealStagedUpdate()
                    }
                }
            }

            HStack(spacing: 10) {
                UpdateMetric(label: "Installed", value: model.effectiveInstalledVersion)
                UpdateMetric(label: "Latest", value: model.updateManifest?.latestVersion ?? "Checking")
                UpdateMetric(label: "Source", value: "/api/app")
                UpdateMetric(label: "Channel", value: model.updateManifest?.channel.capitalized ?? "Stable")
            }

            if let manifest = model.updateManifest {
                Text(manifest.notes)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(theme.textTertiary)
            }
        }
        .padding(18)
        .background(theme.card)
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(theme.divider, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}
