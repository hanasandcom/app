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

struct IDEDiffHunk: Identifiable, Equatable {
    let id = UUID()
    let title: String
    let newLine: Int
}
