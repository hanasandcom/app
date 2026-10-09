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

    static func commandFromBody(_ request: String) -> String? {
        guard let separatorRange = request.range(of: "\r\n\r\n") else { return nil }
        let body = String(request[separatorRange.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return nil }

        if let data = body.data(using: .utf8),
           let decoded = try? JSONDecoder().decode(LoopbackCommandRequest.self, from: data) {
            return decoded.command
        }

        for pair in body.split(separator: "&") {
            let parts = pair.split(separator: "=", maxSplits: 1).map(String.init)
            guard parts.count == 2, parts[0] == "command" else { continue }
            return decodedCommandValue(parts[1])
        }
        return decodedCommandValue(body)
    }

    static func commandFromQuery(_ request: String) -> String? {
        guard let firstLine = request.components(separatedBy: "\r\n").first,
              let queryRange = firstLine.range(of: "?") else { return nil }
        let query = firstLine[queryRange.upperBound...].split(separator: " ").first.map(String.init) ?? ""
        for pair in query.split(separator: "&") {
            let parts = pair.split(separator: "=", maxSplits: 1).map(String.init)
            guard parts.count == 2, parts[0] == "command" else { continue }
            return decodedCommandValue(parts[1])
        }
        return nil
    }

    static func decodedCommandValue(_ value: String) -> String {
        let formDecoded = value.replacingOccurrences(of: "+", with: " ")
        return (formDecoded.removingPercentEncoding ?? formDecoded).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func encode<T: Encodable>(_ value: T) -> String {
        let encoder = JSONEncoder()
        guard let data = try? encoder.encode(value), let string = String(data: data, encoding: .utf8) else {
            return #"{"ok":false,"message":"Unable to encode response."}"#
        }
        return string
    }

    func http(body: String, status: String = "200 OK") -> String {
        """
        HTTP/1.1 \(status)\r
        Content-Type: application/json\r
        Access-Control-Allow-Methods: GET, POST, OPTIONS\r
        Access-Control-Allow-Headers: Content-Type, Authorization, id, X-Hanasand-Session-Timestamp, X-Hanasand-Session-Nonce, X-Hanasand-Session-Proof\r
        Content-Length: \(body.utf8.count)\r
        Connection: close\r
        \r
        \(body)
        """
    }
}
