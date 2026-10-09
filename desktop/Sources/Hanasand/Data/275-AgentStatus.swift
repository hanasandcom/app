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

struct AgentStatus: Codable {
    var ok: Bool
    var agent: String
    var message: String
    var hostname: String
    var platform: String
    var user: String
    var cwd: String
    var uptimeSeconds: Double
    var timestamp: String
    var screenCaptureAllowed: Bool
    var accessibilityAllowed: Bool

    static func ready(ok: Bool = true, message: String = "ready") -> AgentStatus {
        AgentStatus(
            ok: ok,
            agent: "hanasand-desktop-agent",
            message: message,
            hostname: Host.current().localizedName ?? "localhost",
            platform: "macOS",
            user: NSUserName(),
            cwd: FileManager.default.currentDirectoryPath,
            uptimeSeconds: ProcessInfo.processInfo.systemUptime,
            timestamp: ISO8601DateFormatter().string(from: Date()),
            screenCaptureAllowed: CGPreflightScreenCaptureAccess(),
            accessibilityAllowed: AXIsProcessTrusted()
        )
    }
}
