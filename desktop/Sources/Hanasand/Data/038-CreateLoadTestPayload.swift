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

struct CreateLoadTestPayload: Encodable {
    let url: String
    let timeout: Int?
    let stages: [LoadTestStagePayload]?
}
