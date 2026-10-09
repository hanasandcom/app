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

struct AITraceEvent: Identifiable, Equatable {
    enum Kind {
        case system
        case thought
        case tool
        case file
        case error

        var icon: String {
            switch self {
            case .system: return "antenna.radiowaves.left.and.right"
            case .thought: return "brain.head.profile"
            case .tool: return "wrench.and.screwdriver"
            case .file: return "doc.text"
            case .error: return "exclamationmark.triangle"
            }
        }
    }

    let id = UUID()
    let kind: Kind
    let title: String
    let detail: String
    let createdAt = Date()
}
