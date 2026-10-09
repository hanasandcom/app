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

func formatDateText(_ value: String?, fallback: String) -> String {
    guard let value, !value.isEmpty else { return fallback }
    let iso = ISO8601DateFormatter()
    if let date = iso.date(from: value) {
        return date.formatted(date: .abbreviated, time: .shortened)
    }
    return value
}
