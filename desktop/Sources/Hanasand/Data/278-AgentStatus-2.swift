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

extension AgentStatus {
    var aiContext: String {
        [
            "agent=\(agent)",
            "host=\(hostname)",
            "platform=\(platform)",
            "user=\(user)",
            "cwd=\(cwd)",
            "uptimeSeconds=\(Int(uptimeSeconds))",
        ].joined(separator: "\n")
    }
}
