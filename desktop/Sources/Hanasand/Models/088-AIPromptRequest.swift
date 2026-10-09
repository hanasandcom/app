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

struct AIPromptRequest: Encodable {
    struct Message: Encodable {
        let role: String
        let content: String
    }

    let type: String
    let conversationId: String
    let clientName: String
    let messages: [Message]
    let maxTokens: Int
    let temperature: Double
}
