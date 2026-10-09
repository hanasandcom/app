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

struct IDEOpenRequest: Identifiable, Equatable {
    let id = UUID()
    let path: String
    let line: Int?
    let revealDiff: Bool
}
