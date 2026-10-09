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
    @CommandsBuilder var navigateCommands: some Commands {
        CommandMenu("Navigate") {
        ForEach(DesktopSection.allCases) { section in
        Button(section.title) {
        model.selectedSection = section
        }
        .keyboardShortcut(section.shortcutKey, modifiers: [.command, .option])
        }
        }
    }
}
