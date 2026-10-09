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

enum ControlApprovalKind: String {
    case stopServer
    case openTunnel
    case trashImages
    case clearDocuments
    case blocked
}
