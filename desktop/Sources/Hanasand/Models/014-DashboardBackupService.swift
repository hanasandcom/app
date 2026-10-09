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

struct DashboardBackupService: Decodable, Identifiable {
    let id: String
    let name: String
    let status: String
    let error: String?
    let dbSize: String?
    let totalStorage: String?
    let lastBackup: String?
    let nextBackup: String?
}
