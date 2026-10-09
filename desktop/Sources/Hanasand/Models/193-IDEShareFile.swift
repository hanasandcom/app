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

struct IDEShareFile: Identifiable {
    let id: String
    let title: String
    let path: String
    let language: String
    let icon: String
    let seed: String
    var diskPath: String? = nil
    var diskModifiedAt: Date? = nil
}
