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

    func checkServerLogs() async {
        guard !isRunningServerAction else { return }
        isRunningServerAction = true
        serverActionStatus = "Preparing logs"
        currentTaskState = "Loading logs"
        defer {
            isRunningServerAction = false
            currentTaskState = "Idle"
        }
        guard await ensureServerReachableForAction("Server logs") else {
            serverActionStatus = "Logs blocked"
            return
        }
        serverActionStatus = "Loading logs"
        do {
            let url = serverLogsURL()
            let text = try await requestText(
                url,
                authenticated: hasHanasandAuth
            )
            serverSummary = text.isEmpty ? "No logs returned" : String(text.prefix(900))
            serverActionStatus = "Logs loaded"
            append(meta: "Server logs", body: serverSummary, kind: .command)
            recordRun(title: "Server logs", detail: serverSummary, kind: .command)
        } catch {
            serverSummary = friendlyServerError(error, target: settings.serverLogsPath)
            serverActionStatus = "Logs failed"
            append(meta: "Server logs", body: serverSummary, kind: .error)
            recordRun(title: "Server logs error", detail: serverSummary, kind: .error)
        }
    }

    func checkServerReachability(silent: Bool = false) async {
        guard !isCheckingServerReachability else { return }
        isCheckingServerReachability = true
        serverActionStatus = "Checking reachability"
        currentTaskState = "Checking server"
        defer {
            isCheckingServerReachability = false
            if !isRunningServerAction {
                serverActionStatus = "Health check complete"
            }
            currentTaskState = "Idle"
        }

        let vpnTarget = settings.vpnURLScheme.trimmingCharacters(in: .whitespacesAndNewlines)
        let vpnStatus = ServerEndpointStatus(
            title: "VPN",
            target: vpnTarget.isEmpty ? "Not configured" : vpnTarget,
            isReachable: vpnTarget.isEmpty ? false : nil,
            detail: vpnTarget.isEmpty ? "Configure the VPN URL scheme before using internal controls." : "macOS cannot confirm Cisco VPN state directly; use the internal/API checks below.",
            checkedAt: Date()
        )

        async let internalStatus = pingServerEndpoint(
            title: "Internal API",
            url: settings.internalAPIBaseURL.normalizedBaseURL,
            authenticated: hasHanasandAuth
        )
        let serverConfigured = !settings.serverBaseURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        async let managementStatus = serverConfigured
            ? pingServerEndpoint(title: "Management plane", url: settings.serverBaseURL.normalizedBaseURL, authenticated: hasHanasandAuth)
            : ServerEndpointStatus(title: "Management plane", target: "Not configured", isReachable: false, detail: "Configure an HTTPS or private-LAN endpoint before using server controls.", checkedAt: Date())
        async let logsStatus = serverConfigured
            ? pingServerEndpoint(title: "Logs", url: serverLogsURL(), authenticated: hasHanasandAuth)
            : ServerEndpointStatus(title: "Logs", target: "Not configured", isReachable: false, detail: "Configure a secure management plane before loading logs.", checkedAt: Date())

        serverReachability = await [vpnStatus, internalStatus, managementStatus, logsStatus]
        let reachableCount = serverReachability.filter { $0.isReachable == true }.count
        let blocked = serverReachability.filter { $0.isReachable == false }
        if blocked.isEmpty {
            serverSummary = "\(reachableCount) reachable"
        } else {
            serverSummary = "\(blocked.count) blocked"
        }
        if !silent {
            append(meta: "Server health", body: serverSummary, kind: blocked.isEmpty ? .command : .error)
            recordRun(title: "Server health", detail: serverSummary, kind: blocked.isEmpty ? .command : .error)
        }
    }

    func copyServerDiagnostics() {
        let text = serverDiagnosticsText()
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        append(meta: "Server diagnostics", body: "Copied health report.", kind: .command)
        recordRun(title: "Server diagnostics", detail: text, kind: .command)
    }

    func serverDiagnosticsText() -> String {
        let lines = serverReachability.isEmpty
            ? ["No reachability checks have been run yet."]
            : serverReachability.map { status in
                "- \(status.title): \(status.stateLabel) | \(status.target) | \(status.detail)"
            }
        return ([
            "Hanasand Server Diagnostics",
            "Summary: \(serverSummary)",
            "Last check: \(serverReachabilityCheckedText)",
            "VPN: \(settings.vpnURLScheme)",
            "Internal API: \(settings.internalAPIBaseURL)",
            "Management plane: \(settings.serverBaseURL)",
            "Logs: \(serverLogsURL().absoluteString)",
            "Auth: \(hasHanasandAuth ? "configured" : "missing")",
            "",
        ] + lines).joined(separator: "\n")
    }

    func ensureServerReachableForAction(_ label: String) async -> Bool {
        await checkServerReachability(silent: true)
        let management = serverReachability.first { $0.title == "Management plane" }
        guard management?.isReachable == true else {
            let detail = management?.detail ?? "Management plane has not been checked."
            serverSummary = "\(label) blocked. Connect VPN or verify \(settings.serverBaseURL). \(detail)"
            append(meta: label, body: serverSummary, kind: .error)
            recordRun(title: "\(label) blocked", detail: serverSummary, kind: .error)
            return false
        }
        return true
    }

    func serverLogsURL() -> URL {
        let base = settings.serverBaseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        if base.isEmpty {
            return URL(string: "https://hanasand.com")!
        }
        let logsPath = settings.serverLogsPath.trimmingCharacters(in: .whitespacesAndNewlines)
        return logsPath.lowercased().hasPrefix("http")
            ? URL(string: logsPath).or(settings.serverBaseURL.normalizedBaseURL)
            : settings.serverBaseURL.normalizedBaseURL.appendingPathComponent(logsPath.trimmingCharacters(in: CharacterSet(charactersIn: "/")))
    }

    func pingServerEndpoint(title: String, url: URL, authenticated: Bool) async -> ServerEndpointStatus {
        var request = request(url, authenticated: authenticated)
        request.timeoutInterval = 5
        request.httpMethod = "GET"
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            if let http = response as? HTTPURLResponse {
                let reachable = http.statusCode < 500
                let detail: String
                if (200..<300).contains(http.statusCode) {
                    detail = "HTTP \(http.statusCode)"
                } else if [401, 403].contains(http.statusCode) {
                    detail = "HTTP \(http.statusCode). Endpoint is reachable, but auth is required."
                } else {
                    detail = "HTTP \(http.statusCode). Endpoint answered but may not be healthy."
                }
                return ServerEndpointStatus(title: title, target: url.absoluteString, isReachable: reachable, detail: detail, checkedAt: Date())
            }
            return ServerEndpointStatus(title: title, target: url.absoluteString, isReachable: true, detail: "Endpoint responded.", checkedAt: Date())
        } catch {
            return ServerEndpointStatus(title: title, target: url.absoluteString, isReachable: false, detail: friendlyServerError(error, target: url.absoluteString), checkedAt: Date())
        }
    }
}
