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

struct DashboardScanStatus: Decodable {
    let isRunning: Bool
    let startedAt: String?
    let finishedAt: String?
    let lastSuccessAt: String?
    let lastError: String?
    let totalImages: Int?
    let completedImages: Int
    let currentImage: String?
}
