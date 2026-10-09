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

extension Data {
    mutating func appendUTF8(_ string: String) {
        append(Data(string.utf8))
    }

    mutating func appendMultipartBoundary(_ boundary: String) {
        appendUTF8("--\(boundary)\r\n")
    }
}
