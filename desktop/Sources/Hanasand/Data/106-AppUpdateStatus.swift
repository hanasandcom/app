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

enum AppUpdateStatus {
    case idle
    case checking(message: String)
    case downloading(message: String)
    case installing(message: String)
    case ready(message: String)
    case upToDate(message: String)
    case unavailable(message: String)
    case failed(message: String)

    var title: String {
        switch self {
        case .idle: return "Ready"
        case .checking: return "Checking"
        case .downloading: return "Downloading"
        case .installing: return "Installing"
        case .ready: return "Update staged"
        case .upToDate: return "Up to date"
        case .unavailable: return "No package"
        case .failed(let message): return message == "Server unavailable" ? "Server unavailable" : "Update failed"
        }
    }

    var message: String {
        switch self {
        case .idle: return "Idle"
        case .checking(let message), .downloading(let message), .installing(let message), .ready(let message), .upToDate(let message), .unavailable(let message), .failed(let message):
            return message
        }
    }

    var isBusy: Bool {
        switch self {
        case .checking, .downloading, .installing: return true
        default: return false
        }
    }

    var isServerUnavailable: Bool {
        switch self {
        case .failed(let message):
            return message == "Server unavailable"
        default:
            return false
        }
    }
}
