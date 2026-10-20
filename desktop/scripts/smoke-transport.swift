import CryptoKit
import Foundation

private func fail(_ message: String) -> Never {
    fputs("smoke transport: \(message)\n", stderr)
    exit(2)
}

private func hex<S: Sequence>(_ data: S) -> String where S.Element == UInt8 {
    data.map { String(format: "%02x", $0) }.joined()
}

private func splitCredentialsAndBody(_ input: Data) -> (userID: String, token: String, body: Data) {
    let separator = Data([0])
    guard let userEnd = input.range(of: separator) else { fail("missing user ID") }
    let tokenStart = userEnd.upperBound
    guard let tokenEnd = input.range(of: separator, in: tokenStart..<input.endIndex) else {
        fail("missing session token")
    }
    guard let userID = String(data: input[..<userEnd.lowerBound], encoding: .utf8),
          let token = String(data: input[tokenStart..<tokenEnd.lowerBound], encoding: .utf8) else {
        fail("credentials must be UTF-8")
    }
    return (userID, token, Data(input[tokenEnd.upperBound...]))
}

guard (CommandLine.arguments.count == 3)
    || (CommandLine.arguments.count == 2 && CommandLine.arguments[1] == "--decrypt-response") else {
    fail("usage: smoke-transport METHOD REQUEST_TARGET | --decrypt-response")
}

let input = FileHandle.standardInput.readDataToEndOfFile()
let (rawUserID, rawToken, plainBody) = splitCredentialsAndBody(input)
let userID = rawUserID.trimmingCharacters(in: .whitespacesAndNewlines)
let token = rawToken.trimmingCharacters(in: .whitespacesAndNewlines)
guard !userID.isEmpty, !token.isEmpty else { fail("user ID and session token are required") }

let certificateMaterial = "hanasand-desktop-agent-session-v1\n\(userID)\n\(token)"
let certificate = hex(SHA256.hash(data: Data(certificateMaterial.utf8)))
let transportMaterial = "hanasand-desktop-agent-transport-v1\n\(certificate)"
let transportKey = SymmetricKey(data: Data(SHA256.hash(data: Data(transportMaterial.utf8))))

if CommandLine.arguments.count == 2 {
    guard let envelope = try? JSONSerialization.jsonObject(with: plainBody) as? [String: Any],
          Set(envelope.keys) == Set(["encrypted", "payload"]),
          let encrypted = envelope["encrypted"] as? Bool, encrypted,
          let payload = envelope["payload"] as? String,
          let combined = Data(base64Encoded: payload),
          let box = try? AES.GCM.SealedBox(combined: combined),
          let response = try? AES.GCM.open(box, using: transportKey) else {
        fail("response encryption envelope is invalid")
    }
    FileHandle.standardOutput.write(response)
    exit(0)
}

let method = CommandLine.arguments[1].uppercased()
let target = CommandLine.arguments[2]
guard !method.isEmpty, target.hasPrefix("/"), !target.contains("\n") else {
    fail("invalid method or request target")
}

var wireBody = Data()
if !plainBody.isEmpty {
    do {
        let sealed = try AES.GCM.seal(plainBody, using: transportKey)
        guard let combined = sealed.combined else { fail("could not encode encrypted payload") }
        let envelope: [String: Any] = [
            "encrypted": true,
            "payload": combined.base64EncodedString(),
        ]
        wireBody = try JSONSerialization.data(withJSONObject: envelope, options: [.sortedKeys])
    } catch {
        fail("could not encrypt request body")
    }
}

let timestamp = String(Int(Date().timeIntervalSince1970))
let nonce = UUID().uuidString.lowercased()
let bodyDigest = hex(SHA256.hash(data: wireBody))
let proofMaterial = "\(method)\n\(target)\n\(timestamp)\n\(nonce)\n\(bodyDigest)"
let hmacKey = SymmetricKey(data: Data(certificate.utf8))
let proof = hex(Data(HMAC<SHA256>.authenticationCode(for: Data(proofMaterial.utf8), using: hmacKey)))

if let headerData = "\(timestamp)\n\(nonce)\n\(proof)\n".data(using: .utf8) {
    FileHandle.standardOutput.write(headerData)
}
if wireBody.isEmpty {
    FileHandle.standardOutput.write(Data("-".utf8))
} else {
    FileHandle.standardOutput.write(wireBody)
}
