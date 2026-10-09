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
    @CommandsBuilder var windowCommands: some Commands {
        CommandGroup(after: .toolbar) {
        Button("Focus Control") {
        model.selectedSection = .control
        model.focusCommand.toggle()
        }
        .keyboardShortcut("k", modifiers: [.command])
        
        Button("Zoom Window") {
        model.zoomWindow()
        }
        .keyboardShortcut("=", modifiers: [.command, .option])
        
        Button("Minimize Window") {
        model.minimizeWindow()
        }
        .keyboardShortcut("m", modifiers: [.command])
        
        Button("Toggle Full Screen") {
        model.toggleFullScreen()
        }
        .keyboardShortcut("f", modifiers: [.command, .control])
        
        Divider()
        
        Button("Reset Native Layout") {
        model.resetNativeLayout()
        }
        .keyboardShortcut("0", modifiers: [.command, .option])
        }
    }
}
