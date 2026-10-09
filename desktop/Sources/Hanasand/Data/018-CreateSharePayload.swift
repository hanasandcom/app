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

struct CreateSharePayload: Encodable {
    let id: String
    let includeTree: Bool
    let name: String
    let path: String
    let content: String
    let parent: String?
    let type: String
}
