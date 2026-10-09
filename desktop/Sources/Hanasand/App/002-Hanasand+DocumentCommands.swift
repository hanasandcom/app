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
    @CommandsBuilder var documentCommands: some Commands {
        CommandMenu("Documents") {
        Button("Open Documents") {
        model.selectedSection = .documents
        }
        .keyboardShortcut("d", modifiers: [.command, .option])
        
        Button("Import Pages...") {
        model.selectedSection = .documents
        model.importDocumentPages()
        }
        .keyboardShortcut("o", modifiers: [.command, .option])
        
        Button("Export PDF...") {
        model.selectedSection = .documents
        model.exportDocumentPDF()
        }
        .keyboardShortcut("p", modifiers: [.command, .option])
        .disabled(model.documentPages.isEmpty)
        
        Button("Reveal Last Export") {
        model.revealExportedDocument()
        }
        .disabled(model.exportedDocumentPath.isEmpty)
        
        Divider()
        
        Button("Clear Pages...") {
        model.requestClearDocumentsApproval()
        }
        .disabled(model.documentPages.isEmpty)
        }
    }
}
