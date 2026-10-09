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

func formatBytes(_ bytes: Int) -> String {
    guard bytes > 0 else { return "0 B" }
    let units = ["B", "KB", "MB", "GB", "TB"]
    var value = Double(bytes)
    var index = 0
    while value >= 1024 && index < units.count - 1 {
        value /= 1024
        index += 1
    }
    return "\(String(format: index == 0 ? "%.0f" : "%.2f", value)) \(units[index])"
}
