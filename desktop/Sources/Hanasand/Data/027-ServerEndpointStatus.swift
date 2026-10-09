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

struct ServerEndpointStatus: Identifiable {
    let id = UUID()
    let title: String
    let target: String
    let isReachable: Bool?
    let detail: String
    let checkedAt: Date

    var stateLabel: String {
        switch isReachable {
        case .some(true):
            return "Reachable"
        case .some(false):
            return "Blocked"
        case .none:
            return "Unknown"
        }
    }
}
