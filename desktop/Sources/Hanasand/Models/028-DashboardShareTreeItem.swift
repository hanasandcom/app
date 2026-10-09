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

struct DashboardShareTreeItem: Decodable, Identifiable {
    let id: String
    let name: String
    let alias: String?
    let parent: String?
    let type: String?
    let children: [DashboardShareTreeItem]?
}
