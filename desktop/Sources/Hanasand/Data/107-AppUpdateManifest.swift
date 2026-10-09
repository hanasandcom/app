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

struct AppUpdateManifest: Decodable {
    let app: String
    let platform: String
    let installedVersion: String
    let latestVersion: String
    let updateAvailable: Bool
    let channel: String
    let releasedAt: String
    let notes: String
    let downloadURL: URL
    let packageSize: Int?
    let sha256: String?

    enum CodingKeys: String, CodingKey {
        case app
        case platform
        case installedVersion = "installed_version"
        case latestVersion = "latest_version"
        case updateAvailable = "update_available"
        case channel
        case releasedAt = "released_at"
        case notes
        case downloadURL = "download_url"
        case packageSize = "package_size"
        case sha256
    }

    func hasNewerVersion(than currentVersion: String) -> Bool {
        let latestParts = latestVersion.semanticVersionParts
        let currentParts = currentVersion.semanticVersionParts
        let count = max(latestParts.count, currentParts.count)

        for index in 0..<count {
            let latestValue = index < latestParts.count ? latestParts[index] : 0
            let currentValue = index < currentParts.count ? currentParts[index] : 0
            if latestValue != currentValue {
                return latestValue > currentValue
            }
        }

        return false
    }
}
