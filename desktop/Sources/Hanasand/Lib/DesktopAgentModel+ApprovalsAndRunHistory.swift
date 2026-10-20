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

    func approvalForPrompt(_ command: String) -> ControlApproval? {
        let lowered = command.lowercased()
        if lowered.contains("rm -rf") || lowered.contains("reset --hard") || lowered.contains("erase all content") {
            return ControlApproval(
                title: "Blocked command",
                detail: "This desktop surface will not run destructive shell commands. Use Terminal after manual review.",
                command: command,
                kind: .blocked
            )
        }
        if lowered == "stop" || lowered.contains("stop server") || lowered.contains("restart server") || lowered.contains("shutdown server") {
            return ControlApproval(
                title: "Approve server stop",
                detail: "This can interrupt active sessions on the Hanasand server.",
                command: command,
                kind: .stopServer
            )
        }
        if lowered.contains("tunnel") || lowered.contains("remote desktop") || lowered.contains("control this mac") {
            return ControlApproval(
                title: "Approve remote tunnel",
                detail: "This opens the configured tunnel command in Terminal.",
                command: command,
                kind: .openTunnel
            )
        }
        if lowered.contains("trash images") || lowered.contains("delete images") || lowered.contains("discard images") {
            return ControlApproval(
                title: "Approve image trash",
                detail: "Moves every image marked discard to macOS Trash.",
                command: command,
                kind: .trashImages
            )
        }
        if lowered.contains("clear documents") || lowered.contains("clear pages") || lowered.contains("delete pages") {
            return ControlApproval(
                title: "Approve document clear",
                detail: "Removes all imported document pages from this local bundle.",
                command: command,
                kind: .clearDocuments
            )
        }
        return nil
    }

    func requestStopServerApproval() {
        requestApproval(ControlApproval(
            title: "Approve server stop",
            detail: "This can interrupt active sessions on the Hanasand server.",
            command: settings.serverStopPath,
            kind: .stopServer
        ))
    }

    func requestRemoteTunnelApproval() {
        requestApproval(ControlApproval(
            title: "Approve remote tunnel",
            detail: "This opens the configured tunnel command in Terminal.",
            command: settings.remoteDesktopTunnelCommand,
            kind: .openTunnel
        ))
    }

    func requestTrashImagesApproval() {
        requestApproval(ControlApproval(
            title: "Approve image trash",
            detail: "Moves every image marked discard to macOS Trash.",
            command: "trash discarded images",
            kind: .trashImages
        ))
    }

    func requestClearDocumentsApproval() {
        requestApproval(ControlApproval(
            title: "Approve document clear",
            detail: "Removes all imported document pages from this local bundle.",
            command: "clear document pages",
            kind: .clearDocuments
        ))
    }

    func requestApproval(_ approval: ControlApproval) {
        pendingApproval = approval
        currentTaskState = approval.kind == .blocked ? "Blocked" : "Waiting for approval"
        append(meta: approval.title, body: approval.detail, kind: approval.kind == .blocked ? .error : .note)
        recordRun(title: approval.title, detail: approval.command, kind: approval.kind == .blocked ? .error : .note)
    }

    func cancelPendingApproval() {
        guard let approval = pendingApproval else { return }
        pendingApproval = nil
        currentTaskState = "Idle"
        append(meta: "Approval cancelled", body: approval.command, kind: .note)
        recordRun(title: "Approval cancelled", detail: approval.command, kind: .note)
    }

    func approvePendingAction() {
        guard let approval = pendingApproval else { return }
        pendingApproval = nil

        if approval.kind == .blocked {
            currentTaskState = "Blocked"
            append(meta: "Blocked", body: approval.command, kind: .error)
            recordRun(title: "Blocked", detail: approval.command, kind: .error)
            return
        }

        currentTaskState = "Approved"
        append(meta: "Approved", body: approval.command, kind: .command)
        recordRun(title: "Approved", detail: approval.command, kind: .command)

        switch approval.kind {
        case .stopServer:
            Task { [weak self] in
                guard let self else { return }
                self.currentTaskState = "Stopping server"
                await self.runServerAction(self.settings.serverStopPath)
                self.currentTaskState = "Idle"
            }
        case .openTunnel:
            openRemoteDesktopTunnel()
            currentTaskState = "Tunnel requested"
        case .trashImages:
            trashDiscardedImages()
            currentTaskState = "Idle"
        case .clearDocuments:
            clearDocumentPages()
            currentTaskState = "Idle"
        case .blocked:
            break
        }
    }

    func recordRun(title: String, detail: String, kind: AgentEvent.Kind = .command) {
        runHistory.insert(ControlRun(title: title, detail: detail, kind: kind), at: 0)
        if runHistory.count > 24 {
            runHistory.removeLast(runHistory.count - 24)
        }
    }

    static func loadPersistedRunHistory() -> [ControlRun] {
        guard let data = UserDefaults.standard.data(forKey: runHistoryKey),
              let persisted = try? JSONDecoder().decode([PersistedControlRun].self, from: data) else {
            return []
        }
        return persisted.map(\.controlRun)
    }

    func saveRunHistory() {
        let persisted = runHistory.map(PersistedControlRun.init)
        if let data = try? JSONEncoder().encode(persisted) {
            UserDefaults.standard.set(data, forKey: Self.runHistoryKey)
        }
    }

    func reuseControlRun(_ run: ControlRun) {
        selectedSection = .control
        prompt = run.detail
        focusCommand.toggle()
        currentTaskState = "Ready"
        append(meta: "Reused", body: run.detail, kind: .note)
    }
}
