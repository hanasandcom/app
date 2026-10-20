import CryptoKit
import Foundation
import XCTest
@testable import Hanasand

final class LoopbackAgentServerTests: XCTestCase {
    func testRequestReadStateExtractsExactBodyBytes() {
        let body = Data([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0xa9, 0x22, 0x7d])
        let request = Data("POST /command HTTP/1.1\r\nHost: localhost\r\nContent-Length: \(body.count)\r\n\r\n".utf8) + body

        guard case let .complete(parsedBody) = LoopbackAgentServer.requestReadState(request) else {
            return XCTFail("Expected a complete request")
        }

        XCTAssertEqual(parsedBody, body)
    }

    func testRequestReadStateRejectsMalformedAndOversizedRequests() {
        let duplicateLength = Data("POST /command HTTP/1.1\r\nContent-Length: 1\r\nContent-Length: 1\r\n\r\nx".utf8)
        XCTAssertCase(LoopbackAgentServer.requestReadState(duplicateLength), is: .malformed)

        let signedLength = Data("POST /command HTTP/1.1\r\nContent-Length: +1\r\n\r\nx".utf8)
        XCTAssertCase(LoopbackAgentServer.requestReadState(signedLength), is: .malformed)

        let spacedLength = Data("POST /command HTTP/1.1\r\nContent-Length: 1 \r\n\r\nx".utf8)
        XCTAssertCase(LoopbackAgentServer.requestReadState(spacedLength), is: .malformed)

        let transferEncoded = Data("POST /command HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n".utf8)
        XCTAssertCase(LoopbackAgentServer.requestReadState(transferEncoded), is: .malformed)

        let largeBody = Data("POST /command HTTP/1.1\r\nContent-Length: \(LoopbackAgentServer.maximumRequestBodyBytes + 1)\r\n\r\n".utf8)
        XCTAssertCase(LoopbackAgentServer.requestReadState(largeBody), is: .tooLarge)

        let largeHeader = Data(repeating: 65, count: LoopbackAgentServer.maximumRequestHeaderBytes + 1)
        XCTAssertCase(LoopbackAgentServer.requestReadState(largeHeader), is: .tooLarge)
    }

    func testRequestReadStateKeepsIncompleteBodyPending() {
        let partial = Data("POST /command HTTP/1.1\r\nContent-Length: 5\r\n\r\nabc".utf8)
        XCTAssertCase(LoopbackAgentServer.requestReadState(partial), is: .incomplete)
    }

