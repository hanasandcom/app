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

struct BrowserDestination: Identifiable {
    let id = UUID()
    let title: String
    let subtitle: String
    let icon: String
    let url: String
}
