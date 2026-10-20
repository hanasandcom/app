import CryptoKit
import Foundation
import Security

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
    || (CommandLine.arguments.count == 2 && CommandLine.arguments[1] == "--decrypt-response")
    || (CommandLine.arguments.count == 5 && CommandLine.arguments[1] == "--send") else {
    fail("usage: smoke-transport METHOD REQUEST_TARGET | --decrypt-response | --send HTTPS_BASE_URL METHOD REQUEST_TARGET")
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

private func pinnedCertificateDER() -> Data {
    let query: [CFString: Any] = [
        kSecClass: kSecClassCertificate,
        kSecAttrLabel: "Hanasand Local Agent TLS Leaf Certificate (desktop-local-agent-v1)",
        kSecReturnData: true,
        kSecMatchLimit: kSecMatchLimitOne,
    ]
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess, let der = result as? Data else {
        fail("could not load the local HTTPS certificate pin from Keychain (Security error \(status))")
    }
    return der
}

private final class CertificatePinDelegate: NSObject, URLSessionDelegate, URLSessionTaskDelegate {
    private let expectedLeafDER: Data
    private let expectedHost: String

    init(expectedLeafDER: Data, expectedHost: String) {
        self.expectedLeafDER = expectedLeafDER
        self.expectedHost = expectedHost.lowercased()
    }

    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              challenge.protectionSpace.host.lowercased() == expectedHost,
              let trust = challenge.protectionSpace.serverTrust,
              let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
              let leaf = chain.first else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }
        let presentedDER = SecCertificateCopyData(leaf) as Data
        guard SHA256.hash(data: presentedDER) == SHA256.hash(data: expectedLeafDER),
              presentedDER == expectedLeafDER else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }
        let status = SecTrustSetAnchorCertificates(trust, [leaf] as CFArray)
        guard status == errSecSuccess,
              SecTrustSetAnchorCertificatesOnly(trust, true) == errSecSuccess,
              SecTrustSetPolicies(trust, SecPolicyCreateSSL(true, expectedHost as CFString)) == errSecSuccess else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }
        var trustError: CFError?
        guard SecTrustEvaluateWithError(trust, &trustError) else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }
        completionHandler(.useCredential, URLCredential(trust: trust))
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

private func sendPinnedRequest(baseURL: String, method: String, target: String, body: Data) -> Int {
    guard let base = URL(string: baseURL), base.scheme?.lowercased() == "https", base.host != nil,
          target.hasPrefix("/"), !target.contains("\n"),
          let url = URL(string: target, relativeTo: base)?.absoluteURL else {
        fail("invalid HTTPS base URL or request target")
    }

    var wireBody = Data()
    if !body.isEmpty {
        do {
            let sealed = try AES.GCM.seal(body, using: transportKey)
            guard let combined = sealed.combined else { fail("could not encode encrypted payload") }
            wireBody = try JSONSerialization.data(withJSONObject: [
                "encrypted": true,
                "payload": combined.base64EncodedString(),
            ], options: [.sortedKeys])
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

    var request = URLRequest(url: url, timeoutInterval: 20)
    request.httpMethod = method
    request.setValue(timestamp, forHTTPHeaderField: "X-Hanasand-Session-Timestamp")
    request.setValue(nonce, forHTTPHeaderField: "X-Hanasand-Session-Nonce")
    request.setValue(proof, forHTTPHeaderField: "X-Hanasand-Session-Proof")
    if !wireBody.isEmpty {
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = wireBody
    }

    let pinDelegate = CertificatePinDelegate(expectedLeafDER: pinnedCertificateDER(), expectedHost: base.host!)
    let session = URLSession(configuration: .ephemeral, delegate: pinDelegate, delegateQueue: nil)
    let semaphore = DispatchSemaphore(value: 0)
    var responseStatus = 0
    var responseBody = Data()
    var requestError: Error?
    session.dataTask(with: request) { data, response, error in
        requestError = error
        responseStatus = (response as? HTTPURLResponse)?.statusCode ?? 0
        responseBody = data ?? Data()
        semaphore.signal()
    }.resume()
    guard semaphore.wait(timeout: .now() + 22) == .success else {
        session.invalidateAndCancel()
        fail("pinned HTTPS request timed out")
    }
    session.invalidateAndCancel()
    if let requestError { fail("pinned HTTPS request failed: \(requestError.localizedDescription)") }
    guard (200..<300).contains(responseStatus) || responseStatus == 401 else {
        fail("agent returned HTTP \(responseStatus)")
    }
    if responseStatus != 401 {
        guard let envelope = try? JSONSerialization.jsonObject(with: responseBody) as? [String: Any],
              Set(envelope.keys) == Set(["encrypted", "payload"]),
              let encrypted = envelope["encrypted"] as? Bool, encrypted,
              let payload = envelope["payload"] as? String,
              let combined = Data(base64Encoded: payload),
              let box = try? AES.GCM.SealedBox(combined: combined),
              (try? AES.GCM.open(box, using: transportKey)) != nil else {
            fail("agent response was not authenticated and encrypted")
        }
    }
    return responseStatus
}

if CommandLine.arguments.count == 5, CommandLine.arguments[1] == "--send" {
    let status = sendPinnedRequest(
        baseURL: CommandLine.arguments[2],
        method: CommandLine.arguments[3].uppercased(),
        target: CommandLine.arguments[4],
        body: plainBody
    )
    print(status)
    exit(0)
}

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
