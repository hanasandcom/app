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

    func recordCommand(_ command: String) {
        recordRun(title: "Chat", detail: command, kind: .command)
        if command == "status" {
            status = AgentStatus.ready(message: "status command executed")
            append(meta: "Status", body: "\(status.hostname) · \(status.platform) · \(Int(status.uptimeSeconds / 60)) min", kind: .command)
        } else if command == "remote_desktop_status" {
            showRemoteDesktopStatus(source: "Hanasand app")
        } else if command == "mac_control_authorize" {
            openRemoteControlPermissions()
        } else if command.hasPrefix("codex_prompt:") {
            runRemoteCodexPrompt(Self.commandPayload(after: "codex_prompt:", in: command))
        } else if command.hasPrefix("mac_control_type_text:") {
            typeRemoteText(Self.commandPayload(after: "mac_control_type_text:", in: command))
        } else if command.hasPrefix("mac_control_pointer_click_at:") {
            clickPointerFromPhonePreview(at: Self.normalizedPointerPoint(from: command))
        } else if command == "update" {
            beginAutomaticUpdateCheck()
            append(meta: "Update", body: "/api/app", kind: .command)
        } else if command == "ai_train_app_parity" {
            selectedSection = .command
            append(meta: "AI training", body: "Queued app-parity drill through the Desktop app runtime.", kind: .command)
            Task { @MainActor in
                await loadAIPage()
                submitAppParityTrainingPrompt()
            }
        } else if command == "ai_audit_desktop_ui" {
            selectedSection = .command
            append(meta: "AI training", body: "Queued Desktop UI audit through the Desktop app runtime.", kind: .command)
            Task { @MainActor in
                await loadAIPage()
                submitDesktopUIAuditPrompt()
            }
        } else if command == "ai_reload" {
            selectedSection = .command
            append(meta: "AI", body: "Reloading chat models and websocket from loopback command.", kind: .command)
            Task { @MainActor in
                await loadAIPage()
            }
        } else if command == "open_section_command" {
            selectedSection = .command
            append(meta: "Navigation", body: "Opened Chat section.", kind: .command)
        } else if command == "open_section_control" {
            selectedSection = .control
            append(meta: "Navigation", body: "Opened Control section.", kind: .command)
        } else if command == "open_section_dashboard" {
            selectedSection = .dashboard
            append(meta: "Navigation", body: "Opened Dashboard section.", kind: .command)
        } else if command == "open_section_workspace" {
            selectedSection = .browser
            append(meta: "Navigation", body: "Opened Workspace section.", kind: .command)
        } else if command.hasPrefix("browser_open:") {
            openInlineBrowser(url: Self.commandPayload(after: "browser_open:", in: command) ?? "", source: "Loopback")
        } else if command.hasPrefix("browser_popout:") {
            popOutBrowser(url: Self.commandPayload(after: "browser_popout:", in: command), minified: false, source: "Loopback")
        } else if command == "browser_mini_fern" {
            openMiniBrowser(minified: true)
        } else if command == "browser_popout_fern" {
            openMiniBrowser(minified: false)
        } else if command == "open_section_ide" {
            selectedSection = .ide
            append(meta: "Navigation", body: "Opened IDE section.", kind: .command)
        } else if command == "open_section_mac" {
            selectedSection = .mac
            append(meta: "Navigation", body: "Opened This Mac section.", kind: .command)
        } else if command == "open_section_mail" {
            selectedSection = .mail
            append(meta: "Navigation", body: "Opened Mail section.", kind: .command)
        } else if command == "open_section_documents" {
            selectedSection = .documents
            append(meta: "Navigation", body: "Opened Documents section.", kind: .command)
        } else if command == "open_section_images" {
            selectedSection = .images
            append(meta: "Navigation", body: "Opened Images section.", kind: .command)
        } else if command == "open_section_ai" {
            selectedSection = .command
            append(meta: "Navigation", body: "Opened Chat section.", kind: .command)
        } else if command == "open_section_server" {
            selectedSection = .server
            append(meta: "Navigation", body: "Opened Server section.", kind: .command)
        } else if command == "open_section_updates" {
            selectedSection = .updates
            append(meta: "Navigation", body: "Opened Updates section.", kind: .command)
        } else if command == "open_section_settings" {
            selectedSection = .settings
            append(meta: "Navigation", body: "Opened Settings section.", kind: .command)
        } else if command == "dashboard_refresh" {
            selectedSection = .dashboard
            append(meta: "Dashboard", body: "Refreshing selected dashboard panel from loopback command.", kind: .command)
            Task { @MainActor in
                await loadNativeDashboardData()
            }
        } else if command == "open_dashboard_mail" {
            openNativeDashboard(path: "/mail", label: "Mail")
            append(meta: "Dashboard", body: "Opened native Mail panel.", kind: .command)
        } else if command == "open_dashboard_automations" {
            openNativeDashboard(path: "/dashboard/automations", label: "Automations")
            append(meta: "Dashboard", body: "Opened Automations panel.", kind: .command)
        } else if command == "open_dashboard_cron" {
            openNativeDashboard(path: "/system/cron", label: "Cron Jobs")
            append(meta: "Dashboard", body: "Opened Cron Jobs panel.", kind: .command)
        } else if command == "open_dashboard_articles" {
            openNativeDashboard(path: "/content/articles", label: "Articles")
            append(meta: "Dashboard", body: "Opened native Articles panel.", kind: .command)
        } else if command == "open_dashboard_thoughts" {
            openNativeDashboard(path: "/content/thoughts", label: "Thoughts")
            append(meta: "Dashboard", body: "Opened native Thoughts panel.", kind: .command)
        } else if command == "open_dashboard_shares" {
            openNativeDashboard(path: "/s", label: "Shares")
            append(meta: "Dashboard", body: "Opened native Shares panel.", kind: .command)
        } else if command == "open_dashboard_links" {
            openNativeDashboard(path: "/g", label: "Links")
            append(meta: "Dashboard", body: "Opened native Links panel.", kind: .command)
        } else if command == "open_dashboard_tests" {
            openNativeDashboard(path: "/dashboard/tests", label: "Load Tests")
            append(meta: "Dashboard", body: "Opened native Load Tests panel.", kind: .command)
        } else if command == "open_dashboard_profile" {
            openNativeDashboard(path: "/profile", label: "Profile")
            append(meta: "Dashboard", body: "Opened native Profile panel.", kind: .command)
        } else if command == "open_dashboard_users" {
            openNativeDashboard(path: "/users", label: "Users")
            append(meta: "Dashboard", body: "Opened native Users panel.", kind: .command)
        } else if command == "open_dashboard_roles" {
            openNativeDashboard(path: "/role", label: "Roles")
            append(meta: "Dashboard", body: "Opened native Roles panel.", kind: .command)
        } else if command == "open_dashboard_logs" {
            openNativeDashboard(path: "/logs", label: "Logs")
            append(meta: "Dashboard", body: "Opened native Logs panel.", kind: .command)
        } else if command == "open_dashboard_system" {
            openNativeDashboard(path: "/system", label: "System")
            append(meta: "Dashboard", body: "Opened native System panel.", kind: .command)
        } else if command == "open_dashboard_vms" {
            openNativeDashboard(path: "/vms", label: "VMs")
            append(meta: "Dashboard", body: "Opened native VMs panel.", kind: .command)
        } else if command == "open_dashboard_ai_models" {
            openNativeDashboard(path: "/system/ai", label: "AI models")
            append(meta: "Dashboard", body: "Opened native AI models panel.", kind: .command)
        } else if command == "open_dashboard_notes" {
            openNativeDashboard(path: "/notes", label: "Notes")
            append(meta: "Dashboard", body: "Opened native Notes panel.", kind: .command)
        } else if command == "open_dashboard_db" {
            openNativeDashboard(path: "/db", label: "Databases")
            append(meta: "Dashboard", body: "Opened native Databases panel.", kind: .command)
        } else if command == "open_dashboard_backups" {
            openNativeDashboard(path: "/db/backups", label: "Backups")
            append(meta: "Dashboard", body: "Opened native Backups panel.", kind: .command)
        } else if command == "open_dashboard_restore" {
            openNativeDashboard(path: "/db/restore", label: "Restore")
            append(meta: "Dashboard", body: "Opened native Restore panel.", kind: .command)
        } else if command == "open_dashboard_vulnerabilities" {
            openNativeDashboard(path: "/vulnerabilities", label: "Vulnerabilities")
            append(meta: "Dashboard", body: "Opened native Vulnerabilities panel.", kind: .command)
        } else if command == "open_dashboard_rate_limits" {
            openNativeDashboard(path: "/system/rates", label: "Rate limits")
            append(meta: "Dashboard", body: "Opened native Rate limits panel.", kind: .command)
        } else if command == "open_dashboard_traffic" {
            openNativeDashboard(path: "/traffic", label: "Traffic")
            append(meta: "Dashboard", body: "Opened native Traffic panel.", kind: .command)
        } else if command == "server_logs" {
            selectedSection = .server
            append(meta: "Server logs", body: "Loading server logs from loopback command.", kind: .command)
            Task { @MainActor in
                await checkServerLogs()
            }
        } else if command == "settings_summary" {
            selectedSection = .settings
            append(meta: "Settings", body: settings.loopbackSummary, kind: .command)
        } else {
            append(meta: "Blocked", body: command, kind: .error)
        }
    }
}
