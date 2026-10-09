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

enum DesktopSection: String, CaseIterable, Identifiable {
    case command
    case control
    case dashboard
    case browser
    case ide
    case mac
    case mail
    case documents
    case images
    case server
    case updates
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .command: return "Chat"
        case .control: return "Control"
        case .dashboard: return "Dashboard"
        case .browser: return "Workspace"
        case .ide: return "IDE"
        case .mac: return "This Mac"
        case .mail: return "Mail"
        case .documents: return "Documents"
        case .images: return "Images"
        case .server: return "Server"
        case .updates: return "Updates"
        case .settings: return "Settings"
        }
    }

    var icon: String {
        switch self {
        case .command: return "sparkles"
        case .control: return "slider.horizontal.3"
        case .dashboard: return "square.grid.2x2"
        case .browser: return "rectangle.3.group"
        case .ide: return "curlybraces.square"
        case .mac: return "desktopcomputer"
        case .mail: return "envelope"
        case .documents: return "doc.viewfinder"
        case .images: return "photo.on.rectangle.angled"
        case .server: return "server.rack"
        case .updates: return "arrow.triangle.2.circlepath"
        case .settings: return "gearshape"
        }
    }

    var shortcutKey: KeyEquivalent {
        switch self {
        case .command: return "1"
        case .control: return "2"
        case .dashboard: return "3"
        case .browser: return "4"
        case .ide: return "5"
        case .mac: return "6"
        case .mail: return "7"
        case .documents: return "8"
        case .images: return "9"
        case .server: return "r"
        case .updates: return "u"
        case .settings: return ","
        }
    }
}
