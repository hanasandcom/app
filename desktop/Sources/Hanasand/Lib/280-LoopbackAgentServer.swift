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
    let identityNamespace: String
    var listener: NWListener?
    var tlsIdentity: LoopbackTLSServerIdentity?
    var seenProofNonces: [String: Date] = [:]
    let nonceLock = NSLock()

    var tlsCertificateSha256: String? { tlsIdentity?.certificateSHA256 }
    var advertisedIPv4Addresses: [String] { tlsIdentity?.advertisedIPv4Addresses ?? [] }
    var endpoints: [String] { advertisedIPv4Addresses.map { "https://\($0):\(port)" } }

    init(
        port: UInt16,
        certificateProvider: @escaping () -> String,
        onCommand: @escaping (String) -> Void,
        identityNamespace: String = LoopbackTLSServerIdentity.keychainNamespace
    ) {
        self.port = port
        self.certificateProvider = certificateProvider
        self.onCommand = onCommand
        self.identityNamespace = identityNamespace
    }
}
