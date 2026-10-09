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
    var effectiveInstalledVersion: String {
        backgroundInstalledUpdateVersion.isNewerVersion(than: Self.appVersion) ? backgroundInstalledUpdateVersion : Self.appVersion
    }

    var isServerBusy: Bool {
        isCheckingServerReachability || isRunningServerAction
    }

    var remoteDesktopProtocolLabel: String {
        (RemoteDesktopProtocol(rawValue: settings.remoteDesktopProtocol) ?? .screenSharing).label
    }

    var remoteDesktopProtocolIcon: String {
        (RemoteDesktopProtocol(rawValue: settings.remoteDesktopProtocol) ?? .screenSharing).icon
    }

    var selectedMailMessage: MailOverviewEnvelope.Message? {
        mailOverview?.selectedMessage
            ?? mailOverview?.messages.first(where: { $0.id == selectedMailMessageID })
            ?? mailOverview?.messages.first
    }

    var hasDiscardedImages: Bool {
        imageReviewDecisions.values.contains(.discard)
    }

    var hasHanasandAuth: Bool {
        !authTokenForRequests.isEmpty && !userIDForRequests.isEmpty
    }

    var dashboardActions: [DesktopAction] {
        [
            .route("Overview", "Main dashboard and service overview.", "gauge.with.dots.needle", "/dashboard"),
            .route("Mail", "Open Mail.", "envelope", "/mail"),
            .route("Automations", "Schedule agent check-ins and inspect completed runs.", "alarm.waves.left.and.right", "/dashboard/automations"),
            .route("Notes", "Shared notes and operational memory.", "note.text", "/notes"),
            .route("Traffic", "Live traffic, records, and maps.", "point.3.connected.trianglepath.dotted", "/traffic"),
            .route("AI Metrics", "Model pool and system AI telemetry.", "sparkles", "/system/ai"),
            .route("Rate Limits", "Traffic policy, route exceptions, and access keys.", "gauge.with.needle", "/system/rates"),
            .route("Cron Jobs", "Managed host schedules and maintenance health.", "calendar.badge.clock", "/system/cron"),
            .route("System", "Infrastructure and VM controls.", "gearshape.2", "/system"),
            .route("VMs", "Remote machines and access details.", "display.2", "/vms"),
            .route("Shares", "Shares and hosted files.", "folder.badge.gearshape", "/s"),
            .route("Links", "Create and inspect /g shortcut links.", "link", "/g"),
            .route("Load Tests", "Recent public load-test runs.", "speedometer", "/dashboard/tests"),
            .route("Articles", "Draft and publish articles.", "text.alignleft", "/content/articles"),
            .route("Thoughts", "Ideas, writing, and thought board.", "brain.head.profile", "/content/thoughts"),
            .route("Profile", "Account, VMs, sessions, and certificates.", "person.crop.circle", "/profile"),
        ]
    }

    var adminActions: [DesktopAction] {
        [
            .route("Logs", "Runtime logs and diagnostics.", "exclamationmark.triangle", "/logs"),
            .route("Database", "Database overview and operations.", "externaldrive.connected.to.line.below", "/db"),
            .route("Backups", "Database backup status.", "externaldrive.badge.timemachine", "/db/backups"),
            .route("Restore", "Browse and restore database backups.", "arrow.counterclockwise.circle", "/db/restore"),
            .route("Vulnerabilities", "Security image scans and findings.", "shield.lefthalf.filled.badge.checkmark", "/vulnerabilities"),
            .route("Management", "Admin management console.", "checkmark.shield", "/management"),
            .route("Users", "User administration.", "person.2", "/users"),
            .route("Roles", "Role administration.", "person.badge.key", "/role"),
        ]
    }
}
