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

extension HanasandDesktopSettings {
    var resolvedAIEndpoint: URL {
        let configured = aiAPIURL.trimmingCharacters(in: .whitespacesAndNewlines)
        if let url = URL(string: configured), !configured.isEmpty {
            return url
        }

        let path = codexAPIPath.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        return apiBaseURL.normalizedBaseURL.appendingPathComponent(path.isEmpty ? "tools/ai" : path)
    }

    var loopbackSummary: String {
        [
            "website=\(websiteBaseURL)",
            "api=\(apiBaseURL)",
            "internal=\(internalAPIBaseURL)",
            "ai=\(resolvedAIEndpoint.absoluteString)",
            "desktopAgent=\(desktopAgentBaseURL)",
            "server=\(serverBaseURL)",
            "auth=\(authToken.isEmpty ? "missing" : "configured")",
            "userId=\(userID.isEmpty ? "missing" : "configured")",
            "impersonating=\(impersonatingUserID.isEmpty ? "none" : impersonatingUserID)",
        ].joined(separator: "\n")
    }

    var endpointValidationMessages: [String] {
        [
            validateURLField("Website", websiteBaseURL, optional: false),
            validateURLField("API", apiBaseURL, optional: false),
            validateURLField("Internal API", internalAPIBaseURL, optional: false),
            validateURLField("CDN", cdnBaseURL, optional: false),
            validateURLField("AI endpoint", aiAPIURL, optional: false),
            validateURLField("Desktop agent", desktopAgentBaseURL, optional: false),
            validateURLField("Server", serverBaseURL, optional: true),
        ].compactMap { $0 }
    }

    var hasValidEndpoints: Bool {
        endpointValidationMessages.isEmpty
    }

    func validateURLField(_ label: String, _ rawValue: String, optional: Bool) -> String? {
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        if optional && trimmed.isEmpty { return nil }
        guard let url = URL(string: trimmed),
              url.host != nil,
              url.usesSecureHanasandTransport else {
            return "\(label) needs HTTPS, or HTTP on localhost/private LAN only."
        }
        return nil
    }
}
