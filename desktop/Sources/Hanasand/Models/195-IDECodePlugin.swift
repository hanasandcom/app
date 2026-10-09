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

struct IDECodePlugin: Identifiable {
    let id: String
    let language: String
    let icon: String
    let extensions: [String]
    let formatter: String
    let diagnostics: [String]
}
