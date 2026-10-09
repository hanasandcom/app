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

struct DashboardDatabaseCluster: Decodable, Identifiable {
    let id: String
    let name: String
    let engine: String?
    let version: String?
    let host: String?
    let activeQueries: Int
    let totalSizeBytes: Int
    let databaseCount: Int
    let error: String?
    let databases: [DashboardDatabase]
}
