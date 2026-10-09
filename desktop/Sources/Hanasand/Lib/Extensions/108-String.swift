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

extension String {
    var semanticVersionParts: [Int] {
        split(separator: ".").map { part in
            let numericPrefix = part.prefix { $0.isNumber }
            return Int(numericPrefix) ?? 0
        }
    }

    func isNewerVersion(than currentVersion: String) -> Bool {
        let latestParts = semanticVersionParts
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
