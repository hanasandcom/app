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

struct IDEQuickCommand: Identifiable {
    let id = UUID()
    let title: String
    let command: String
    let icon: String
}
