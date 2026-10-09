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

extension DesktopAgentModel {

    func openNativeDashboard(path: String, label: String) {
        selectedDashboardPath = path
        selectedDashboardTitle = label
        selectedSection = .dashboard
        append(meta: "Dashboard", body: "Opened native \(label)", kind: .command)
        recordRun(title: label, detail: path, kind: .command)
        Task { await loadNativeDashboardData() }
    }

    func closeNativeDashboardPage() {
        selectedDashboardPath = nil
        selectedDashboardTitle = "Dashboard"
        nativeDashboardPayload = "Select a dashboard card to load native data."
        nativeDashboardStatus = "Ready"
        backupServices = []
        backupFiles = []
        notes = []
        selectedNoteID = ""
        noteDraftTitle = ""
        noteDraftContent = ""
        vulnerabilityReport = nil
        databaseOverview = nil
        trafficMetrics = nil
    }

    func openURL(_ rawValue: String, label: String) {
        guard let url = URL(string: rawValue) else {
            append(meta: label, body: "Invalid URL: \(rawValue)", kind: .error)
            return
        }
        NSWorkspace.shared.open(url)
        append(meta: "Opened \(label)", body: url.absoluteString, kind: .command)
    }

    func copyCurrentContext() {
        let context = currentShareContext()
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(context, forType: .string)
        append(meta: "Copied", body: context, kind: .command)
        recordRun(title: "Copied context", detail: context, kind: .command)
    }

    func shareCurrentContext() {
        let context = currentShareContext()
        guard let window = NSApplication.shared.keyWindow,
              let contentView = window.contentView else {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(context, forType: .string)
            append(meta: "Share", body: "Copied context because no window was available.", kind: .note)
            return
        }

        let picker = NSSharingServicePicker(items: [context])
        picker.show(relativeTo: contentView.bounds, of: contentView, preferredEdge: .minY)
        append(meta: "Share", body: context, kind: .command)
    }

    func currentShareContext() -> String {
        switch selectedSection {
        case .control:
            return prompt.isEmpty ? "Hanasand Control: \(currentTaskState)" : prompt
        case .mail:
            return selectedMailMessage?.subject ?? mailSummary
        case .documents:
            return "Hanasand Documents: \(documentPages.count) page\(documentPages.count == 1 ? "" : "s")"
        case .images:
            return "Hanasand Images: \(imageReviewItems.count) image\(imageReviewItems.count == 1 ? "" : "s"), \(imageReviewDecisions.count) decided"
        case .dashboard:
            return "\(selectedDashboardTitle): \(selectedDashboardPath ?? "dashboard")"
        case .server:
            return "Hanasand Server: \(serverSummary)"
        case .mac:
            return "\(status.hostname) \(status.platform) \(status.cwd)"
        case .command:
            return "Hanasand AI: \(aiSummary)"
        case .updates:
            return "Hanasand Desktop \(Self.appVersion): \(updateStatus.title) \(updateStatus.message)"
        default:
            return "Hanasand \(selectedSection.title)"
        }
    }

    func importFileProviders(_ providers: [NSItemProvider], completion: @escaping @MainActor ([URL]) -> Void) {
        var urls: [URL] = []
        let group = DispatchGroup()

        for provider in providers {
            group.enter()
            provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { item, _ in
                defer { group.leave() }
                if let url = item as? URL {
                    urls.append(url)
                } else if let data = item as? Data,
                          let value = String(data: data, encoding: .utf8),
                          let url = URL(string: value.trimmingCharacters(in: .whitespacesAndNewlines)) {
                    urls.append(url)
                } else if let value = item as? String,
                          let url = URL(string: value.trimmingCharacters(in: .whitespacesAndNewlines)) {
                    urls.append(url)
                }
            }
        }

        group.notify(queue: .main) {
            Task { @MainActor in
                completion(urls)
            }
        }
    }

    func openServerLogsPage() {
        if settings.serverLogsPath.lowercased().hasPrefix("http"),
           let url = URL(string: settings.serverLogsPath) {
            NSWorkspace.shared.open(url)
            append(meta: "Opened logs", body: url.absoluteString, kind: .command)
            return
        }
        openWebsite(path: "/logs", label: "Logs")
    }

    func configureMacMiniRemoteDesktop() {
        settings.rdpHost = "localhost:5900"
        settings.rdpUser = "macmini"
        settings.remoteDesktopProtocol = RemoteDesktopProtocol.screenSharing.rawValue
        settings.remoteDesktopTunnelCommand = HanasandDesktopSettings.macMiniTunnelCommand
        remoteControlSummary = "Mac mini Screen Sharing profile is ready."
        remoteControlLastCommand = "Mac mini profile"
        append(meta: "Remote desktop", body: "Mac mini profile ready. Start the tunnel, then connect.", kind: .change)
    }

    func activateForRemoteControl() {
        NSApplication.shared.activate(ignoringOtherApps: true)
        NSApplication.shared.windows.first?.makeKeyAndOrderFront(nil)
    }

    func markRemoteDesktopCommand(_ title: String, detail: String, kind: AgentEvent.Kind = .command) {
        remoteControlRequests += 1
        remoteControlLastCommand = title
        remoteControlSummary = detail
        append(meta: "Remote desktop", body: detail, kind: kind)
        recordRun(title: title, detail: detail, kind: kind)
    }

    func showRemoteDesktopStatus(source: String = "Hanasand app") {
        selectedSection = .server
        activateForRemoteControl()
        markRemoteDesktopCommand(
            "Status from \(source)",
            detail: "\(remoteDesktopProtocolLabel) ready for \(remoteDesktopTargetSummary).",
            kind: .command
        )
        currentTaskState = "Remote status shown"
    }
}
