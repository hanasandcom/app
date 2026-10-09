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

extension Optional where Wrapped == URL {
    func or(_ fallback: URL) -> URL {
        self ?? fallback
    }
}
