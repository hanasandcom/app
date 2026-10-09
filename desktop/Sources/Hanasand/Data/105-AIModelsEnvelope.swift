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

struct AIModelsEnvelope: Decodable {
    struct Client: Decodable {
        let id: String?
        let name: String
        let lastSeen: String?
        let model: AIModelMetrics?
    }

    let connected: [Client]
}
