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

extension String {
    func cleanBrowserTargetSuffix() -> String {
        trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: " in the built in browser", with: "", options: .caseInsensitive)
            .replacingOccurrences(of: " in the built-in browser", with: "", options: .caseInsensitive)
            .replacingOccurrences(of: " in browser", with: "", options: .caseInsensitive)
            .replacingOccurrences(of: " in the browser", with: "", options: .caseInsensitive)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
