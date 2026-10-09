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

struct IDEOutlineItem: Identifiable {
    let id = UUID()
    let title: String
    let line: Int
    let icon: String
}
