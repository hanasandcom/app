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
    @CommandsBuilder var appCommands: some Commands {
        sidebarCommands
        windowCommands
        fileCommands
        pasteboardCommands
        controlCommands
        navigateCommands
        agentCommands
        mailCommands
        documentCommands
        imageCommands
    }
}
