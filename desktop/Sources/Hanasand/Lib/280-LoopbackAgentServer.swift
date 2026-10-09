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

final class LoopbackAgentServer {
    let port: UInt16
    let certificateProvider: () -> String
    let onCommand: (String) -> Void
    var listener: NWListener?
    var seenProofNonces: [String: Date] = [:]
    let nonceLock = NSLock()

    init(port: UInt16, certificateProvider: @escaping () -> String, onCommand: @escaping (String) -> Void) {
        self.port = port
        self.certificateProvider = certificateProvider
        self.onCommand = onCommand
    }
}
