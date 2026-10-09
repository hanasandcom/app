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

struct AISocketEvent: Decodable {
    let type: String
    let clients: [AIConnectedClient]?
    let client: AIConnectedClient?
    let conversationId: String?
    let clientName: String?
    let delta: String?
    let content: String?
    let error: String?
    let toolId: String?
    let toolLabel: String?
    let toolState: String?
    let toolDetail: String?
    let artifacts: [AIArtifact]?
    let overhead: AIOverheadSample?
}
