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

extension AgentEvent.Kind {
    init(persistenceValue: String) {
        switch persistenceValue {
        case "note":
            self = .note
        case "user":
            self = .user
        case "change":
            self = .change
        case "error":
            self = .error
        default:
            self = .command
        }
    }

    var persistenceValue: String {
        switch self {
        case .note:
            return "note"
        case .user:
            return "user"
        case .command:
            return "command"
        case .change:
            return "change"
        case .error:
            return "error"
        }
    }

    var icon: String {
        switch self {
        case .note:
            return "note.text"
        case .user:
            return "person.crop.circle"
        case .command:
            return "terminal"
        case .change:
            return "checkmark.seal"
        case .error:
            return "exclamationmark.triangle"
        }
    }
}
