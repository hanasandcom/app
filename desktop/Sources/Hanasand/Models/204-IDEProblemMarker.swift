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

struct IDEProblemMarker: Identifiable {
    let id: String
    let label: String
    let detail: String
    let filePath: String
    let line: Int
    let severity: String

    var icon: String {
        severity == "error" ? "xmark.octagon" : "exclamationmark.triangle"
    }
}
