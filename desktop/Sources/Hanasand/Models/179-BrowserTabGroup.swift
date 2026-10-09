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

struct BrowserTabGroup: Identifiable {
    let id: String
    let title: String
    let icon: String
    var tabs: [BrowserTabState]
    let destinations: [BrowserDestination]
    var isCustom = false
}
