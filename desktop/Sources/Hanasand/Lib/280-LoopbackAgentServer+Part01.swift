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
    func start() throws {
        let listener = try NWListener(using: .tcp, on: NWEndpoint.Port(rawValue: port)!)
        listener.newConnectionHandler = { [weak self] connection in
            self?.handle(connection)
        }
        listener.start(queue: .global(qos: .userInitiated))
        self.listener = listener
    }

    func handle(_ connection: NWConnection) {
        connection.start(queue: .global(qos: .userInitiated))
        var buffer = Data()

        func receiveMore() {
            connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, isComplete, _ in
                guard let self else {
                    connection.cancel()
                    return
                }
                if let data {
                    buffer.append(data)
                }
                if let request = String(data: buffer, encoding: .utf8),
                   Self.hasCompleteHTTPRequest(request) || isComplete {
                    let response = self.response(for: request)
                    connection.send(content: response.data(using: .utf8), completion: .contentProcessed { _ in
                        connection.cancel()
                    })
                    return
                }
                receiveMore()
            }
        }

        receiveMore()
    }

    static func hasCompleteHTTPRequest(_ request: String) -> Bool {
        guard let separatorRange = request.range(of: "\r\n\r\n") else { return false }
        let header = String(request[..<separatorRange.lowerBound])
        let body = String(request[separatorRange.upperBound...])
        let contentLength = header
            .components(separatedBy: "\r\n")
            .first { $0.lowercased().hasPrefix("content-length:") }
            .flatMap { Int($0.split(separator: ":", maxSplits: 1).last?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "") } ?? 0
        return body.utf8.count >= contentLength
    }

    static func screenshotResponse() -> String {
        guard let cgImage = CGDisplayCreateImage(CGMainDisplayID()) else {
            return #"{"ok":false,"message":"Unable to capture the Mac screen. Check Screen Recording permission."}"#
        }

        let maxWidth: CGFloat = 900
        let sourceSize = NSSize(width: cgImage.width, height: cgImage.height)
        let scale = min(1, maxWidth / max(sourceSize.width, 1))
        let targetSize = NSSize(width: sourceSize.width * scale, height: sourceSize.height * scale)
        let sourceImage = NSImage(cgImage: cgImage, size: sourceSize)
        let targetImage = NSImage(size: targetSize)
        targetImage.lockFocus()
        sourceImage.draw(in: NSRect(origin: .zero, size: targetSize), from: NSRect(origin: .zero, size: sourceSize), operation: .copy, fraction: 1)
        targetImage.unlockFocus()

        guard let tiff = targetImage.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiff),
              let png = bitmap.representation(using: .png, properties: [:]) else {
            return #"{"ok":false,"message":"Unable to encode the Mac screenshot."}"#
        }

        return #"{"ok":true,"message":"Mac screen captured.","mimeType":"image/png","imageBase64":"\#(png.base64EncodedString())"}"#
    }
}
