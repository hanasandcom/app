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
    static var automaticUpdateCheckInterval: TimeInterval {
        let rawValue = ProcessInfo.processInfo.environment["HANASAND_APP_UPDATE_CHECK_SECONDS"] ?? ""
        if let value = TimeInterval(rawValue), value >= 10 {
            return value
        }
        return 300
    }

    static var deviceIdentifier: String {
        if let saved = UserDefaults.standard.string(forKey: deviceIdentifierKey), !saved.isEmpty {
            return saved
        }
        let created = UUID().uuidString.lowercased()
        UserDefaults.standard.set(created, forKey: deviceIdentifierKey)
        return created
    }

    static func localAgentEndpoints(port: UInt16) -> [String] {
        var interfaces: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&interfaces) == 0, let first = interfaces else { return [] }
        defer { freeifaddrs(interfaces) }

        var endpoints: [String] = []
        var cursor: UnsafeMutablePointer<ifaddrs>? = first
        while let current = cursor {
            defer { cursor = current.pointee.ifa_next }
            let flags = Int32(current.pointee.ifa_flags)
            guard (flags & IFF_UP) == IFF_UP,
                  (flags & IFF_LOOPBACK) == 0,
                  let address = current.pointee.ifa_addr,
                  address.pointee.sa_family == UInt8(AF_INET) else {
                continue
            }

            var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            let result = getnameinfo(
                address,
                socklen_t(address.pointee.sa_len),
                &hostname,
                socklen_t(hostname.count),
                nil,
                0,
                NI_NUMERICHOST
            )
            guard result == 0 else { continue }
            let ip = String(cString: hostname)
            if ip.hasPrefix("169.254.") { continue }
            endpoints.append("http://\(ip):\(port)")
        }

        return Array(Set(endpoints)).sorted()
    }

    static func desktopAgentSessionCertificate(userID: String, authToken: String) -> String {
        let material = "hanasand-desktop-agent-session-v1\n\(userID.trimmingCharacters(in: .whitespacesAndNewlines))\n\(authToken.trimmingCharacters(in: .whitespacesAndNewlines))"
        let digest = SHA256.hash(data: Data(material.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    var desktopAgentSessionCertificate: String {
        let userID = userIDForRequests.trimmingCharacters(in: .whitespacesAndNewlines)
        let authToken = authTokenForRequests.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !userID.isEmpty, !authToken.isEmpty else { return "" }
        return Self.desktopAgentSessionCertificate(userID: userID, authToken: authToken)
    }

    func start() async {
        guard server == nil else { return }
        let next = LoopbackAgentServer(port: 45731, certificateProvider: { [weak self] in
            self?.desktopAgentSessionCertificate ?? ""
        }) { [weak self] command in
            Task { @MainActor in
                self?.recordCommand(command)
            }
        }
        do {
            try next.start()
            server = next
            status = AgentStatus.ready(message: "online")
            append(meta: "Agent", body: "http://localhost:45731")
            startRemoteCodexWorkerIfAvailable()
            beginAutomaticUpdateCheck()
            beginDesktopAgentPresence()
            Task { await checkServerReachability(silent: true) }
        } catch {
            status = AgentStatus.ready(ok: false, message: error.localizedDescription)
            append(meta: "Agent error", body: error.localizedDescription, kind: .error)
        }
    }

    func beginDesktopAgentPresence() {
        desktopPresenceTask?.cancel()
        desktopPresenceTask = nil
        guard hasHanasandAuth else { return }

        desktopPresenceTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.publishDesktopAgentPresence()
                try? await Task.sleep(nanoseconds: 60_000_000_000)
            }
        }
    }

    func publishDesktopAgentPresence() async {
        guard hasHanasandAuth else { return }

        let endpoints = Self.localAgentEndpoints(port: 45731)
        guard !endpoints.isEmpty else {
            append(meta: "Agent discovery", body: "No LAN IPv4 address found to publish.", kind: .error)
            return
        }

        let body: [String: Any] = [
            "deviceId": Self.deviceIdentifier,
            "deviceName": Host.current().localizedName ?? "Mac",
            "endpoints": endpoints,
        ]

        do {
            let data = try JSONSerialization.data(withJSONObject: body)
            let _: DesktopAgentPresenceEnvelope = try await requestJSON(
                settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("desktop-agent/presence"),
                method: "POST",
                body: data,
                authenticated: true
            )
            append(meta: "Agent discovery", body: "Published \(endpoints.joined(separator: ", "))", kind: .note)
        } catch DashboardRequestError.httpStatus(401) {
            let message = "Your Hanasand session expired. Sign in again to resume LAN discovery."
            clearLocalHanasandSession()
            loginStatus = message
            append(meta: "Agent discovery", body: message, kind: .error)
        } catch {
            append(meta: "Agent discovery", body: error.localizedDescription, kind: .error)
        }
    }

    func beginAutomaticUpdateCheck() {
        updateTask?.cancel()
        updateTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.checkForUpdates(automatic: true)
                let interval = Self.automaticUpdateCheckInterval
                try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
            }
        }
    }
}
