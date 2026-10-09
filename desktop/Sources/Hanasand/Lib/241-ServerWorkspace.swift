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

struct ServerWorkspace: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme
    @State var confirmServerStop = false

    var body: some View {
        FeatureWorkspace(title: "Server", subtitle: model.serverSummary) {
            HStack(spacing: 10) {
                ActionButton(title: "VPN", icon: "lock.shield") {
                    model.openVPN()
                }
                ActionButton(title: "Mac mini", icon: "macmini") {
                    model.configureMacMiniRemoteDesktop()
                }
                ActionButton(title: "Tunnel", icon: "point.3.connected.trianglepath.dotted") {
                    model.openRemoteDesktopTunnel()
                }
                ActionButton(title: "Connect", icon: "display") {
                    model.openRemoteDesktop()
                }
                ActionButton(title: model.isCheckingServerReachability ? "Checking" : "Health check", icon: "heart.text.square") {
                    Task { await model.checkServerReachability() }
                }
                .disabled(model.isServerBusy)
                ActionButton(title: "Copy diagnostics", icon: "doc.on.doc") {
                    model.copyServerDiagnostics()
                }
                ActionButton(title: "Logs", icon: "doc.text.magnifyingglass") {
                    Task { await model.checkServerLogs() }
                }
                .disabled(model.isServerBusy)
            }
            HStack(spacing: 10) {
                ActionButton(title: model.isRunningServerAction ? "Working" : "Start", icon: model.isRunningServerAction ? "circle.dotted" : "play.fill") {
                    Task { await model.runServerAction(model.settings.serverStartPath) }
                }
                .disabled(model.isServerBusy)
                ActionButton(title: "Stop", icon: "stop.fill", tone: .danger) {
                    confirmServerStop = true
                }
                .disabled(model.isServerBusy)
            }

            HStack(spacing: 12) {
                FeatureCard(title: "Management plane", value: model.settings.serverBaseURL, icon: "server.rack")
                FeatureCard(title: "Internal API", value: model.settings.internalAPIBaseURL, icon: "network")
                FeatureCard(title: "Server action", value: model.serverActionStatus, icon: model.isServerBusy ? "circle.dotted" : "bolt.circle")
                FeatureCard(
                    title: "Remote target",
                    value: "\(model.remoteDesktopProtocolLabel) · \(model.remoteDesktopTargetSummary)",
                    icon: model.remoteDesktopProtocolIcon
                )
            }

            NativeGroupPanel(title: "Remote desktop", subtitle: model.remoteControlSummary) {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 180), spacing: 12)], alignment: .leading, spacing: 12) {
                    FeatureCard(title: "Target", value: model.remoteDesktopTargetSummary, icon: model.remoteDesktopProtocolIcon)
                    FeatureCard(title: "Last app command", value: model.remoteControlLastCommand, icon: "iphone.gen3")
                    FeatureCard(title: "Requests", value: "\(model.remoteControlRequests)", icon: "arrow.left.arrow.right")
                }
                HStack(spacing: 10) {
                    ActionButton(title: "Status", icon: "waveform.path.ecg") {
                        model.showRemoteDesktopStatus()
                    }
                    ActionButton(title: "Connect", icon: "display") {
                        model.openRemoteDesktop()
                    }
                    ActionButton(title: "Tunnel", icon: "point.3.connected.trianglepath.dotted") {
                        model.requestRemoteTunnelApproval()
                    }
                    ActionButton(title: "Mac mini", icon: "macmini") {
                        model.configureMacMiniRemoteDesktop()
                    }
                }
            }

            NativeGroupPanel(title: "Connection status", subtitle: model.isCheckingServerReachability ? "Checking VPN/internal routes..." : model.serverReachabilityCheckedText) {
                if model.serverReachability.isEmpty {
                    NativeEmptyState(title: "Unchecked", message: "Run Health check before server actions. The app will also check automatically before Start, Stop, and Logs.")
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 12)], alignment: .leading, spacing: 12) {
                        ForEach(model.serverReachability) { status in
                            ServerEndpointStatusCard(status: status)
                        }
                    }
                }
                Text("Blocked? Connect VPN, then run Health check.")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(theme.textTertiary)
            }
        }
        .alert("Stop server?", isPresented: $confirmServerStop) {
            Button("Stop server", role: .destructive) {
                model.requestStopServerApproval()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This can interrupt active sessions. Continue only when you intend to stop the configured server target.")
        }
    }
}
