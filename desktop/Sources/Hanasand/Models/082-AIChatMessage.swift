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

struct AIChatMessage: Identifiable, Equatable {
    enum Role: String {
        case user
        case assistant
    }

    let id: String
    let role: Role
    var content: String
    var createdAt: Date
    var isPending: Bool
    var isError: Bool
    var isReconnectNotice: Bool
    var reconnectStartedAt: Date?
    var reconnectedAt: Date?

    init(
        id: String = UUID().uuidString,
        role: Role,
        content: String,
        createdAt: Date = Date(),
        isPending: Bool = false,
        isError: Bool = false,
        isReconnectNotice: Bool = false,
        reconnectStartedAt: Date? = nil,
        reconnectedAt: Date? = nil
    ) {
        self.id = id
        self.role = role
        self.content = content
        self.createdAt = createdAt
        self.isPending = isPending
        self.isError = isError
        self.isReconnectNotice = isReconnectNotice
        self.reconnectStartedAt = reconnectStartedAt
        self.reconnectedAt = reconnectedAt
    }

    static let seed = [
        AIChatMessage(role: .assistant, content: "Ask a question and I will route it to the fastest connected Hanasand model. Tool use, timing, and file artifacts will appear in the run trace.")
    ]
}
