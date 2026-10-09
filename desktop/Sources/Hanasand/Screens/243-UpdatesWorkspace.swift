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

struct UpdatesWorkspace: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme

    var body: some View {
        FeatureWorkspace(title: "Updates", subtitle: "Desktop package feed, staged installers, and automatic checks") {
            HStack(spacing: 12) {
                FeatureCard(title: "Installed", value: DesktopAgentModel.appVersion, icon: "shippingbox")
                FeatureCard(title: "Latest", value: model.updateManifest?.latestVersion ?? "Checking", icon: "arrow.triangle.2.circlepath")
                FeatureCard(title: "Auto check", value: updateIntervalLabel, icon: "timer")
            }

            AppUpdateCard()

            NativeGroupPanel(title: updatePackageTitle, subtitle: updatePackageSubtitle) {
                HStack(spacing: 10) {
                    Image(systemName: model.stagedUpdatePath == nil ? "tray" : "checkmark.seal.fill")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(model.stagedUpdatePath == nil ? theme.textTertiary : theme.green)
                        .frame(width: 34, height: 34)
                        .background(theme.field)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

                    Text(model.stagedUpdatePath.map { URL(fileURLWithPath: $0).lastPathComponent } ?? "The app will install newer packages in the background after they are downloaded.")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(theme.textSecondary)
                        .lineLimit(2)
                        .textSelection(.enabled)

                    Spacer(minLength: 0)

                    if model.stagedUpdatePath != nil {
                        ActionButton(title: "Reveal", icon: "folder") {
                            model.revealStagedUpdate()
                        }
                    }
                }
            }
        }
    }

    var updateIntervalLabel: String {
        let seconds = DesktopAgentModel.automaticUpdateCheckInterval
        if seconds >= 60 {
            return "\(Int(seconds / 60)) min"
        }
        return "\(Int(seconds)) sec"
    }

    var updatePackageTitle: String {
        model.backgroundInstalledUpdateVersion.isEmpty ? "Update package" : "Installed update"
    }

    var updatePackageSubtitle: String {
        if !model.backgroundInstalledUpdateVersion.isEmpty {
            return "Installed in place. Active on next launch."
        }
        return model.stagedUpdatePath == nil ? "No local installer staged" : "Ready in Application Support"
    }
}
