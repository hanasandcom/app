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

struct AIChatContentSegment: Identifiable {
    enum Kind {
        case text
        case json
        case code
    }

    let id = UUID()
    let kind: Kind
    let language: String
    let content: String
}
