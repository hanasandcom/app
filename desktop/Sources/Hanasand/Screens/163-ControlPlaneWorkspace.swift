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

struct ControlPlaneWorkspace: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme
    let commandFocused: FocusState<Bool>.Binding

    var body: some View {
        FeatureWorkspace(title: "Control", subtitle: model.currentTaskState) {
            NativeGroupPanel(title: "Command", subtitle: "") {
                HStack(alignment: .center, spacing: 12) {
                    TextField("Prompt Codex or type a command", text: $model.prompt, axis: .vertical)
                        .focused(commandFocused)
                        .textFieldStyle(.plain)
                        .font(.system(size: 21, weight: .semibold))
                        .lineLimit(1...5)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 14)
                        .background(theme.field)
                        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .onSubmit { model.submitPrompt() }
                    ActionButton(title: model.isRunning ? "Running" : "Run", icon: model.isRunning ? "circle.dotted" : "paperplane.fill") {
                        model.submitPrompt()
                    }
                    .disabled(model.isRunning)
                }

                HStack(spacing: 10) {
                    ControlStateChip(title: "State", value: model.currentTaskState, icon: model.isRunning ? "bolt.horizontal.circle" : "checkmark.circle")
                    ControlStateChip(title: "Mac", value: model.status.ok ? "Ready" : "Offline", icon: "desktopcomputer")
                    ControlStateChip(title: "Server", value: model.serverReachabilitySummary, icon: "server.rack")
                    ControlStateChip(title: "Health", value: model.serverReachabilityCheckedText, icon: "heart.text.square")
                    ControlStateChip(title: "Action", value: model.serverActionStatus, icon: model.isServerBusy ? "circle.dotted" : "bolt.circle")
                }
            }

            if let approval = model.pendingApproval {
                ControlApprovalPanel(approval: approval)
            }

            HStack(alignment: .top, spacing: 12) {
                NativeGroupPanel(title: "This Mac", subtitle: "") {
                    ControlButtonGrid {
                        ActionButton(title: "Status", icon: "waveform.path.ecg") {
                            Task { await model.refreshLocalStatus() }
                        }
                        ActionButton(title: "Reveal cwd", icon: "folder") {
                            NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: model.status.cwd)])
                        }
                        ActionButton(title: "Copy agent URL", icon: "link") {
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(model.settings.desktopAgentBaseURL, forType: .string)
                        }
                        ActionButton(title: "Tunnel", icon: "point.3.connected.trianglepath.dotted") {
                            model.requestRemoteTunnelApproval()
                        }
                        ActionButton(title: "Remote desktop", icon: "rectangle.connected.to.line.below") {
                            model.openRemoteDesktop()
                        }
                        ActionButton(title: "VPN", icon: "lock.shield") {
                            model.openVPN()
                        }
                        ActionButton(title: "Health", icon: "stethoscope") {
                            Task { await model.checkServerReachability() }
                        }
                    }
                }

                NativeGroupPanel(title: "Server", subtitle: "") {
                    ControlButtonGrid {
                        ActionButton(title: model.isCheckingServerReachability ? "Checking" : "Health", icon: "heart.text.square") {
                            Task { await model.checkServerReachability() }
                        }
                        .disabled(model.isServerBusy)
                        ActionButton(title: "Copy diag", icon: "doc.on.doc") {
                            model.copyServerDiagnostics()
                        }
                        ActionButton(title: "Start", icon: "play.fill") {
                            Task { await model.runServerAction(model.settings.serverStartPath) }
                        }
                        .disabled(model.isServerBusy)
                        ActionButton(title: "Stop", icon: "stop.fill", tone: .danger) {
                            model.requestStopServerApproval()
                        }
                        .disabled(model.isServerBusy)
                        ActionButton(title: "Logs", icon: "doc.text.magnifyingglass") {
                            Task { await model.checkServerLogs() }
                        }
                        .disabled(model.isServerBusy)
                        ActionButton(title: "VMs", icon: "cpu") {
                            model.selectedSection = .dashboard
                            model.openNativeDashboard(path: "/vms", label: "VMs")
                        }
                        ActionButton(title: "Chat", icon: "sparkles") {
                            model.selectedSection = .command
                            Task { await model.loadAIPage() }
                        }
                        ActionButton(title: "Settings", icon: "gearshape") {
                            model.selectedSection = .settings
                        }
                    }
                }
            }

            HStack(alignment: .top, spacing: 12) {
                NativeGroupPanel(title: "Workflows", subtitle: "") {
                    ControlButtonGrid {
                        ActionButton(title: "Mail", icon: "envelope") {
                            model.selectedSection = .mail
                        }
                        ActionButton(title: "Notes", icon: "note.text") {
                            model.openNativeDashboard(path: "/notes", label: "Notes")
                        }
                        ActionButton(title: "Documents", icon: "doc.viewfinder") {
                            model.selectedSection = .documents
                        }
                        ActionButton(title: "Images", icon: "photo.on.rectangle.angled") {
                            model.selectedSection = .images
                        }
                        ActionButton(title: "Clear pages", icon: "trash", tone: .danger) {
                            model.requestClearDocumentsApproval()
                        }
                        ActionButton(title: "Trash images", icon: "trash.slash", tone: .danger) {
                            model.requestTrashImagesApproval()
                        }
                    }
                }

                ControlRunHistoryPanel()
            }
        }
    }
}
