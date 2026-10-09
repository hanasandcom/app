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

struct QueuedPromptDropDelegate: DropDelegate {
    let target: QueuedPrompt
    @ObservedObject var model: DesktopAgentModel
    @Binding var draggingID: UUID?

    func dropEntered(info: DropInfo) {
        guard let draggingID,
              let dragging = model.promptQueue.first(where: { $0.id == draggingID }),
              dragging.id != target.id else { return }
        withAnimation(.snappy(duration: 0.14)) {
            model.moveQueuedPrompt(dragging, before: target)
        }
    }

    func performDrop(info: DropInfo) -> Bool {
        draggingID = nil
        return true
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        DropProposal(operation: .move)
    }
}
