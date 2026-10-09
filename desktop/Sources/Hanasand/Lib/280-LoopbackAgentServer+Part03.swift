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

extension LoopbackAgentServer {

    func isAuthorized(_ request: String) -> Bool {
        let certificate = certificateProvider().trimmingCharacters(in: .whitespacesAndNewlines)
        guard !certificate.isEmpty else { return false }
        return hasValidSessionProof(request, certificate: certificate)
    }

    func hasValidSessionProof(_ request: String, certificate: String) -> Bool {
        guard let timestamp = Self.headerValue("x-hanasand-session-timestamp", from: request),
              let timestampValue = TimeInterval(timestamp),
              abs(Date().timeIntervalSince1970 - timestampValue) <= 120,
              let nonce = Self.headerValue("x-hanasand-session-nonce", from: request),
              !nonce.isEmpty,
              nonce.count <= 160,
              consumeProofNonce(nonce, timestamp: timestampValue),
              let proof = Self.headerValue("x-hanasand-session-proof", from: request),
              let firstLine = request.components(separatedBy: "\r\n").first else {
            return false
        }

        let parts = firstLine.split(separator: " ", maxSplits: 2).map(String.init)
        guard parts.count >= 2 else { return false }
        let material = "\(certificate)\n\(parts[0])\n\(parts[1])\n\(timestamp)\n\(nonce)"
        let digest = SHA256.hash(data: Data(material.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
        return Self.timingSafeEqual(proof.lowercased(), digest)
    }

    func consumeProofNonce(_ nonce: String, timestamp: TimeInterval) -> Bool {
        nonceLock.lock()
        defer { nonceLock.unlock() }

        let now = Date()
        seenProofNonces = seenProofNonces.filter { now.timeIntervalSince($0.value) <= 180 }
        guard seenProofNonces[nonce] == nil else { return false }
        seenProofNonces[nonce] = Date(timeIntervalSince1970: timestamp)
        return true
    }

    static func timingSafeEqual(_ left: String, _ right: String) -> Bool {
        let leftBytes = Array(left.utf8)
        let rightBytes = Array(right.utf8)
        var diff = leftBytes.count ^ rightBytes.count
        for index in 0..<max(leftBytes.count, rightBytes.count) {
            diff |= Int((index < leftBytes.count ? leftBytes[index] : 0) ^ (index < rightBytes.count ? rightBytes[index] : 0))
        }
        return diff == 0
    }

    static func headerValue(_ name: String, from request: String) -> String? {
        let lowercasedName = name.lowercased()
        return request
            .components(separatedBy: "\r\n")
            .dropFirst()
            .first { $0.lowercased().hasPrefix("\(lowercasedName):") }
            .flatMap { line in
                line.split(separator: ":", maxSplits: 1).last?
                    .trimmingCharacters(in: .whitespacesAndNewlines)
            }
    }

    static func requiresAccessibility(_ command: String) -> Bool {
        command.hasPrefix("mac_control_type_text:")
            || command.hasPrefix("mac_control_pointer_click_at:")
    }
}
