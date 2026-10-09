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

enum MiniBrowserCorner: String, CaseIterable, Identifiable {
    case topLeft
    case topRight
    case bottomLeft
    case bottomRight

    var id: String { rawValue }

    var title: String {
        switch self {
        case .topLeft: return "TL"
        case .topRight: return "TR"
        case .bottomLeft: return "BL"
        case .bottomRight: return "BR"
        }
    }
}
