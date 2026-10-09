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

struct ChangedFileSummary: Identifiable {
    let id: String
    let status: String
    let path: String
}
