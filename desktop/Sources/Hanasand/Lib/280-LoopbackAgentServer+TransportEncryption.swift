import CoreFoundation
import CryptoKit
import Foundation

private struct EncryptedBridgeEnvelope: Encodable {
    let encrypted: Bool
    let payload: String
}

extension LoopbackAgentServer {
    static let fixedEncryptedResponseBodyBytes = 262_144

    static func encryptBridgeBody(_ plaintext: Data, certificate: String) throws -> Data {
        let sealedBox = try AES.GCM.seal(plaintext, using: bridgeTransportKey(certificate: certificate))
        guard let combined = sealedBox.combined else {
            throw BridgeEncryptionError.unavailableCombinedBox
        }
        let envelope = EncryptedBridgeEnvelope(encrypted: true, payload: combined.base64EncodedString())
        return try JSONEncoder().encode(envelope)
    }

    static func decryptBridgeBody(_ envelopeBody: Data, certificate: String) throws -> Data {
        guard let object = try JSONSerialization.jsonObject(with: envelopeBody) as? [String: Any],
              Set(object.keys) == Set(["encrypted", "payload"]),
              let encrypted = object["encrypted"] as? NSNumber,
              CFGetTypeID(encrypted) == CFBooleanGetTypeID(), encrypted.boolValue,
              let payload = object["payload"] as? String,
              let combined = Data(base64Encoded: payload),
              let sealedBox = try? AES.GCM.SealedBox(combined: combined) else {
            throw BridgeEncryptionError.invalidEnvelope
        }
        return try AES.GCM.open(sealedBox, using: bridgeTransportKey(certificate: certificate))
    }

    static func encryptHTTPResponse(_ response: String, certificate: String) -> String? {
        guard let separator = response.range(of: "\r\n\r\n"),
              let statusLineEnd = response.range(of: "\r\n"),
              statusLineEnd.lowerBound < separator.lowerBound else {
            return nil
        }
        let statusLine = String(response[..<statusLineEnd.lowerBound])
        guard statusLine.hasPrefix("HTTP/1.1 ") else { return nil }
        let status = String(statusLine.dropFirst("HTTP/1.1 ".count))
        let plaintextBody = Data(response[separator.upperBound...].utf8)

        do {
            let encryptedBody = try encryptBridgeBody(plaintextBody, certificate: certificate)
            guard encryptedBody.count <= fixedEncryptedResponseBodyBytes else { return nil }
            var paddedBody = encryptedBody
            paddedBody.append(Data(repeating: 32, count: fixedEncryptedResponseBodyBytes - encryptedBody.count))
            guard let envelopeString = String(data: paddedBody, encoding: .utf8) else { return nil }
            return httpResponse(body: envelopeString, status: status)
        } catch {
            return nil
        }
    }

    static func requestTarget(from request: String) -> String? {
        guard let firstLine = request.components(separatedBy: "\r\n").first else { return nil }
        let parts = firstLine.split(separator: " ", maxSplits: 2)
        guard parts.count == 3 else { return nil }
        return String(parts[1])
    }

    private static func bridgeTransportKey(certificate: String) -> SymmetricKey {
        let material = Data("hanasand-desktop-agent-transport-v1\n\(certificate)".utf8)
        return SymmetricKey(data: Data(SHA256.hash(data: material)))
    }
}

private enum BridgeEncryptionError: Error {
    case invalidEnvelope
    case unavailableCombinedBox
}
