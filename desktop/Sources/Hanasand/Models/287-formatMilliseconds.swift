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

func formatMilliseconds(_ milliseconds: Double) -> String {
    if milliseconds < 1000 {
        return "\(Int(milliseconds)) ms"
    }
    let seconds = milliseconds / 1000
    if seconds < 60 {
        return "\(String(format: "%.1f", seconds)) s"
    }
    return "\(Int(seconds / 60))m \(Int(seconds.truncatingRemainder(dividingBy: 60)))s"
}
