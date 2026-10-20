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
    static let maximumRequestHeaderBytes = 16_384
    static let maximumRequestBodyBytes = 262_144
    static let requestReadTimeout: DispatchTimeInterval = .seconds(10)

    enum RequestReadState {
        case incomplete
        case complete(body: Data)
        case malformed
        case tooLarge
    }

    func start(advertisingIPv4Addresses addresses: [String]) throws {
        let identity = try LoopbackTLSServerIdentity.load(advertising: addresses, namespace: identityNamespace)
        let parameters = try LoopbackTLSServerIdentity.makeTLSParameters(identity: identity.identity)
        let listener = try NWListener(using: parameters, on: NWEndpoint.Port(rawValue: port)!)
        listener.newConnectionHandler = { [weak self] connection in
            self?.handle(connection)
        }
        listener.start(queue: .global(qos: .userInitiated))
        tlsIdentity = identity
        self.listener = listener
    }

    func restart(advertisingIPv4Addresses addresses: [String]) throws {
        if let listener {
            let cancelled = DispatchSemaphore(value: 0)
            listener.stateUpdateHandler = { state in
                if case .cancelled = state { cancelled.signal() }
            }
            listener.cancel()
            guard cancelled.wait(timeout: .now() + 3) == .success else {
                throw NSError(
                    domain: "com.hanasand.desktop.loopback-tls",
                    code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "The previous HTTPS listener did not close in time to rotate its certificate."]
                )
            }
        }
        listener = nil
        try start(advertisingIPv4Addresses: addresses)
    }

    func handle(_ connection: NWConnection) {
        let queue = DispatchQueue(label: "com.hanasand.desktop.loopback-request")
        connection.start(queue: queue)
        var buffer = Data()
        var finished = false

        func send(_ response: String) {
            guard !finished else { return }
            finished = true
            connection.send(content: response.data(using: .utf8), completion: .contentProcessed { _ in
                connection.cancel()
            })
        }

        func sendError(_ message: String, status: String) {
            send(self.http(body: #"{"ok":false,"message":"\#(message)"}"#, status: status))
        }

        queue.asyncAfter(deadline: .now() + Self.requestReadTimeout) {
            sendError("Request timed out.", status: "408 Request Timeout")
        }

        func receiveMore() {
            connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, isComplete, error in
                guard let self else {
                    connection.cancel()
                    return
                }
                guard !finished else { return }
                if error != nil {
                    sendError("Malformed request.", status: "400 Bad Request")
                    return
                }
                if let data {
                    buffer.append(data)
                }
                switch Self.requestReadState(buffer) {
                case .complete(let body):
                    guard let request = String(data: buffer, encoding: .utf8) else {
                        sendError("Request must be valid UTF-8.", status: "400 Bad Request")
                        return
                    }
                    send(self.response(for: request, body: body))
                case .malformed:
                    sendError("Malformed request.", status: "400 Bad Request")
                case .tooLarge:
                    sendError("Request is too large.", status: "413 Content Too Large")
                case .incomplete where isComplete:
                    sendError("Incomplete request.", status: "400 Bad Request")
                case .incomplete:
                    receiveMore()
                }
            }
        }

        receiveMore()
    }

    static func requestReadState(_ request: Data) -> RequestReadState {
        let separator = Data([13, 10, 13, 10])
        guard let separatorRange = request.range(of: separator) else {
            return request.count > maximumRequestHeaderBytes ? .tooLarge : .incomplete
        }
        guard separatorRange.lowerBound <= maximumRequestHeaderBytes,
              let header = String(data: request[..<separatorRange.lowerBound], encoding: .utf8) else {
            return .malformed
        }

        let lines = header.components(separatedBy: "\r\n")
        guard let requestLine = lines.first,
              requestLine.split(separator: " ").count == 3,
              requestLine.hasSuffix("HTTP/1.1") else {
            return .malformed
        }

        var contentLength: Int?
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { return .malformed }
            let name = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
            let rawValue = line[line.index(after: colon)...]
            let value = rawValue.drop(while: { $0 == " " || $0 == "\t" })
            if name == "transfer-encoding" { return .malformed }
            if name == "content-length" {
                guard contentLength == nil,
                      !value.isEmpty,
                      value.utf8.allSatisfy({ $0 >= 48 && $0 <= 57 }),
                      let parsed = Int(value) else {
                    return .malformed
                }
                contentLength = parsed
            }
        }

        let bodyLength = contentLength ?? 0
        guard bodyLength <= maximumRequestBodyBytes else { return .tooLarge }
        let receivedBodyLength = request.count - separatorRange.upperBound
        guard receivedBodyLength <= bodyLength else { return .malformed }
        guard receivedBodyLength == bodyLength else { return .incomplete }
        return .complete(body: request[separatorRange.upperBound...])
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
