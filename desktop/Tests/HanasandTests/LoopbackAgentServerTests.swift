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

    func testSessionProofAuthenticatesBodyAndConsumesNonceOnlyAfterValidation() {
        let certificate = "session-certificate"
        let server = LoopbackAgentServer(port: 45731, certificateProvider: { certificate }, onCommand: { _ in })
        let body = Data(#"{"command":"status"}"#.utf8)
        let alteredBody = Data(#"{"command":"mac_control_authorize"}"#.utf8)
        let nonce = UUID().uuidString
        let timestamp = String(Int(Date().timeIntervalSince1970))
        let request = signedRequest(body: body, certificate: certificate, nonce: nonce, timestamp: timestamp)

        XCTAssertFalse(server.hasValidSessionProof(request, body: alteredBody, certificate: certificate))
        XCTAssertTrue(server.hasValidSessionProof(request, body: body, certificate: certificate))
        XCTAssertFalse(server.hasValidSessionProof(request, body: body, certificate: certificate), "A valid proof must not be replayable")
    }

    private func signedRequest(body: Data, certificate: String, nonce: String, timestamp: String) -> String {
        let target = "/command"
        let bodyDigest = SHA256.hash(data: body).map { String(format: "%02x", $0) }.joined()
        let message = "POST\n\(target)\n\(timestamp)\n\(nonce)\n\(bodyDigest)"
        let key = SymmetricKey(data: Data(certificate.utf8))
        let proof = HMAC<SHA256>.authenticationCode(for: Data(message.utf8), using: key)
            .map { String(format: "%02x", $0) }
            .joined()
        return "POST \(target) HTTP/1.1\r\nX-Hanasand-Session-Timestamp: \(timestamp)\r\nX-Hanasand-Session-Nonce: \(nonce)\r\nX-Hanasand-Session-Proof: \(proof)\r\n\r\n"
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
