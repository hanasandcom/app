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

struct UploadedFileResponse: Decodable {
    let id: String
    let name: String?
    let path: String?
}
