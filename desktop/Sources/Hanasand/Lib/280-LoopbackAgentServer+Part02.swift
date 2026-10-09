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

extension LoopbackAgentServer {

    func response(for request: String) -> String {
        if request.hasPrefix("OPTIONS ") {
            return http(body: "{}", status: "204 No Content")
        }
        if !isAuthorized(request) {
            return http(body: #"{"ok":false,"message":"A matching Hanasand login session is required for LAN access."}"#, status: "401 Unauthorized")
        }
        if request.hasPrefix("GET /health ") || request.hasPrefix("GET /status ") {
            return http(body: encode(AgentStatus.ready(message: "this pc is reachable")))
        }
        if request.hasPrefix("GET /screenshot ") {
            return http(body: Self.screenshotResponse())
        }
        if request.hasPrefix("GET /commands ") {
            return http(body: encode([
                "status",
                "update",
                "ai_reload",
                "ai_train_app_parity",
                "ai_audit_desktop_ui",
                "open_section_command",
                "open_section_control",
                "open_section_dashboard",
                "open_section_workspace",
                "browser_mini_fern",
                "browser_popout_fern",
                "open_section_ide",
                "open_section_mac",
                "open_section_mail",
                "open_section_documents",
                "open_section_images",
                "open_section_ai",
                "open_section_server",
                "open_section_updates",
                "open_section_settings",
                "dashboard_refresh",
                "open_dashboard_mail",
                "open_dashboard_articles",
                "open_dashboard_thoughts",
                "open_dashboard_shares",
                "open_dashboard_links",
                "open_dashboard_tests",
                "open_dashboard_profile",
                "open_dashboard_users",
                "open_dashboard_roles",
                "open_dashboard_logs",
                "open_dashboard_system",
                "open_dashboard_vms",
                "open_dashboard_ai_models",
                "open_dashboard_notes",
                "open_dashboard_db",
                "open_dashboard_backups",
                "open_dashboard_restore",
                "open_dashboard_vulnerabilities",
                "open_dashboard_rate_limits",
                "open_dashboard_traffic",
                "server_logs",
                "settings_summary",
                "remote_desktop_status",
                "mac_control_authorize",
                "codex_prompt:<url-encoded-prompt>",
                "mac_control_type_text:<url-encoded-text>",
                "mac_control_pointer_click_at:<x>:<y>",
            ]))
        }
        if request.hasPrefix("POST /command ") || request.hasPrefix("POST /command?") || request.hasPrefix("GET /command?") {
            let command = Self.commandName(from: request)
            if Self.requiresAccessibility(command), !AXIsProcessTrusted() {
                return http(
                    body: #"{"ok":false,"message":"Mac Accessibility permission is required before the Hanasand app can control keyboard, Enter, Go/Search, or mouse clicks. Open Privacy & Security -> Accessibility and enable Hanasand, then reopen the app.","accessibilityAllowed":false}"#,
                    status: "409 Conflict"
                )
            }
            onCommand(command)
            if command == "status" {
                return http(body: encode(AgentStatus.ready(message: "status command executed")))
            }
            if command == "update" {
                return http(body: #"{"ok":true,"message":"Update check started through /api/app."}"#)
            }
            if command == "ai_reload" {
                return http(body: #"{"ok":true,"message":"AI runtime reload queued in the Desktop app."}"#)
            }
            if command == "ai_train_app_parity" {
                return http(body: #"{"ok":true,"message":"App-parity training drill queued in the Desktop app."}"#)
            }
            if command == "ai_audit_desktop_ui" {
                return http(body: #"{"ok":true,"message":"Desktop UI audit queued in the Desktop app."}"#)
            }
            if command == "dashboard_refresh" {
                return http(body: #"{"ok":true,"message":"Dashboard refresh queued in the Desktop app."}"#)
            }
            if command.hasPrefix("open_section_") {
                return http(body: #"{"ok":true,"message":"Desktop section opened in the app."}"#)
            }
            if command == "browser_mini_fern" {
                return http(body: #"{"ok":true,"message":"Minified Fern browser opened above the Mac desktop."}"#)
            }
            if command == "browser_popout_fern" {
                return http(body: #"{"ok":true,"message":"Floating Fern browser opened above the Mac desktop."}"#)
            }
            if command == "open_dashboard_articles" {
                return http(body: #"{"ok":true,"message":"Native Articles panel opened in the Desktop app."}"#)
            }
            if command == "open_dashboard_thoughts" {
                return http(body: #"{"ok":true,"message":"Native Thoughts panel opened in the Desktop app."}"#)
            }
            if command == "open_dashboard_shares" {
                return http(body: #"{"ok":true,"message":"Native Shares panel opened in the Desktop app."}"#)
            }
            if command == "open_dashboard_profile" {
                return http(body: #"{"ok":true,"message":"Native Profile panel opened in the Desktop app."}"#)
            }
            if command == "open_dashboard_users" {
                return http(body: #"{"ok":true,"message":"Native Users panel opened in the Desktop app."}"#)
            }
            if command == "open_dashboard_roles" {
                return http(body: #"{"ok":true,"message":"Native Roles panel opened in the Desktop app."}"#)
            }
            if command == "open_dashboard_logs" {
                return http(body: #"{"ok":true,"message":"Native Logs panel opened in the Desktop app."}"#)
            }
            if command.hasPrefix("open_dashboard_") {
                return http(body: #"{"ok":true,"message":"Native dashboard panel opened in the Desktop app."}"#)
            }
            if command == "server_logs" {
                return http(body: #"{"ok":true,"message":"Server logs refresh queued in the Desktop app."}"#)
            }
            if command == "settings_summary" {
                return http(body: #"{"ok":true,"message":"Settings summary queued in the Desktop app."}"#)
            }
            if command == "remote_desktop_status" {
                return http(body: #"{"ok":true,"message":"Remote desktop status shown in the Desktop app."}"#)
            }
            if command == "mac_control_authorize" {
                return http(body: #"{"ok":true,"message":"Mac privacy panes opened for remote-control authorization."}"#)
            }
            if command.hasPrefix("codex_prompt:") {
                return http(body: #"{"ok":true,"message":"Codex prompt queued on this Mac from the Hanasand app."}"#)
            }
            if command.hasPrefix("mac_control_type_text:") {
                return http(body: #"{"ok":true,"message":"Text typed on this Mac from the Hanasand app."}"#)
            }
            if command.hasPrefix("mac_control_pointer_click_at:") {
                return http(body: #"{"ok":true,"message":"Mac preview tap clicked on this Mac from the Hanasand app."}"#)
            }
            return http(body: #"{"ok":false,"message":"Command not allowed. GET /commands lists supported commands."}"#, status: "400 Bad Request")
        }
        return http(body: #"{"ok":false,"message":"Route not found."}"#, status: "404 Not Found")
    }
}
