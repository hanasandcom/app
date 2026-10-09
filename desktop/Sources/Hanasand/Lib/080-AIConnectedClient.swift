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

struct AIConnectedClient: Codable, Identifiable, Equatable {
    var id: String { name }
    let rawID: String?
    let name: String
    let lastSeen: String?
    let model: AIModelMetrics?

    enum CodingKeys: String, CodingKey {
        case rawID = "id"
        case name
        case lastSeen
        case model
    }

    var statusText: String {
        let status = model?.status?.capitalized ?? "Connected"
        let tps = model?.tps ?? 0
        return tps > 0 ? "\(status) · \(String(format: "%.1f", tps)) TPS" : status
    }
}
