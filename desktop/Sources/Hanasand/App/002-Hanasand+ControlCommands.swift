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

extension Hanasand {
    @CommandsBuilder var controlCommands: some Commands {
        CommandMenu("Control") {
        Button("Open Control") {
        model.selectedSection = .control
        model.focusCommand.toggle()
        }
        .keyboardShortcut("0", modifiers: [.command, .shift])
        
        Button("Run Prompt") {
        model.submitPrompt()
        }
        .keyboardShortcut(.return, modifiers: [.command])
        .disabled(model.prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isRunning)
        
        Button("Approve Pending Action") {
        model.approvePendingAction()
        }
        .keyboardShortcut(.return, modifiers: [.command, .shift])
        .disabled(model.pendingApproval == nil || model.pendingApproval?.kind == .blocked)
        
        Button("Cancel Pending Action") {
        model.cancelPendingApproval()
        }
        .keyboardShortcut(.escape, modifiers: [.command])
        .disabled(model.pendingApproval == nil)
        
        Divider()
        
        Button("Refresh This Mac") {
        Task { await model.refreshLocalStatus() }
        }
        .keyboardShortcut("m", modifiers: [.command, .shift])
        
        Button("Server Logs") {
        Task { await model.checkServerLogs() }
        }
        .keyboardShortcut("l", modifiers: [.command, .shift])
        
        Button("Health Check") {
        Task { await model.checkServerReachability() }
        }
        .keyboardShortcut("h", modifiers: [.command, .shift])
        
        Button("Copy Server Diagnostics") {
        model.copyServerDiagnostics()
        }
        .keyboardShortcut("d", modifiers: [.command, .shift])
        
        Button("Start Server") {
        Task { await model.runServerAction(model.settings.serverStartPath) }
        }
        
        Button("Stop Server...") {
        model.requestStopServerApproval()
        }
        
        Divider()
        
        Button("Remote Tunnel...") {
        model.requestRemoteTunnelApproval()
        }
        
        Button("Remote Desktop") {
        model.openRemoteDesktop()
        }
        
        Button("VPN") {
        model.openVPN()
        }
        }
    }
}
