import CryptoKit
import ExpoModulesCore
import Foundation
import Security

public class HanasandPinnedHttpsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HanasandPinnedHttps")

    AsyncFunction("request") { (url: String, pin: String, method: String, headers: [String: String], body: String?) async throws -> [String: Any] in
      guard let target = URL(string: url), target.scheme?.lowercased() == "https", let host = target.host,
            target.user == nil, target.password == nil, target.query == nil, target.fragment == nil,
            pin.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil else {
        throw PinnedHttpsError.invalidRequest
      }

      var request = URLRequest(url: target, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 8)
      request.httpMethod = method
      request.httpBody = body?.data(using: .utf8)
      headers.forEach { request.setValue($0.value, forHTTPHeaderField: $0.key) }

      let delegate = PinnedHttpsSessionDelegate(host: host, pin: pin)
      let session = URLSession(configuration: .ephemeral, delegate: delegate, delegateQueue: nil)
      defer { session.invalidateAndCancel() }
      let (data, response) = try await session.data(for: request)
      guard let http = response as? HTTPURLResponse else { throw PinnedHttpsError.invalidResponse }
      let responseHeaders = http.allHeaderFields.reduce(into: [String: String]()) { result, item in
        guard let key = item.key as? String else { return }
        result[key] = String(describing: item.value)
      }
      guard let responseBody = String(data: data, encoding: .utf8) else { throw PinnedHttpsError.invalidUtf8 }
      return ["status": http.statusCode, "headers": responseHeaders, "body": responseBody]
    }
  }
}

private final class PinnedHttpsSessionDelegate: NSObject, URLSessionDelegate, URLSessionTaskDelegate {
  private let host: String
  private let pin: String

  init(host: String, pin: String) {
    self.host = host
    self.pin = pin
  }

  func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                  completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
    guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
          let trust = challenge.protectionSpace.serverTrust,
          challenge.protectionSpace.host.caseInsensitiveCompare(host) == .orderedSame,
          let leaf = SecTrustGetCertificateAtIndex(trust, 0) else {
      completionHandler(.cancelAuthenticationChallenge, nil)
      return
    }

    let digest = SHA256.hash(data: SecCertificateCopyData(leaf) as Data)
    let actual = digest.map { String(format: "%02x", $0) }.joined()
    guard Self.constantTimeEqual(actual, pin),
          SecTrustSetAnchorCertificates(trust, [leaf] as CFArray) == errSecSuccess,
          SecTrustSetAnchorCertificatesOnly(trust, true) == errSecSuccess,
          SecTrustSetPolicies(trust, SecPolicyCreateSSL(true, host as CFString)) == errSecSuccess else {
      completionHandler(.cancelAuthenticationChallenge, nil)
      return
    }

    var error: CFError?
    if SecTrustEvaluateWithError(trust, &error) {
      completionHandler(.useCredential, URLCredential(trust: trust))
    } else {
      completionHandler(.cancelAuthenticationChallenge, nil)
    }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                  newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
    completionHandler(nil)
  }

  private static func constantTimeEqual(_ left: String, _ right: String) -> Bool {
    guard left.utf8.count == right.utf8.count else { return false }
    return zip(left.utf8, right.utf8).reduce(UInt8(0)) { $0 | ($1.0 ^ $1.1) } == 0
  }
}

private enum PinnedHttpsError: Error, LocalizedError {
  case invalidRequest
  case invalidResponse
  case invalidUtf8

  var errorDescription: String? {
    switch self {
    case .invalidRequest: return "Pinned desktop requests require an HTTPS URL and a lowercase SHA-256 certificate pin."
    case .invalidResponse: return "The desktop agent returned a non-HTTP response."
    case .invalidUtf8: return "The desktop agent returned a response that is not UTF-8."
    }
  }
}