    func testSessionProofAuthenticatesBodyAndConsumesNonceOnlyAfterValidation() throws {
        let certificate = "session-certificate"
        let server = LoopbackAgentServer(port: 45731, certificateProvider: { certificate }, onCommand: { _ in })
        let body = try LoopbackAgentServer.encryptBridgeBody(Data(#"{"command":"status"}"#.utf8), certificate: certificate)
        let alteredBody = try LoopbackAgentServer.encryptBridgeBody(Data(#"{"command":"mac_control_authorize"}"#.utf8), certificate: certificate)
        let nonce = UUID().uuidString
        let timestamp = String(Int(Date().timeIntervalSince1970))
        let request = signedRequest(body: body, certificate: certificate, nonce: nonce, timestamp: timestamp)

        XCTAssertFalse(server.hasValidSessionProof(request, body: alteredBody, certificate: certificate))
        XCTAssertTrue(server.hasValidSessionProof(request, body: body, certificate: certificate))
        XCTAssertFalse(server.hasValidSessionProof(request, body: body, certificate: certificate), "A valid proof must not be replayable")
    }

    func testEncryptedBridgeBodyHasExactEnvelopeAndRoundTrips() throws {
        let certificate = "session-certificate"
        let plaintext = Data(#"{"command":"status"}"#.utf8)

        let envelope = try LoopbackAgentServer.encryptBridgeBody(plaintext, certificate: certificate)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: envelope) as? [String: Any])
        XCTAssertEqual(Set(object.keys), Set(["encrypted", "payload"]))
        XCTAssertEqual(object["encrypted"] as? Bool, true)
        XCTAssertNotNil(object["payload"] as? String)
        XCTAssertEqual(try LoopbackAgentServer.decryptBridgeBody(envelope, certificate: certificate), plaintext)
    }

    func testEncryptedBridgeBodyRejectsMalformedOrTamperedEnvelopes() throws {
        let certificate = "session-certificate"
        let invalidBodies = [
            Data("not-json".utf8),
            Data(#"{"encrypted":false,"payload":"AA=="}"#.utf8),
            Data(#"{"encrypted":true,"payload":"AA==","extra":1}"#.utf8),
            Data(#"{"encrypted":1,"payload":"AA=="}"#.utf8),
            Data(#"{"encrypted":true,"payload":"not-base64"}"#.utf8),
        ]

        for body in invalidBodies {
            XCTAssertThrowsError(try LoopbackAgentServer.decryptBridgeBody(body, certificate: certificate))
        }

        let valid = try LoopbackAgentServer.encryptBridgeBody(Data("valid".utf8), certificate: certificate)
        var tampered = try XCTUnwrap(JSONSerialization.jsonObject(with: valid) as? [String: Any])
        let payload = try XCTUnwrap(tampered["payload"] as? String)
        let payloadBytes = try XCTUnwrap(Data(base64Encoded: payload))
        var tamperedBytes = Array(payloadBytes)
        tamperedBytes[tamperedBytes.count - 1] ^= 0x01
        tampered["payload"] = Data(tamperedBytes).base64EncodedString()
        let tamperedBody = try JSONSerialization.data(withJSONObject: tampered)
        XCTAssertThrowsError(try LoopbackAgentServer.decryptBridgeBody(tamperedBody, certificate: certificate))
    }

    func testAuthenticatedResponseEncryptsBodyAndPreservesStatus() throws {
        let certificate = "session-certificate"
        let body = #"{"ok":false,"message":"permission required"}"#
        let plaintextResponse = "HTTP/1.1 409 Conflict\r\nContent-Length: \(body.utf8.count)\r\n\r\n\(body)"

        let response = try XCTUnwrap(LoopbackAgentServer.encryptHTTPResponse(plaintextResponse, certificate: certificate))
        XCTAssertTrue(response.hasPrefix("HTTP/1.1 409 Conflict\r\n"))

        let separator = try XCTUnwrap(response.range(of: "\r\n\r\n"))
        let responseBody = Data(response[separator.upperBound...].utf8)
        XCTAssertEqual(try LoopbackAgentServer.decryptBridgeBody(responseBody, certificate: certificate), Data(body.utf8))

        let contentLength = try XCTUnwrap(response.components(separatedBy: "\r\n").first(where: { $0.hasPrefix("Content-Length:") }))
        XCTAssertEqual(contentLength, "Content-Length: \(responseBody.count)")
    }

    func testEmptyBodyGetStaysEmptyAndReceivesEncryptedResponse() {
        let certificate = "session-certificate"
        let server = LoopbackAgentServer(port: 45731, certificateProvider: { certificate }, onCommand: { _ in })
        let nonce = UUID().uuidString
        let timestamp = String(Int(Date().timeIntervalSince1970))
        let request = signedRequest(body: Data(), certificate: certificate, nonce: nonce, timestamp: timestamp, target: "/status", method: "GET")

        let response = server.response(for: request, body: Data())
        assertEncryptedResponse(response, certificate: certificate, expectedStatus: "HTTP/1.1 200 OK")
    }

    func testOptionsAndInvalidProofResponsesRemainPlaintext() {
        let certificate = "session-certificate"
        let server = LoopbackAgentServer(port: 45731, certificateProvider: { certificate }, onCommand: { _ in })

        let optionsResponse = server.response(for: "OPTIONS /command HTTP/1.1\r\n\r\n", body: Data())
        XCTAssertTrue(optionsResponse.hasPrefix("HTTP/1.1 204 No Content\r\n"))
        XCTAssertFalse(optionsResponse.contains(#""encrypted":true"#))

        let unauthorizedResponse = server.response(for: "GET /status HTTP/1.1\r\n\r\n", body: Data())
        XCTAssertTrue(unauthorizedResponse.hasPrefix("HTTP/1.1 401 Unauthorized\r\n"))
        XCTAssertFalse(unauthorizedResponse.contains(#""encrypted":true"#))
    }

    func testCommandRouteDecryptsEnvelopeAndRejectsQueryCommands() throws {
        let certificate = "session-certificate"
        var receivedCommands: [String] = []
        let server = LoopbackAgentServer(port: 45731, certificateProvider: { certificate }, onCommand: { receivedCommands.append($0) })

        let encryptedBody = try LoopbackAgentServer.encryptBridgeBody(Data(#"{"command":"status"}"#.utf8), certificate: certificate)
        let nonce = UUID().uuidString
        let timestamp = String(Int(Date().timeIntervalSince1970))
        let request = signedRequest(body: encryptedBody, certificate: certificate, nonce: nonce, timestamp: timestamp)
        let response = server.response(for: request, body: encryptedBody)
        XCTAssertEqual(receivedCommands, ["status"])
        assertEncryptedResponse(response, certificate: certificate, expectedStatus: "HTTP/1.1 200 OK")

        let queryNonce = UUID().uuidString
        let queryTarget = "/command?command=mac_control_authorize"
        let queryRequest = signedRequest(body: encryptedBody, certificate: certificate, nonce: queryNonce, timestamp: timestamp, target: queryTarget)
        let queryResponse = server.response(for: queryRequest, body: encryptedBody)
        XCTAssertEqual(receivedCommands, ["status"])
        assertEncryptedResponse(queryResponse, certificate: certificate, expectedStatus: "HTTP/1.1 400 Bad Request")

        let malformedEnvelope = Data("not-json".utf8)
        let malformedNonce = UUID().uuidString
        let malformedRequest = signedRequest(body: malformedEnvelope, certificate: certificate, nonce: malformedNonce, timestamp: timestamp)
        let malformedResponse = server.response(for: malformedRequest, body: malformedEnvelope)
        XCTAssertEqual(receivedCommands, ["status"])
        assertEncryptedResponse(malformedResponse, certificate: certificate, expectedStatus: "HTTP/1.1 400 Bad Request")
    }

    private func signedRequest(body: Data, certificate: String, nonce: String, timestamp: String, target: String = "/command", method: String = "POST") -> String {
        let bodyDigest = SHA256.hash(data: body).map { String(format: "%02x", $0) }.joined()
        let message = "\(method)\n\(target)\n\(timestamp)\n\(nonce)\n\(bodyDigest)"
        let key = SymmetricKey(data: Data(certificate.utf8))
        let proof = HMAC<SHA256>.authenticationCode(for: Data(message.utf8), using: key)
            .map { String(format: "%02x", $0) }
            .joined()
        return "\(method) \(target) HTTP/1.1\r\nContent-Length: \(body.count)\r\nX-Hanasand-Session-Timestamp: \(timestamp)\r\nX-Hanasand-Session-Nonce: \(nonce)\r\nX-Hanasand-Session-Proof: \(proof)\r\n\r\n"
    }

    private func assertEncryptedResponse(_ response: String, certificate: String, expectedStatus: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(response.hasPrefix("\(expectedStatus)\r\n"), file: file, line: line)
        guard let separator = response.range(of: "\r\n\r\n") else {
            return XCTFail("Missing response headers", file: file, line: line)
        }
        let body = Data(response[separator.upperBound...].utf8)
        XCTAssertNoThrow(try LoopbackAgentServer.decryptBridgeBody(body, certificate: certificate), file: file, line: line)
    }
}

private func XCTAssertCase(
    _ state: LoopbackAgentServer.RequestReadState,
    is expected: LoopbackAgentServer.RequestReadState,
    file: StaticString = #filePath,
    line: UInt = #line
) {
    switch (state, expected) {
    case (.incomplete, .incomplete), (.malformed, .malformed), (.tooLarge, .tooLarge), (.complete(_), .complete(_)):
        return
    default:
        XCTFail("Request state did not match expected state", file: file, line: line)
    }
}
