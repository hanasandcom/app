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

struct SettingsWorkspace: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme
    @State var showEndpointSettings = false
    @State var showRemoteSettings = false
    @State var confirmLogout = false

    var body: some View {
        FeatureWorkspace(title: "Settings", subtitle: "Account, appearance, updater, and advanced connections") {
            HStack(spacing: 12) {
                FeatureCard(title: "Endpoints", value: model.settings.hasValidEndpoints ? "Valid" : "Check", icon: model.settings.hasValidEndpoints ? "checkmark.seal" : "exclamationmark.triangle")
                FeatureCard(title: "Session", value: model.hasHanasandAuth ? "Ready" : "Login", icon: "person.crop.circle.badge.checkmark")
                FeatureCard(title: "Update checks", value: settingsUpdateIntervalLabel, icon: "timer")
            }

            NativeGroupPanel(title: "Account", subtitle: model.hasHanasandAuth ? "Signed in and ready for API calls" : "Sign in from the login screen to refresh the session") {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 10) {
                        Image(systemName: model.hasHanasandAuth ? "checkmark.seal.fill" : "person.crop.circle.badge.exclamationmark")
                            .foregroundStyle(model.hasHanasandAuth ? theme.green : theme.textTertiary)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(model.hasHanasandAuth ? "Session active" : "Session unavailable")
                                .font(.system(size: 13, weight: .bold))
                                .foregroundStyle(theme.text)
                            Text(model.settings.userID.isEmpty ? "Hanasand handles tokens in the background after login." : model.settings.userID)
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(theme.textSecondary)
                        }
                        Spacer()
                    }
                    .padding(12)
                    .background(theme.field)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    HStack {
                        Spacer()
                        ActionButton(title: "Log out", icon: "rectangle.portrait.and.arrow.right", tone: .danger) {
                            confirmLogout = true
                        }
                        .disabled(!model.hasHanasandAuth)
                    }
                    SettingsValidationPanel(settings: model.settings)
                }
            }

            NativeGroupPanel(title: "Theme", subtitle: "Native appearance") {
                HStack(spacing: 8) {
                    ForEach(AppearancePreference.allCases) { option in
                        AppearanceOptionButton(option: option, isSelected: model.appearancePreference == option) {
                            model.appearancePreference = option
                        }
                    }
                    Spacer()
                }
            }

            SettingsDisclosurePanel(
                title: "Advanced endpoints",
                subtitle: endpointSummary,
                icon: "network",
                isExpanded: $showEndpointSettings
            ) {
                VStack(alignment: .leading, spacing: 10) {
                    SettingsField(label: "API base", text: $model.settings.apiBaseURL)
                    SettingsField(label: "Internal API", text: $model.settings.internalAPIBaseURL)
                    SettingsField(label: "CDN base", text: $model.settings.cdnBaseURL)
                    SettingsField(label: "Codex path", text: $model.settings.codexAPIPath)
                    SettingsField(label: "AI endpoint", text: $model.settings.aiAPIURL)
                    SettingsField(label: "Desktop agent", text: $model.settings.desktopAgentBaseURL)
                }
            }

            SettingsDisclosurePanel(
                title: "Remote control",
                subtitle: "\(model.remoteDesktopProtocolLabel) · \(model.settings.serverBaseURL.normalizedBaseURL.host ?? "server")",
                icon: model.remoteDesktopProtocolIcon,
                isExpanded: $showRemoteSettings
            ) {
                VStack(alignment: .leading, spacing: 10) {
                    SettingsField(label: "VPN URL", text: $model.settings.vpnURLScheme)
                    Picker("Remote protocol", selection: $model.settings.remoteDesktopProtocol) {
                        ForEach(RemoteDesktopProtocol.allCases) { remoteProtocol in
                            Label(remoteProtocol.label, systemImage: remoteProtocol.icon)
                                .tag(remoteProtocol.rawValue)
                        }
                    }
                    .pickerStyle(.segmented)
                    SettingsField(label: "Remote host", text: $model.settings.rdpHost)
                    SettingsField(label: "Remote user", text: $model.settings.rdpUser)
                    SettingsField(label: "Tunnel command", text: $model.settings.remoteDesktopTunnelCommand)
                    SettingsField(label: "Server base", text: $model.settings.serverBaseURL)
                    SettingsField(label: "Start path", text: $model.settings.serverStartPath)
                    SettingsField(label: "Stop path", text: $model.settings.serverStopPath)
                    SettingsField(label: "Logs path", text: $model.settings.serverLogsPath)
                }
            }
        }
        .confirmationDialog("Log out of Hanasand?", isPresented: $confirmLogout) {
            Button("Log out", role: .destructive) {
                Task { await model.logoutFromHanasand() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This clears the desktop app session and returns to the login screen.")
        }
    }

    var endpointSummary: String {
        let host = model.settings.apiBaseURL.normalizedBaseURL.host ?? "API"
        return model.settings.hasValidEndpoints ? "\(host) · all URLs valid" : "\(host) · review URL issues"
    }

    var settingsUpdateIntervalLabel: String {
        let seconds = DesktopAgentModel.automaticUpdateCheckInterval
        if seconds >= 60 { return "\(Int(seconds / 60)) min" }
        return "\(Int(seconds)) sec"
    }
}
