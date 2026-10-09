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
    @CommandsBuilder var mailCommands: some Commands {
        CommandMenu("Mail") {
        Button("Open Mail") {
        model.openNativeDashboard(path: "/mail", label: "Mail")
        }
        .keyboardShortcut("1", modifiers: [.command, .shift])
        
        Button("Refresh Mail") {
        Task { await model.loadMailOverview() }
        }
        .keyboardShortcut("r", modifiers: [.command, .shift])
        
        Button("New Message") {
        model.mailComposerExpanded = true
        }
        .keyboardShortcut("n", modifiers: [.command, .shift])
        
        Button("Mark Read/Unread") {
        Task { await model.toggleSelectedMailReadState() }
        }
        .keyboardShortcut("u", modifiers: [.command, .shift])
        
        Button("Flag/Unflag") {
        Task { await model.toggleSelectedMailFlagState() }
        }
        .keyboardShortcut("l", modifiers: [.command, .shift])
        
        Button("Archive") {
        Task { await model.runSelectedMailAction("archive") }
        }
        .keyboardShortcut("e", modifiers: [.command, .shift])
        
        Button("Reply") {
        model.composeReplyToSelectedMail()
        }
        .keyboardShortcut("r", modifiers: [.command, .option])
        
        Button("Reply All") {
        model.composeReplyAllToSelectedMail()
        }
        .keyboardShortcut("r", modifiers: [.command, .option, .shift])
        
        Button("Forward") {
        model.composeForwardSelectedMail()
        }
        .keyboardShortcut("f", modifiers: [.command, .option])
        
        Button("Move to Trash") {
        Task { await model.runSelectedMailAction("trash") }
        }
        .keyboardShortcut(.delete, modifiers: [.command])
        }
    }
}
