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

struct IDEProjectFile: Identifiable {
    let id: String
    let name: String
    let relativePath: String
    let absolutePath: String
    let icon: String
}
