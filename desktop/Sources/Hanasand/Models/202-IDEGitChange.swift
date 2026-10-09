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

struct IDEGitChange: Identifiable {
    let id: String
    let status: String
    let path: String
    let absolutePath: String

    var icon: String {
        if status.contains("A") || status.contains("?") { return "plus.circle" }
        if status.contains("D") { return "minus.circle" }
        if status.contains("R") { return "arrow.triangle.2.circlepath" }
        return "pencil.circle"
    }
}
