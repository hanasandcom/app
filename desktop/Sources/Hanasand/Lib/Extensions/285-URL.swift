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

extension URL {
    func appendingAPIPath(_ path: String) -> URL {
        var url = self
        for component in path.split(separator: "/") where !component.isEmpty {
            url.appendPathComponent(String(component))
        }
        return url
    }

    var usesSecureHanasandTransport: Bool {
        guard let scheme = scheme?.lowercased() else { return false }
        if scheme == "https" { return true }
        guard scheme == "http", let host else { return false }
        return Self.isPrivateNetworkHost(host)
    }

    static func isPrivateNetworkHost(_ rawHost: String) -> Bool {
        let host = rawHost.lowercased()
        if host == "localhost" || host == "127.0.0.1" || host == "::1" || host.hasSuffix(".local") {
            return true
        }
        if host.hasPrefix("10.") || host.hasPrefix("192.168.") {
            return true
        }
        let parts = host.split(separator: ".")
        if parts.count >= 2,
           parts[0] == "172",
           let second = Int(parts[1]),
           (16...31).contains(second) {
            return true
        }
        return false
    }
}
