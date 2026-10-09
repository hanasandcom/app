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

struct AgentEvent: Identifiable {
    enum Kind {
        case note
        case user
        case command
        case change
        case error
    }

    let id = UUID()
    let meta: String
    let body: String
    let kind: Kind

    static let seed: [AgentEvent] = [
        AgentEvent(meta: "Explored 1 search, ran 2 commands", body: "I am going to pick this up as a product pass: make the desktop app useful for command input, local status, and fast agent loops.", kind: .note),
        AgentEvent(meta: "Reviewed desktop agent", body: "The local agent owns the loopback API and shows the Mac connection directly in the GUI.", kind: .note),
        AgentEvent(meta: "Edited desktop app", body: "Added a native split-pane workspace, transcript, project rail, and command dock tuned for agentic working.", kind: .change),
    ]
}
