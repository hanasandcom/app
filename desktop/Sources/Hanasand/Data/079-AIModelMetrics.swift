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

struct AIModelMetrics: Codable, Equatable {
    let conversationId: String?
    let status: String?
    let currentTokens: Int?
    let maxTokens: Int?
    let promptTokens: Int?
    let generatedTokens: Int?
    let contextTokens: Int?
    let contextMaxTokens: Int?
    let tps: Double?
    let lastUpdated: String?
    let lastError: String?
}
