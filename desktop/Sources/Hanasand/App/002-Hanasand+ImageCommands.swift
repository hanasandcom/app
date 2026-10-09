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
    @CommandsBuilder var imageCommands: some Commands {
        CommandMenu("Images") {
        Button("Open Images") {
        model.selectedSection = .images
        }
        .keyboardShortcut("i", modifiers: [.command, .option])
        
        Button("Import Images...") {
        model.selectedSection = .images
        model.importImagesForReview()
        }
        .keyboardShortcut("i", modifiers: [.command, .shift])
        
        Button("Keep Current") {
        model.decideCurrentImage(.keep)
        }
        .keyboardShortcut(.rightArrow, modifiers: [.command])
        .disabled(model.currentImageReviewItem == nil)
        
        Button("Discard Current") {
        model.decideCurrentImage(.discard)
        }
        .keyboardShortcut(.leftArrow, modifiers: [.command])
        .disabled(model.currentImageReviewItem == nil)
        
        Button("Undo Image Decision") {
        model.undoImageDecision()
        }
        .keyboardShortcut("z", modifiers: [.command, .shift])
        
        Button("Reveal Current Image") {
        model.revealCurrentImage()
        }
        .disabled(model.currentImageReviewItem == nil)
        
        Divider()
        
        Button("Trash Marked...") {
        model.requestTrashImagesApproval()
        }
        .disabled(!model.hasDiscardedImages)
        }
    }
}
