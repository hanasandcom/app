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
    @CommandsBuilder var pasteboardCommands: some Commands {
        CommandGroup(after: .pasteboard) {
        Button("Copy Current Context") {
        model.copyCurrentContext()
        }
        .keyboardShortcut("c", modifiers: [.command, .shift])
        
        Button("Share Current Context...") {
        model.shareCurrentContext()
        }
        .keyboardShortcut("s", modifiers: [.command, .shift])
        }
    }
}
