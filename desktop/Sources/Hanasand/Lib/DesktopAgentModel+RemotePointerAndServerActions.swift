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

    func clickPointerFromPhonePreview(at normalizedPoint: CGPoint?) {
        selectedSection = .server
        guard let normalizedPoint else {
            clickPointerAtCurrentLocation()
            return
        }

        let width = CGFloat(CGDisplayPixelsWide(CGMainDisplayID()))
        let height = CGFloat(CGDisplayPixelsHigh(CGMainDisplayID()))
        let x = min(max(normalizedPoint.x, 0), 1) * max(width, 1)
        let y = min(max(normalizedPoint.y, 0), 1) * max(height, 1)
        let point = CGPoint(x: x, y: y)
        CGWarpMouseCursorPosition(point)

        if let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left),
           let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left) {
            down.post(tap: .cghidEventTap)
            up.post(tap: .cghidEventTap)
            markRemoteDesktopCommand(
                "Preview clicked",
                detail: "Clicked \(Int(x)), \(Int(y)) on the Mac from the phone preview.",
                kind: .change
            )
            currentTaskState = "Preview click from app"
        } else {
            markRemoteDesktopCommand(
                "Preview click failed",
                detail: "macOS did not allow pointer click injection.",
                kind: .error
            )
            currentTaskState = "Preview click failed"
        }
    }

    static func normalizedPointerPoint(from command: String) -> CGPoint? {
        let parts = command.split(separator: ":").map(String.init)
        guard parts.count == 3,
              let x = Double(parts[1]),
              let y = Double(parts[2]) else { return nil }
        return CGPoint(x: x, y: y)
    }

    static func commandPayload(after prefix: String, in command: String) -> String? {
        guard command.hasPrefix(prefix) else { return nil }
        return String(command.dropFirst(prefix.count))
    }

    static func shellQuoted(_ value: String) -> String {
        "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
    }

    func openRemoteDesktopTunnel() {
        currentTaskState = "Opening tunnel"
        let command = settings.remoteDesktopTunnelCommand.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !command.isEmpty else {
            remoteControlSummary = "Configure a tunnel command first."
            remoteControlLastCommand = "Tunnel error"
            append(meta: "Remote desktop", body: "Configure a tunnel command first.", kind: .error)
            recordRun(title: "Tunnel error", detail: "Missing tunnel command", kind: .error)
            currentTaskState = "Idle"
            return
        }

        let escapedCommand = command
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        let script = """
        tell application "Terminal"
            activate
            do script "\(escapedCommand)"
        end tell
        """
        var error: NSDictionary?
        guard NSAppleScript(source: script)?.executeAndReturnError(&error) != nil else {
            append(meta: "Remote desktop", body: error?.description ?? "Could not open tunnel terminal.", kind: .error)
            recordRun(title: "Tunnel error", detail: error?.description ?? "Could not open tunnel terminal.", kind: .error)
            currentTaskState = "Idle"
            return
        }
        remoteControlSummary = "Tunnel command opened in Terminal."
        remoteControlLastCommand = "Tunnel"
        append(meta: "Remote desktop", body: "Tunnel command opened in Terminal.", kind: .command)
        recordRun(title: "Tunnel", detail: command, kind: .command)
        currentTaskState = "Tunnel requested"
    }

    func openRemoteDesktop(protocol override: RemoteDesktopProtocol? = nil) {
        currentTaskState = "Opening remote desktop"
        let host = settings.rdpHost.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !host.isEmpty else {
            remoteControlSummary = "Configure a remote host first."
            remoteControlLastCommand = "Connect error"
            append(meta: "Remote desktop", body: "Configure a remote host first.", kind: .error)
            recordRun(title: "Remote desktop error", detail: "Missing remote host", kind: .error)
            currentTaskState = "Idle"
            return
        }

        let protocolKind = override ?? RemoteDesktopProtocol(rawValue: settings.remoteDesktopProtocol) ?? .screenSharing
        let user = settings.rdpUser.trimmingCharacters(in: .whitespacesAndNewlines)
        let target = user.isEmpty ? host : "\(user)@\(host)"
        let urlString: String
        switch protocolKind {
        case .screenSharing:
            let allowed = CharacterSet.urlUserAllowed
                .union(.urlHostAllowed)
                .union(CharacterSet(charactersIn: ":@[]"))
            let encodedTarget = target.addingPercentEncoding(withAllowedCharacters: allowed) ?? target
            urlString = "vnc://\(encodedTarget)"
        case .microsoftRDP:
            let allowed = CharacterSet.urlQueryAllowed.union(CharacterSet(charactersIn: ":@"))
            let encodedTarget = target.addingPercentEncoding(withAllowedCharacters: allowed) ?? target
            urlString = "rdp://full%20address=s:\(encodedTarget)"
        }

        guard let url = URL(string: urlString) else {
            remoteControlSummary = "Invalid remote target."
            remoteControlLastCommand = "Connect error"
            append(meta: "Remote desktop", body: "Invalid remote target.", kind: .error)
            recordRun(title: "Remote desktop error", detail: "Invalid remote target", kind: .error)
            currentTaskState = "Idle"
            return
        }
        NSWorkspace.shared.open(url)
        remoteControlSummary = "\(protocolKind.label) opened for \(target)."
        remoteControlLastCommand = "Connect"
        append(meta: protocolKind.label, body: target, kind: .command)
        recordRun(title: protocolKind.label, detail: target, kind: .command)
        currentTaskState = "Idle"
    }

    func runServerAction(_ path: String) async {
        guard !isRunningServerAction else { return }
        guard !settings.serverBaseURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            serverActionStatus = "Server not configured"
            serverSummary = "Configure an HTTPS or private-LAN management plane before running server actions."
            append(meta: "Server", body: serverSummary, kind: .error)
            return
        }
        isRunningServerAction = true
        serverActionStatus = "Preparing \(path)"
        currentTaskState = "Running server action"
        defer {
            isRunningServerAction = false
            currentTaskState = "Idle"
        }
        guard await ensureServerReachableForAction("Server action") else {
            serverActionStatus = "Blocked"
            return
        }
        serverActionStatus = "Running \(path)"
        do {
            let text = try await requestText(
                settings.serverBaseURL.normalizedBaseURL.appendingPathComponent(path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))),
                method: "POST",
                authenticated: hasHanasandAuth
            )
            serverSummary = text.isEmpty ? "Done" : String(text.prefix(900))
            serverActionStatus = "Completed \(path)"
            append(meta: "Server", body: serverSummary, kind: .command)
            recordRun(title: "Server", detail: path, kind: .command)
        } catch {
            serverSummary = friendlyServerError(error, target: settings.serverBaseURL)
            serverActionStatus = "Failed \(path)"
            append(meta: "Server", body: serverSummary, kind: .error)
            recordRun(title: "Server error", detail: serverSummary, kind: .error)
        }
    }
}
