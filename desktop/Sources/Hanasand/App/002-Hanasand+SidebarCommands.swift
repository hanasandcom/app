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
    @CommandsBuilder var sidebarCommands: some Commands {
        CommandGroup(replacing: .sidebar) {
        Button("Toggle Sidebar") {
        model.sidebarVisible.toggle()
        }
        .keyboardShortcut("s", modifiers: [.command, .option])
        }
    }
}
