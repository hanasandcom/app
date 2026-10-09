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
    @CommandsBuilder var agentCommands: some Commands {
        CommandMenu("Agent") {
        Button("Run Status") {
        model.runStatusCommand()
        }
        .keyboardShortcut("r", modifiers: [.command])
        
        Button("Focus Chat") {
        model.focusCommand.toggle()
        }
        .keyboardShortcut("k", modifiers: [.command])
        }
    }
}
