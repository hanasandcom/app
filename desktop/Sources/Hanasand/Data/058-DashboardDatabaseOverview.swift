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

struct DashboardDatabaseOverview: Decodable {
    let generatedAt: String
    let clusterCount: Int
    let databaseCount: Int
    let totalSizeBytes: Int
    let activeQueries: Int
    let averageQuerySeconds: Double?
    let clusters: [DashboardDatabaseCluster]
}
