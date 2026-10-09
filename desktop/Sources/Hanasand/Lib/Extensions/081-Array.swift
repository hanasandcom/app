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

extension Array where Element == AIConnectedClient {
    var sortedForRuntime: [AIConnectedClient] {
        sorted { lhs, rhs in
            let leftTPS = lhs.model?.tps ?? 0
            let rightTPS = rhs.model?.tps ?? 0
            if leftTPS == rightTPS {
                return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
            }
            return leftTPS > rightTPS
        }
    }
}
