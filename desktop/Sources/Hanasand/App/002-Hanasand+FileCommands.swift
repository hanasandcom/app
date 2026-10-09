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
    @CommandsBuilder var fileCommands: some Commands {
        CommandGroup(after: .newItem) {
        Button("Import Document Pages...") {
        model.selectedSection = .documents
        model.importDocumentPages()
        }
        .keyboardShortcut("o", modifiers: [.command])
        
        Button("Import Images...") {
        model.selectedSection = .images
        model.importImagesForReview()
        }
        .keyboardShortcut("i", modifiers: [.command, .shift])
        
        Button("Choose Upload File...") {
        model.openNativeDashboard(path: "/dashboard/files", label: "Files")
        model.chooseUploadFile()
        }
        .keyboardShortcut("u", modifiers: [.command, .option])
        
        Button("Export Document PDF...") {
        model.selectedSection = .documents
        model.exportDocumentPDF()
        }
        .keyboardShortcut("e", modifiers: [.command, .option])
        }
    }
}
