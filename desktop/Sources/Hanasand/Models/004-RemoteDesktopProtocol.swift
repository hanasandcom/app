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

enum RemoteDesktopProtocol: String, CaseIterable, Identifiable {
    case screenSharing
    case microsoftRDP

    var id: String { rawValue }

    var label: String {
        switch self {
        case .screenSharing: return "Screen Sharing"
        case .microsoftRDP: return "Microsoft RDP"
        }
    }

    var icon: String {
        switch self {
        case .screenSharing: return "display"
        case .microsoftRDP: return "rectangle.connected.to.line.below"
        }
    }
}
